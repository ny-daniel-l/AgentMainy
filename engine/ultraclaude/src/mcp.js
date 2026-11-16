// Minimal MCP server (Streamable HTTP, JSON responses) that gives every agent the team tools.
import { KNOWLEDGE } from './vault.js';

const str = (description) => ({ type: 'string', description });

const TOOLS = [
  { name: 'list_agents', description: 'List all agents in this project with their role, state and what they are working on.', inputSchema: { type: 'object', properties: {} } },
  { name: 'send_message', description: 'Send a message to a teammate (by name), to "all" teammates, or to "user" (shows on the dashboard). It is delivered automatically.',
    inputSchema: { type: 'object', properties: { to: str('Agent name, "all" or "user"'), message: str('The message, short and concrete') }, required: ['to', 'message'] } },
  { name: 'read_messages', description: 'Read messages addressed to you that have not been delivered yet.', inputSchema: { type: 'object', properties: {} } },
  { name: 'set_status', description: 'Tell the team and the dashboard in one short line what you are working on now.',
    inputSchema: { type: 'object', properties: { status: str('One short line') }, required: ['status'] } },
  { name: 'memory_search', description: 'Search the shared Obsidian memory (project and global notes) by keywords.',
    inputSchema: { type: 'object', properties: { query: str('Keywords') }, required: ['query'] } },
  { name: 'memory_read', description: 'Read one note from shared memory by title or vault path.',
    inputSchema: { type: 'object', properties: { note: str('Note title or vault-relative path') }, required: ['note'] } },
  { name: 'memory_write', description: 'Create or update a note in shared memory. Use it for durable knowledge: decisions, architecture, conventions, gotchas, findings. Markdown with [[wikilinks]].',
    inputSchema: { type: 'object', properties: {
      title: str('Note title; an existing note with this title is updated'),
      content: str('Markdown content'),
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
      scope: { type: 'string', enum: ['project', 'global'], description: '"project" (default) or "global" for knowledge valid in every project' },
      mode: { type: 'string', enum: ['replace', 'append'], description: '"replace" (default) or "append" to add to an existing note' },
    }, required: ['title', 'content'] } },
  { name: 'memory_list', description: 'List all notes in shared memory.', inputSchema: { type: 'object', properties: {} } },
  { name: 'task_list', description: 'Show the task board.', inputSchema: { type: 'object', properties: {} } },
  { name: 'task_create', description: 'Add a task to the board, optionally assigned to a teammate (they get notified).',
    inputSchema: { type: 'object', properties: { title: str('Short title'), description: str('Details, acceptance criteria'), assignee: str('Agent name') }, required: ['title'] } },
  { name: 'task_update', description: 'Update a task: claim it, change its status, reassign it or add a note.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'number', description: 'Task number' },
      status: { type: 'string', enum: ['todo', 'in_progress', 'done'] },
      assignee: str('Agent name, or "me"'),
      note: str('Progress note appended to the task'),
    }, required: ['id'] } },
];

const taskLine = (t) => `#${t.id} [${t.status}] ${t.title}${t.assignee ? ` — ${t.assignee}` : ''}${t.description ? `\n   ${t.description.replace(/\n/g, '\n   ')}` : ''}`;

function callTool(project, agent, name, args = {}) {
  switch (name) {
    case 'list_agents':
      return project.views().map((a) => `- ${a.name}${a.id === agent.id ? ' (you)' : ''} (${a.roleName}) — ${project.describe(a)}`).join('\n');
    case 'send_message':
      return project.sendMessage(agent.name, args.to, args.message);
    case 'read_messages':
      return project.takeUnread(agent.id) || 'No new messages.';
    case 'set_status':
      project.setStatus(agent.id, args.status);
      return 'Status updated.';
    case 'memory_search': {
      const hits = project.vault.search(args.query);
      project.event('memory', agent.name, `searched memory for “${args.query}” (${hits.length} ${hits.length === 1 ? 'hit' : 'hits'})`, { op: 'read' });
      return hits.length ? hits.map((h) => `## ${h.title}  (${h.path}, updated ${h.updated})\n${h.excerpt}`).join('\n\n') : 'Nothing found in shared memory.';
    }
    case 'memory_read': {
      const n = project.vault.read(args.note);
      if (!n) throw new Error(`No note "${args.note}". Use memory_list or memory_search.`);
      project.event('memory', agent.name, `read “${n.title}” from memory`, { op: 'read' });
      return `# ${n.title}\n(${n.path} · updated ${n.updated} · authors: ${n.authors.join(', ') || '?'}${n.tags.length ? ` · tags: ${n.tags.join(', ')}` : ''})\n\n${n.body}`;
    }
    case 'memory_write': {
      const res = project.vault.write({ ...args, author: agent.name });
      project.event('memory', agent.name, `saved “${res.title}” to memory`, { op: 'write', path: res.path });
      project.emit('notes');
      return `Saved to shared memory: ${res.path}`;
    }
    case 'memory_list': {
      const notes = project.vault.list(KNOWLEDGE);
      return notes.length ? notes.map((n) => `- ${n.title} [${n.kind}]${n.tags.length ? ` (${n.tags.join(', ')})` : ''} — ${n.excerpt.slice(0, 90)}`).join('\n') : 'Shared memory is empty.';
    }
    case 'task_list':
      return project.state.tasks.length ? project.state.tasks.map(taskLine).join('\n') : 'The board is empty.';
    case 'task_create':
      return `Created: ${taskLine(project.createTask(agent.name, args))}`;
    case 'task_update': {
      const patch = { ...args };
      if (String(patch.assignee ?? '').toLowerCase() === 'me') patch.assignee = agent.name;
      return `Updated: ${taskLine(project.updateTask(agent.name, args.id, patch))}`;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function handleOne(project, agent, msg) {
  const { id, method, params } = msg ?? {};
  if (id === undefined || id === null) return null; // notification
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'ultraclaude', version: '0.1.0' },
        instructions: 'Team tools of UltraClaude: shared Obsidian memory, messages between agents, status and task board.',
      });
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call':
      try {
        return ok({ content: [{ type: 'text', text: String(callTool(project, agent, params?.name, params?.arguments ?? {})) }] });
      } catch (err) {
        return ok({ content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true });
      }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

/** Returns the JSON-RPC response (object or array), or null when nothing has to be sent. */
export function handleMcp(project, agentId, body) {
  const agent = project.agent(agentId);
  if (!agent) return { jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32000, message: 'Unknown agent' } };
  if (Array.isArray(body)) {
    const out = body.map((m) => handleOne(project, agent, m)).filter(Boolean);
    return out.length ? out : null;
  }
  return handleOne(project, agent, body);
}
