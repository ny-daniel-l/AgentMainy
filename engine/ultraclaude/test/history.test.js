// Earlier Claude Code sessions and Claude Code's own memory notes, read from a fake ~/.claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `uc-${name}-`));
process.env.CLAUDE_CONFIG_DIR = tmp('claude');
const { claudeProjectDir, listSessions } = await import('../src/history.js');
const { startServer } = await import('../src/server.js');

const line = (o) => `${JSON.stringify(o)}\n`;
const user = (text, extra = {}) => line({ type: 'user', message: { role: 'user', content: text }, cwd: 'x', ...extra });

function writeSession(dir, id, lines, ageMinutes) {
  const root = claudeProjectDir(dir);
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, `${id}.jsonl`);
  fs.writeFileSync(file, lines.join(''));
  const when = new Date(Date.now() - ageMinutes * 60000);
  fs.utimesSync(file, when, when);
}

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

test('sessions and Claude Code memory of a folder show up and can be continued', async (t) => {
  const dir = tmp('proj');
  assert.equal(path.basename(claudeProjectDir('C:\\Work\\my app_1')), 'C--Work-my-app-1');
  assert.deepEqual(listSessions(dir), [], 'a folder Claude Code never saw has no sessions');

  // A: titled by Claude, first line is a slash command; the transcript is larger than one read chunk
  writeSession(dir, A, [
    user('<command-name>/mcp</command-name>', { isMeta: true }),
    user('Fix the login bug\nplease'),
    line({ type: 'ai-title', aiTitle: 'Old title' }),
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(700_000) }] } }),
    line({ type: 'ai-title', aiTitle: 'Fix login bug' }),
  ], 30);
  // B: no title yet, prompt given as content blocks
  writeSession(dir, B, [line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Write the changelog for 2.0' }] } })], 5);
  // C: named by hand, which wins over Claude's title
  writeSession(dir, C, [user('hello'), line({ type: 'ai-title', aiTitle: 'Greeting' }), line({ type: 'custom-title', customTitle: 'Release prep' })], 600);
  // D: nothing a person typed, so it is not worth showing
  writeSession(dir, D, [user('<command-name>/clear</command-name>'), user('[UltraClaude message] from Tester: hi')], 1);
  fs.writeFileSync(path.join(claudeProjectDir(dir), 'not-a-session.jsonl'), 'x');

  const sessions = listSessions(dir);
  assert.deepEqual(sessions.map((s) => s.title), ['Write the changelog for 2.0', 'Fix login bug', 'Release prep']);
  assert.equal(sessions[1].firstPrompt, 'Fix the login bug please');
  assert.equal(sessions[1].id, A);

  // Claude Code's own memory for the folder
  const memory = path.join(claudeProjectDir(dir), 'memory');
  fs.mkdirSync(memory);
  fs.writeFileSync(path.join(memory, 'MEMORY.md'), '- [Deploy](deploy.md)\n');
  fs.writeFileSync(path.join(memory, 'deploy.md'), '---\nname: deploy\n---\n\nDeploys go through the staging pipeline first.\n');

  const app = await startServer({ dir, vaultPath: tmp('v') });
  t.after(() => app.close());
  const { project } = app;
  const startedWith = [];
  project.startAgent = async (id) => { startedWith.push(project.agent(id)); };
  const api = (method, url, body) => fetch(`http://127.0.0.1:${app.port}${url}`, { method, headers: { 'x-uc-token': app.token, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());

  // memory: mirrored into the vault, counted, searchable by agents, index file left out
  const mirror = path.join(project.vault.projectDir, 'Claude Code');
  assert.deepEqual(fs.readdirSync(mirror).sort(), ['Earlier sessions.md', 'deploy.md']);
  assert.match(fs.readFileSync(path.join(mirror, 'Earlier sessions.md'), 'utf8'), /\*\*Fix login bug\*\* — began with: “Fix the login bug please”/);
  let state = await api('GET', '/api/state');
  assert.equal(state.notes, 2);
  assert.equal(project.vault.search('staging pipeline')[0].kind, 'Claude Code');
  assert.equal(project.vault.read('deploy').kind, 'Claude Code');

  // sessions: listed right away, continuing one turns it into an agent that resumes that session
  assert.deepEqual(state.sessions.map((s) => s.id), [B, A, C]);
  const agent = await api('POST', '/api/agents', { sessionId: A });
  assert.equal(agent.name, 'Fix login bug');
  assert.deepEqual([startedWith[0].sessionId, startedWith[0].started, startedWith[0].imported], [A, true, true]);
  state = await api('GET', '/api/state');
  assert.deepEqual(state.sessions.map((s) => s.id), [B, C], 'a session that is open as an agent leaves the list');
  assert.equal((await api('POST', '/api/agents', { sessionId: A })).error, 'That session is not available any more.');
  assert.match(project.handleHook(agent.id, { hook_event_name: 'SessionStart' }).hookSpecificOutput.additionalContext, /Team protocol[\s\S]*deploy/, 'an imported session is told the team protocol and sees the notes');

  // the mirror follows the source: changed notes are refreshed, deleted ones disappear
  fs.rmSync(path.join(memory, 'deploy.md'));
  fs.writeFileSync(path.join(memory, 'style.md'), 'Tabs, not spaces.\n');
  await api('GET', '/api/notes');
  assert.deepEqual(fs.readdirSync(mirror).sort(), ['Earlier sessions.md', 'style.md']);

  await api('DELETE', `/api/agents/${agent.id}`);
  assert.deepEqual((await api('GET', '/api/state')).sessions.map((s) => s.id), [B, A, C], 'removing the agent puts its session back');
});

test('the map lists every folder Claude Code worked in, and only those can be opened', async (t) => {
  const { listAllProjects } = await import('../src/history.js');
  const here = tmp('here');
  const elsewhere = tmp('elsewhere');
  const E = '55555555-5555-4555-8555-555555555555';
  const F = '66666666-6666-4666-8666-666666666666';
  writeSession(here, F, [user('Plan the release', { cwd: here })], 3);
  writeSession(elsewhere, E, [user('Tidy up the docs', { cwd: elsewhere }), line({ type: 'ai-title', aiTitle: 'Docs cleanup' })], 60 * 24 * 40);

  const all = listAllProjects();
  const other = all.find((p) => p.dir === elsewhere);
  assert.equal(other.name, path.basename(elsewhere));
  assert.deepEqual(other.sessions.map((s) => s.title), ['Docs cleanup']);
  assert.ok(all.findIndex((p) => p.dir === here) < all.indexOf(other), 'most recently used folder first');

  const app = await startServer({ dir: here, vaultPath: tmp('v2') });
  t.after(() => app.close());
  const call = (method, url, body) => fetch(`http://127.0.0.1:${app.port}${url}`, { method, headers: { 'x-uc-token': app.token, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const { projects } = await (await call('GET', '/api/chats')).json();
  const mine = projects.find((p) => p.current);
  assert.equal(mine.dir, here);
  assert.equal(mine.sessions[0].title, 'Plan the release');
  assert.equal(projects.filter((p) => p.current).length, 1);
  assert.ok(!('cwd' in mine.sessions[0]));

  const refused = await call('POST', '/api/open-project', { dir: path.join(os.tmpdir(), 'uc-does-not-exist-4711') });
  assert.equal(refused.status, 400, 'a folder that does not exist cannot be opened');
  assert.equal((await refused.json()).error, 'That folder does not exist any more.');
});

test('the map can list the subfolders of any folder', async (t) => {
  const dir = tmp('dirs');
  for (const d of ['src', 'docs', '.git', '$Recycle.Bin', 'node_modules', 'Lib 10', 'Lib 9']) fs.mkdirSync(path.join(dir, d));
  fs.writeFileSync(path.join(dir, 'readme.md'), 'x');
  const app = await startServer({ dir: tmp('host'), vaultPath: tmp('v3') });
  t.after(() => app.close());
  const get = (p) => fetch(`http://127.0.0.1:${app.port}/api/dirs?path=${encodeURIComponent(p)}`, { headers: { 'x-uc-token': app.token } });
  assert.deepEqual((await (await get(dir)).json()).dirs, ['docs', 'Lib 9', 'Lib 10', 'src'], 'folders only, hidden ones left out, natural order');
  assert.equal((await get(path.join(dir, 'nope'))).status, 404);
  assert.equal((await get('relative/path')).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${app.port}/api/dirs?path=${encodeURIComponent(dir)}`)).status, 403, 'needs the token');
});