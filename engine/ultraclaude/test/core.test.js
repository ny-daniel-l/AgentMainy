// Tests for everything that works without a real Claude process:
// vault, messaging, tasks, hooks, the MCP endpoint and the HTTP API.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Vault, parseNote } from '../src/vault.js';
import { startServer } from '../src/server.js';
import { describeTool } from '../src/project.js';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `uc-${name}-`));
process.env.CLAUDE_CONFIG_DIR = tmp('claude'); // never read the real ~/.claude in tests

test('vault: write, append, read, search, path safety', () => {
  const v = new Vault(tmp('vault'), 'demo');
  v.ensure('/x/demo');
  const a = v.write({ title: 'Auth: Flow?', content: 'Tokens expire after 15 minutes.', tags: ['auth', 'api design'], author: 'Bugfixer' });
  assert.equal(a.path, 'Projects/demo/Memory/Auth Flow.md');
  v.write({ title: 'Auth: Flow?', content: 'Refresh happens in middleware.', mode: 'append', author: 'Tester' });
  v.write({ title: 'Style', content: 'Use tabs everywhere.', scope: 'global', author: 'user' });

  const note = v.read('Auth Flow');
  assert.match(note.body, /15 minutes/);
  assert.match(note.body, /Refresh happens/);
  assert.deepEqual(note.authors, ['Bugfixer', 'Tester']);
  assert.deepEqual(note.tags, ['auth', 'api-design']);
  assert.equal(v.read('Projects/demo/Memory/Auth Flow.md').title, 'Auth Flow');
  assert.equal(v.read('style').kind, 'Global');
  assert.equal(v.read('nope'), null);

  assert.equal(v.search('middleware refresh')[0].title, 'Auth Flow');
  assert.equal(v.search('tabs')[0].kind, 'Global');
  assert.equal(v.search('zzz').length, 0);
  assert.throws(() => v.abs('../outside.md'), /outside/);
  assert.equal(v.read('../../etc/passwd'), null);
  assert.equal(parseNote('no frontmatter').body, 'no frontmatter');
});

test('describeTool gives readable activity', () => {
  assert.equal(describeTool('Edit', { file_path: 'C:\\a\\b\\app.js' }), 'editing app.js');
  assert.equal(describeTool('mcp__ultraclaude__send_message', { to: 'Tester' }), 'messaging Tester');
});

test('server: API, MCP tools, messages, tasks and hooks', async (t) => {
  const dir = tmp('proj');
  const app = await startServer({ dir, vaultPath: tmp('v') });
  t.after(() => app.close());
  const { project } = app;
  project.startAgent = async () => {}; // never spawn a real Claude in tests
  const base = `http://127.0.0.1:${app.port}`;
  const api = (method, url, body) => fetch(base + url, { method, headers: { 'x-uc-token': app.token, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());

  assert.equal((await fetch(`${base}/api/state`)).status, 403, 'API needs the token');
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/vendor/xterm.js`)).status, 200);
  assert.equal((await fetch(`${base}/..%2f..%2fpackage.json`)).status, 404);

  const bug = await api('POST', '/api/agents', { roleId: 'bugfixer' });
  const tester = await api('POST', '/api/agents', { roleId: 'tester' });
  const bug2 = await api('POST', '/api/agents', { roleId: 'bugfixer' });
  assert.equal(bug.name, 'Bugfixer');
  assert.equal(bug2.name, 'Bugfixer 2');

  let rpcId = 0;
  const rpc = async (agentId, method, params) => {
    const res = await fetch(`${base}/mcp/${app.token}/${agentId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
    return (await res.json()).result;
  };
  const call = async (agentId, name, args = {}) => (await rpc(agentId, 'tools/call', { name, arguments: args }));

  assert.equal((await fetch(`${base}/mcp/wrong/${bug.id}`, { method: 'POST', body: '{}' })).status, 403);
  const init = await rpc(bug.id, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  assert.equal(init.serverInfo.name, 'ultraclaude');
  const notif = await fetch(`${base}/mcp/${app.token}/${bug.id}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  assert.equal(notif.status, 202);
  assert.ok((await rpc(bug.id, 'tools/list')).tools.some((x) => x.name === 'memory_write'));

  // shared memory: one agent writes, another one finds it
  await call(bug.id, 'memory_write', { title: 'Login bug', content: 'Root cause: off-by-one in token expiry.', tags: ['bug'] });
  assert.match((await call(tester.id, 'memory_search', { query: 'token expiry' })).content[0].text, /off-by-one/);
  assert.match((await call(tester.id, 'memory_read', { note: 'Login bug' })).content[0].text, /authors: Bugfixer/);
  assert.equal((await call(tester.id, 'memory_read', { note: 'missing' })).isError, true);

  // messages: queued for a busy agent, handed over by the next hook
  await call(bug.id, 'send_message', { to: 'Tester', message: 'Fix is in, please run the tests.' });
  assert.equal(project.views().find((a) => a.id === tester.id).unread, 1);
  const post = project.handleHook(tester.id, { hook_event_name: 'PostToolUse' });
  assert.match(post.hookSpecificOutput.additionalContext, /from Bugfixer: Fix is in/);
  assert.equal(project.handleHook(tester.id, { hook_event_name: 'PostToolUse' }), null, 'delivered only once');
  assert.equal((await call(bug.id, 'send_message', { to: 'Nobody', message: 'x' })).isError, true);

  // a message arriving right before the agent stops keeps it going
  await call(bug.id, 'send_message', { to: 'all', message: 'Deploy freeze at 5pm.' });
  assert.equal(project.handleHook(tester.id, { hook_event_name: 'Stop' }).decision, 'block');
  assert.equal(project.handleHook(tester.id, { hook_event_name: 'Stop' }), null);
  assert.equal(project.views().find((a) => a.id === tester.id).state, 'idle');

  // hooks drive the dashboard state
  project.handleHook(bug.id, { hook_event_name: 'UserPromptSubmit' });
  project.handleHook(bug.id, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  let view = project.views().find((a) => a.id === bug.id);
  assert.deepEqual([view.state, view.activity], ['working', '$ npm test']);
  project.handleHook(bug.id, { hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' });
  assert.equal(project.views().find((a) => a.id === bug.id).state, 'waiting');
  await call(bug.id, 'set_status', { status: 'Fixing the login bug' });
  assert.match((await call(tester.id, 'list_agents')).content[0].text, /Bugfixer \(Bugfixer\) — waiting — Fixing the login bug — now: Claude needs/);

  // tasks: assigning notifies the agent, the board lands in the vault
  const created = await call(bug.id, 'task_create', { title: 'Regression test for login', assignee: 'Tester' });
  assert.match(created.content[0].text, /#1 \[todo\]/);
  assert.match(project.takeUnread(tester.id), /Task #1 was assigned to you/);
  await call(tester.id, 'task_update', { id: 1, status: 'in_progress', assignee: 'me' });
  await api('PATCH', '/api/tasks/1', { status: 'done' });
  assert.equal((await api('GET', '/api/state')).tasks[0].status, 'done');
  const board = fs.readFileSync(path.join(project.vault.projectDir, 'Tasks', `${project.name} Board.md`), 'utf8');
  assert.match(board, /- \[x\] \*\*#1\*\* Regression test for login/);

  // briefing for a starting agent contains team, memory and its queued messages
  await api('POST', '/api/message', { to: bug2.name, text: 'Welcome aboard' });
  const brief = project.handleHook(bug2.id, { hook_event_name: 'SessionStart' }).hookSpecificOutput.additionalContext;
  assert.match(brief, /Tester \(Tester\)/);
  assert.match(brief, /Login bug/);
  assert.match(brief, /from user: Welcome aboard/);

  const notes = await api('GET', '/api/notes');
  assert.ok(notes.some((n) => n.kind === 'Memory' && n.title === 'Login bug'));
  assert.ok(notes.some((n) => n.kind === 'Log'));

  // the feed reads as sentences, and a finished agent's status is reported as its last one
  assert.ok(project.events.some((e) => e.type === 'memory' && e.text === 'saved “Login bug” to memory'));
  assert.ok(project.events.some((e) => e.type === 'task' && e.text === 'moved task #1 “Regression test for login” to done'));
  project.handleHook(bug.id, { hook_event_name: 'Stop' });
  assert.equal(project.describe(project.views().find((a) => a.id === bug.id)), 'idle — last: Fixing the login bug');
  assert.equal(project.views().find((a) => a.id === tester.id).roleName, 'Tester');

  const agentNote = path.join(project.vault.projectDir, 'Agents', 'Bugfixer 2.md');
  assert.ok(fs.existsSync(agentNote));
  await api('DELETE', `/api/agents/${bug2.id}`);
  assert.ok(!fs.existsSync(agentNote), 'a removed agent leaves no note behind');
  const state = await api('GET', '/api/state');
  assert.equal(state.notes, 1);
  assert.deepEqual(state.roles.find((r) => r.id === 'reviewer'), { id: 'reviewer', name: 'PR Reviewer', blurb: 'Reviews pull requests and diffs' });
  assert.equal((await fetch(`${base}/vendor/plex-sans-400.woff2`)).headers.get('content-type'), 'font/woff2');
  assert.equal((await api('GET', '/api/state')).agents.length, 2);
  project.saveNow();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.ultraclaude', 'state.json'), 'utf8')).agents.length, 2);
});
