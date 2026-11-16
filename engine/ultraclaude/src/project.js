// One UltraClaude project: the agents (Claude Code processes in pseudo terminals),
// their messages, the task board and the activity feed.
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vault, KNOWLEDGE } from './vault.js';
import { listSessions, claudeMemoryFiles, claudeSetting } from './history.js';
import { roleById, roleName, buildPrompt } from './roles.js';

const HOOK_SCRIPT = fileURLToPath(new URL('./hook.js', import.meta.url)).replace(/\\/g, '/');
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop'];
const BUFFER_MAX = 400_000;
const TASK_STATES = ['todo', 'in_progress', 'done'];
const TASK_LABEL = { todo: 'open', in_progress: 'in progress', done: 'done' };
const RESERVED_NAMES = ['user', 'you', 'all', 'everyone'];
const BROADCAST = ['all', 'everyone', '*'];

let claudePath = null;

/** Path of the Claude Code executable, or null when it is not installed. Looked up once, then remembered. */
function resolveClaude() {
  if (process.env.ULTRACLAUDE_CLAUDE) return process.env.ULTRACLAUDE_CLAUDE;
  if (claudePath && fs.existsSync(claudePath)) return claudePath;
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['claude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    claudePath = lines.find((l) => /\.exe$/i.test(l)) || lines.find((l) => /\.cmd$/i.test(l)) || lines[0] || null;
  } catch {
    claudePath = null;
  }
  return claudePath;
}

const base = (f) => (f ? String(f).split(/[\\/]/).pop() : '');
const short = (s, n = 60) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** One short line for the dashboard that says what a tool call is doing. */
export function describeTool(name, input = {}) {
  if (name?.startsWith('mcp__ultraclaude__')) {
    const t = name.slice('mcp__ultraclaude__'.length);
    return ({
      send_message: `messaging ${input.to || '?'}`,
      read_messages: 'reading messages',
      list_agents: 'checking on the team',
      set_status: 'updating status',
      memory_search: `searching memory: ${short(input.query, 40)}`,
      memory_read: `reading memory: ${short(input.note, 40)}`,
      memory_write: `saving memory: ${short(input.title, 40)}`,
      memory_list: 'listing memory',
      task_list: 'reading the task board',
      task_create: `creating task: ${short(input.title, 40)}`,
      task_update: `updating task #${input.id ?? '?'}`,
    })[t] || t;
  }
  switch (name) {
    case 'Read': return `reading ${base(input.file_path)}`;
    case 'Edit': case 'Write': case 'NotebookEdit': return `editing ${base(input.file_path || input.notebook_path)}`;
    case 'Bash': case 'PowerShell': return `$ ${short(input.command)}`;
    case 'Grep': case 'Glob': return `searching ${short(input.pattern, 40)}`;
    case 'Agent': case 'Task': return `subagent: ${short(input.description, 40)}`;
    case 'WebFetch': return `fetching ${short(input.url, 50)}`;
    case 'WebSearch': return `web search: ${short(input.query, 40)}`;
    case 'ToolSearch': return 'looking up tools';
    default: return name?.startsWith('mcp__') ? name.split('__').slice(1).join(' · ') : String(name || 'working');
  }
}

export class Project extends EventEmitter {
  constructor({ dir, vaultPath }) {
    super();
    this.dir = path.resolve(dir);
    this.name = path.basename(this.dir) || 'project';
    this.dataDir = path.join(this.dir, '.ultraclaude');
    this.stateFile = path.join(this.dataDir, 'state.json');
    this.vault = new Vault(vaultPath, this.name);
    this.runtime = new Map(); // agentId -> { state, activity, pty, buffer, ... }
    this.events = [];
    this.endpoint = null; // { port, token } once the server listens
    this.state = { agents: [], tasks: [], messages: [], nextTaskId: 1 };

    fs.mkdirSync(this.dataDir, { recursive: true });
    const ignore = path.join(this.dataDir, '.gitignore');
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n');
    if (fs.existsSync(this.stateFile)) {
      try { this.state = { ...this.state, ...JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) }; } catch { /* start fresh on a corrupt file */ }
    }
    this.vault.ensure(this.dir);
    for (const a of this.state.agents) this.runtime.set(a.id, this.#freshRuntime());
    this.syncClaudeCode();
  }

  // ---------- what Claude Code already has for this folder ----------

  /** Earlier Claude Code sessions of this folder that are not open as an agent right now. */
  sessions() {
    const open = new Set(this.state.agents.map((a) => a.sessionId));
    return listSessions(this.dir).filter((s) => !open.has(s.id)).slice(0, 60);
  }

  /** Brings Claude Code's own memory notes and session list for this folder into the vault. */
  syncClaudeCode() {
    try {
      if (this.vault.mirror(claudeMemoryFiles(this.dir), listSessions(this.dir))) this.emit('notes');
    } catch { /* vault or Claude Code folder unavailable */ }
  }

  // ---------- state helpers ----------

  #freshRuntime() {
    return { state: 'stopped', activity: '', statusText: '', toolCount: 0, lastActive: 0, pty: null, buffer: '', pendingPrompt: '', startedAt: 0 };
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 200);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  agent(ref) {
    const key = String(ref ?? '').trim().toLowerCase();
    return this.state.agents.find((a) => a.id === ref || a.name.toLowerCase() === key);
  }

  view(a) {
    const r = this.runtime.get(a.id);
    return {
      id: a.id, name: a.name, roleId: a.roleId, roleName: roleName(a), sessionId: a.sessionId,
      model: a.model, permissionMode: a.permissionMode, worktree: a.worktree,
      state: r.state, activity: r.activity, statusText: r.statusText, toolCount: r.toolCount, lastActive: r.lastActive,
      unread: this.state.messages.filter((m) => m.to === a.id && !m.delivered).length,
    };
  }

  views() { return this.state.agents.map((a) => this.view(a)); }
  running() { return [...this.runtime.values()].filter((r) => r.pty).length; }

  #changed(a) {
    this.emit('agents', this.views());
    if (a) { try { this.vault.writeAgentNote(this.view(a)); } catch { /* vault unavailable */ } }
  }

  /** Adds an entry to the activity feed. `text` reads as a sentence after the agent's name. */
  event(type, agent, text, extra = {}) {
    const e = { id: crypto.randomUUID(), ts: Date.now(), type, agent, text: short(text, 400), ...extra };
    this.events.push(e);
    if (this.events.length > 300) this.events.shift();
    this.emit('event', e);
    if (type !== 'tool') { try { this.vault.log(agent, extra.to ? `→ ${extra.to}: ${text}` : text); } catch { /* vault unavailable */ } }
    return e;
  }

  // ---------- agents ----------

  /** With `sessionId` the agent continues an earlier Claude Code session instead of starting a new one. */
  createAgent({ roleId = 'custom', name, instructions = '', model = '', permissionMode = '', worktree = false, prompt = '', sessionId = '' }) {
    const role = roleById(roleId);
    const session = sessionId ? this.sessions().find((s) => s.id === sessionId) : null;
    if (sessionId && !session) throw new Error('That session is not available any more.');
    const wanted = short(name || session?.title || (role.id === 'custom' ? 'Agent' : role.name), 40).replace(/["\r\n]/g, '');
    let unique = wanted;
    for (let i = 2; this.agent(unique) || RESERVED_NAMES.includes(unique.toLowerCase()); i++) unique = `${wanted} ${i}`;
    const a = {
      id: crypto.randomBytes(4).toString('hex'), name: unique, roleId: role.id,
      instructions: String(instructions).trim(), model, permissionMode, worktree: !!worktree,
      sessionId: session?.id || crypto.randomUUID(), started: !!session, imported: !!session, createdAt: Date.now(),
    };
    this.state.agents.push(a);
    this.runtime.set(a.id, this.#freshRuntime());
    this.save();
    this.emit('sessions');
    this.startAgent(a.id, { prompt }).catch((err) => this.event('error', a.name, `failed to start: ${err.message}`));
    return this.view(a);
  }

  async startAgent(id, { prompt = '', cols = 120, rows = 32 } = {}) {
    const a = this.agent(id);
    const r = this.runtime.get(id);
    if (!a || r.pty) return;
    if (!this.endpoint) throw new Error('Server is not listening yet');
    const { port, token } = this.endpoint;
    const fail = (message) => {
      Object.assign(r, { state: 'stopped', activity: '' });
      this.event('error', a.name, `failed to start: ${message}`);
      this.#changed(a);
    };

    let file = resolveClaude();
    if (!file) return fail('Claude Code was not found. Install it and make sure the "claude" command works in your terminal.');
    const pty = (await import('@lydell/node-pty')).default;

    const dir = path.join(this.dataDir, 'agents', a.id);
    fs.mkdirSync(dir, { recursive: true });
    const mcpFile = path.join(dir, 'mcp.json');
    const settingsFile = path.join(dir, 'settings.json');
    fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: { ultraclaude: { type: 'http', url: `http://127.0.0.1:${port}/mcp/${token}/${a.id}` } } }, null, 2));
    const hook = [{ hooks: [{ type: 'command', command: `node "${HOOK_SCRIPT}"`, timeout: 10 }] }];
    fs.writeFileSync(settingsFile, JSON.stringify({
      permissions: { allow: ['mcp__ultraclaude'] },
      hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, hook])),
    }, null, 2));

    const resumed = a.started;
    const args = [
      '--append-system-prompt', buildPrompt({ agent: a, project: this.name, vaultPath: this.vault.root }),
      '--mcp-config', mcpFile, '--settings', settingsFile, '--add-dir', this.vault.root, '-n', a.name,
      ...(resumed ? ['--resume', a.sessionId] : ['--session-id', a.sessionId]),
      // A session that began outside UltraClaude recorded its system prompt back then; without this the team protocol would not reach it.
      ...(a.imported ? ['--system-prompt-snapshot', 'off'] : []),
      ...(a.model ? ['--model', a.model] : []),
      ...(a.permissionMode ? ['--permission-mode', a.permissionMode] : []),
      ...(a.worktree ? ['--worktree', `uc-${a.id}`] : []),
    ];
    const env = { ...process.env, ULTRACLAUDE_HOOK_URL: `http://127.0.0.1:${port}/hook/${token}/${a.id}`, ULTRACLAUDE_AGENT: a.name };
    // If UltraClaude itself was launched from inside a Claude Code session, don't pass that session's
    // markers on. That includes NO_COLOR, which Claude Code sets for its own tool shells and which would
    // turn every agent's terminal monochrome.
    const markers = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_PID'];
    if (markers.some((k) => k in env)) delete env.NO_COLOR;
    for (const k of markers) delete env[k];
    env.COLORTERM ||= 'truecolor'; // the terminal in the window supports 24-bit colour
    // Claude Code's fullscreen rendering keeps the prompt pinned at the bottom while the chat scrolls
    // above it. Claude Code does not recognise this terminal and would fall back to inline rendering,
    // where the prompt scrolls away with the chat, so it is switched on here unless the user's own
    // Claude Code settings ask for a different "tui".
    const tui = claudeSetting('tui');
    if (env.CLAUDE_CODE_NO_FLICKER === undefined && (tui === undefined || tui === 'fullscreen')) env.CLAUDE_CODE_NO_FLICKER = '1';

    let argv = args;
    if (/\.(cmd|bat)$/i.test(file)) { argv = ['/c', file, ...args]; file = 'cmd.exe'; }

    Object.assign(r, { state: 'starting', activity: '', buffer: '', pendingPrompt: prompt, startedAt: Date.now(), reported: false, stopping: false });
    try {
      r.pty = pty.spawn(file, argv, { name: 'xterm-256color', cols, rows, cwd: this.dir, env });
    } catch (err) {
      return fail(err.message);
    }
    r.pty.onData((d) => {
      r.buffer += d;
      if (r.buffer.length > BUFFER_MAX) r.buffer = r.buffer.slice(-BUFFER_MAX / 2);
      this.emit('pty', a.id, d);
    });
    r.pty.onExit(() => {
      // Claude Code quits at once when it cannot find the session it was asked to resume.
      const resumeFailed = resumed && !r.reported && !r.stopping && Date.now() - r.startedAt < 5000;
      r.pty = null;
      Object.assign(r, { state: 'stopped', activity: '' });
      if (resumeFailed) {
        a.started = false;
        a.imported = false;
        a.sessionId = crypto.randomUUID();
        this.save();
        this.event('error', a.name, 'could not continue its earlier session. The next start begins a new one.');
      }
      if (this.agent(a.id)) { this.event('stop', a.name, 'stopped'); this.#changed(a); }
    });
    // Claude Code reports in through its SessionStart hook. If that takes long, it is
    // almost always sitting at a first-run prompt (folder trust, login) in its terminal.
    const startedAt = r.startedAt;
    setTimeout(() => {
      if (r.pty && r.state === 'starting' && r.startedAt === startedAt) {
        Object.assign(r, { state: 'waiting', activity: 'waiting for you in its terminal' });
        this.event('waiting', a.name, 'needs you: it is waiting for input in its terminal');
        this.#changed(a);
      }
    }, 10_000).unref();
    this.event('start', a.name, resumed ? 'resumed its session' : 'started');
    this.#changed(a);
  }

  stopAgent(id) {
    const r = this.runtime.get(id);
    if (r?.pty) { r.stopping = true; try { r.pty.kill(); } catch { /* already gone */ } }
  }

  removeAgent(id) {
    const a = this.agent(id);
    if (!a) return;
    this.state.agents = this.state.agents.filter((x) => x.id !== id);
    this.stopAgent(id);
    this.runtime.delete(id);
    this.state.messages = this.state.messages.filter((m) => m.to !== id);
    this.save();
    try { this.vault.removeAgentNote(a.name); } catch { /* vault unavailable */ }
    this.event('stop', a.name, 'was removed');
    this.emit('agents', this.views());
    this.emit('sessions');
  }

  stopAll() { for (const a of this.state.agents) this.stopAgent(a.id); }

  write(id, data) { this.runtime.get(id)?.pty?.write(data); }

  resize(id, cols, rows) {
    const p = this.runtime.get(id)?.pty;
    if (p && cols > 1 && rows > 1) { try { p.resize(Math.floor(cols), Math.floor(rows)); } catch { /* pty closed */ } }
  }

  /** Types a prompt into an idle agent's terminal and submits it. */
  inject(id, text) {
    const r = this.runtime.get(id);
    if (!r?.pty) return false;
    r.state = 'working';
    r.pty.write(String(text).replace(/\s*\r?\n\s*/g, ' ').trim());
    setTimeout(() => r.pty?.write('\r'), 500);
    return true;
  }

  /**
   * Saves a pasted image in the project's agent data and types its path into the agent's prompt,
   * which Claude Code turns into an image attachment ("[Image #1]").
   */
  pasteImage(id, data, type = '') {
    const r = this.runtime.get(id);
    if (!r?.pty) throw new Error('The agent is not running.');
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' }[String(type).split(';')[0].trim().toLowerCase()];
    if (!ext) throw new Error('Only PNG, JPEG, GIF, WebP and BMP images can be pasted.');
    if (!data?.length) throw new Error('The image is empty.');
    const dir = path.join(this.dataDir, 'pasted');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) { // clean up what is older than a week
      try { if (Date.now() - fs.statSync(path.join(dir, f)).mtimeMs > 7 * 864e5) fs.rmSync(path.join(dir, f)); } catch { /* gone already */ }
    }
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const file = path.join(dir, `pasted-${stamp}-${crypto.randomBytes(2).toString('hex')}.${ext}`);
    fs.writeFileSync(file, data);
    r.pty.write(`\x1b[200~${file}\x1b[201~ `);
    return file;
  }

  // ---------- messages ----------

  sendMessage(from, to, text) {
    const body = String(text ?? '').trim();
    if (!body) throw new Error('The message is empty.');
    const target = String(to ?? '').trim();
    if (target.toLowerCase() === 'user') {
      this.event('notify', from, body, { to: 'user' });
      return 'The user sees your message on the dashboard.';
    }
    const everyone = BROADCAST.includes(target.toLowerCase());
    const recipients = everyone ? this.state.agents.filter((a) => a.name !== from) : [this.agent(target)].filter(Boolean);
    if (!recipients.length) {
      throw new Error(everyone ? 'There are no other agents.' : `No agent named "${target}". Agents: ${this.state.agents.map((a) => a.name).join(', ') || 'none'}`);
    }
    for (const a of recipients) {
      this.state.messages.push({ id: crypto.randomUUID(), from, to: a.id, text: body, ts: Date.now(), delivered: false });
    }
    if (this.state.messages.length > 500) this.state.messages = this.state.messages.slice(-500);
    this.save();
    this.event('message', from, body, { to: everyone ? 'all' : recipients[0].name });
    for (const a of recipients) this.#deliverIfIdle(a);
    this.emit('agents', this.views());
    return `Sent to ${recipients.map((a) => a.name).join(', ')}.`;
  }

  /** Marks an agent's unread messages as delivered and returns them as prompt text ('' if none). */
  takeUnread(id) {
    const unread = this.state.messages.filter((m) => m.to === id && !m.delivered);
    if (!unread.length) return '';
    for (const m of unread) m.delivered = true;
    this.save();
    return unread.map((m) => `[UltraClaude message] from ${m.from}: ${m.text}`).join('\n');
  }

  #deliverIfIdle(a) {
    const r = this.runtime.get(a.id);
    if (r?.pty && r.state === 'idle') {
      const text = this.takeUnread(a.id);
      if (text) this.inject(a.id, text);
    }
  }

  // ---------- tasks ----------

  #tasksChanged() {
    this.save();
    this.emit('tasks', this.state.tasks);
    try { this.vault.writeBoard(this.state.tasks); } catch { /* vault unavailable */ }
  }

  createTask(by, { title, description = '', assignee = '' }) {
    if (!String(title ?? '').trim()) throw new Error('A task needs a title.');
    const who = assignee ? this.agent(assignee) : null;
    if (assignee && !who) throw new Error(`No agent named "${assignee}".`);
    const t = { id: this.state.nextTaskId++, title: short(title, 200), description: String(description).trim(), status: 'todo', assignee: who?.name || '', createdBy: by, createdAt: Date.now(), updatedAt: Date.now() };
    this.state.tasks.push(t);
    this.event('task', by, `created task #${t.id}: ${t.title}${t.assignee ? ` (for ${t.assignee})` : ''}`);
    this.#tasksChanged();
    if (who && who.name !== by) this.sendMessage(by, who.name, `Task #${t.id} was assigned to you: ${t.title}${t.description ? ` — ${t.description}` : ''}`);
    return t;
  }

  updateTask(by, id, patch = {}) {
    const t = this.state.tasks.find((x) => x.id === Number(id));
    if (!t) throw new Error(`There is no task #${id}.`);
    const before = { status: t.status, assignee: t.assignee };
    if (patch.status !== undefined) {
      if (!TASK_STATES.includes(patch.status)) throw new Error(`status must be one of ${TASK_STATES.join(', ')}`);
      t.status = patch.status;
    }
    if (patch.assignee !== undefined) {
      const who = patch.assignee ? this.agent(patch.assignee) : null;
      if (patch.assignee && !who) throw new Error(`No agent named "${patch.assignee}".`);
      t.assignee = who?.name || '';
    }
    if (patch.title) t.title = short(patch.title, 200);
    if (patch.description !== undefined) t.description = String(patch.description).trim();
    if (patch.note) t.description = `${t.description}${t.description ? '\n' : ''}${by}: ${String(patch.note).trim()}`;
    t.updatedAt = Date.now();

    const name = `task #${t.id} “${t.title}”`;
    const changes = [];
    if (t.status !== before.status) changes.push(`moved ${name} to ${TASK_LABEL[t.status]}`);
    if (t.assignee !== before.assignee) changes.push(t.assignee ? `assigned ${name} to ${t.assignee}` : `unassigned ${name}`);
    this.event('task', by, changes.join(' and ') || `updated ${name}`);
    this.#tasksChanged();
    if (t.assignee && t.assignee !== before.assignee && t.assignee !== by) this.sendMessage(by, t.assignee, `Task #${t.id} was assigned to you: ${t.title}`);
    return t;
  }

  deleteTask(id) {
    this.state.tasks = this.state.tasks.filter((t) => t.id !== Number(id));
    this.#tasksChanged();
  }

  // ---------- context handed to agents ----------

  /** "working — Fixing the login bug", or "idle — last: …" once the agent is no longer on it. */
  describe(v) {
    const busy = v.state === 'working' || v.state === 'waiting';
    return `${v.state}${v.statusText ? ` — ${busy ? '' : 'last: '}${v.statusText}` : ''}${busy && v.activity ? ` — now: ${v.activity}` : ''}`;
  }

  teamSnapshot(exceptId) {
    const lines = this.views().filter((v) => v.id !== exceptId).map((v) => `- ${v.name} (${v.roleName}) — ${this.describe(v)}`);
    return lines.length ? `Team right now:\n${lines.join('\n')}` : 'You are currently the only agent in this project.';
  }

  briefing(id) {
    const open = this.state.tasks.filter((t) => t.status !== 'done');
    this.syncClaudeCode();
    const notes = this.vault.list(KNOWLEDGE).slice(0, 30);
    const a = this.agent(id);
    return [
      '[UltraClaude briefing]',
      // an imported session never saw the team protocol in its system prompt, so it gets it here
      a?.imported ? buildPrompt({ agent: a, project: this.name, vaultPath: this.vault.root }) : '',
      this.teamSnapshot(id),
      open.length ? `Open tasks:\n${open.map((t) => `- #${t.id} ${t.title} [${t.status}${t.assignee ? `, ${t.assignee}` : ''}]`).join('\n')}` : 'No open tasks on the board.',
      notes.length ? `Shared memory notes (use memory_read / memory_search):\n${notes.map((n) => `- ${n.title}${n.tags.length ? ` (${n.tags.join(', ')})` : ''}: ${short(n.excerpt, 90)}`).join('\n')}` : 'Shared memory is still empty.',
      this.takeUnread(id),
    ].filter(Boolean).join('\n\n');
  }

  // ---------- Claude Code hooks ----------

  /** Called for every hook event of an agent. Returns the JSON the hook prints, or null. */
  handleHook(id, p = {}) {
    const a = this.agent(id);
    const r = this.runtime.get(id);
    if (!a || !r) return null;
    const ev = p.hook_event_name;
    const context = (text) => (text ? { hookSpecificOutput: { hookEventName: ev, additionalContext: text } } : null);
    let out = null;
    r.lastActive = Date.now();

    if (ev === 'SessionStart') {
      Object.assign(r, { state: 'idle', activity: '', reported: true });
      out = context(this.briefing(id));
      if (r.pendingPrompt) {
        const prompt = r.pendingPrompt;
        r.pendingPrompt = '';
        setTimeout(() => this.inject(id, prompt), 1500);
      }
    } else if (ev === 'UserPromptSubmit') {
      Object.assign(r, { state: 'working', activity: 'thinking' });
      if (!a.started) { a.started = true; this.save(); }
      out = context([this.teamSnapshot(id), this.takeUnread(id)].filter(Boolean).join('\n\n'));
    } else if (ev === 'PreToolUse') {
      r.toolCount++;
      Object.assign(r, { state: 'working', activity: describeTool(p.tool_name, p.tool_input) });
      this.event('tool', a.name, r.activity);
    } else if (ev === 'PostToolUse') {
      r.state = 'working';
      out = context(this.takeUnread(id));
    } else if (ev === 'Notification') {
      if (r.state === 'working' && !/waiting for your input/i.test(p.message || '')) {
        Object.assign(r, { state: 'waiting', activity: short(p.message || 'needs your input', 80) });
        this.event('waiting', a.name, `needs you: ${r.activity}`);
      }
    } else if (ev === 'Stop') {
      const unread = this.takeUnread(id);
      if (unread) {
        out = { decision: 'block', reason: `New messages from your team arrived while you were working:\n${unread}` };
      } else {
        Object.assign(r, { state: 'idle', activity: '' });
      }
    }
    this.#changed(a);
    return out;
  }

  setStatus(id, text) {
    const a = this.agent(id);
    const r = this.runtime.get(id);
    r.statusText = short(text, 140);
    this.event('status', a.name, `now: ${r.statusText}`);
    this.#changed(a);
  }
}
