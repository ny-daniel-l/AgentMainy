// Pasting an image: it is saved in the project and its path is typed into the agent's prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `uc-${name}-`));
process.env.CLAUDE_CONFIG_DIR = tmp('claude');
const { startServer } = await import('../src/server.js');

test('image paste is saved and typed into the prompt as a bracketed paste', async (t) => {
  const dir = tmp('proj');
  const app = await startServer({ dir, vaultPath: tmp('v') });
  t.after(() => app.close());
  const { project } = app;
  project.startAgent = async () => {};
  const agent = project.createAgent({ roleId: 'tester' });
  const typed = [];
  const post = (id, body, type) => fetch(`http://127.0.0.1:${app.port}/api/agents/${id}/paste-image`, { method: 'POST', headers: { 'x-uc-token': app.token, 'content-type': type }, body });
  const png = Buffer.from('89504e470d0a1a0a', 'hex');

  let res = await post(agent.id, png, 'image/png');
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'The agent is not running.');

  project.runtime.get(agent.id).pty = { write: (d) => typed.push(d) };
  res = await post(agent.id, png, 'image/png');
  assert.equal(res.status, 200);
  const { path: file } = await res.json();
  assert.equal(path.dirname(file), path.join(dir, '.ultraclaude', 'pasted'));
  assert.deepEqual(fs.readFileSync(file), png);
  assert.deepEqual(typed, [`\x1b[200~${file}\x1b[201~ `]);

  assert.equal((await post(agent.id, 'x', 'text/html')).status, 400, 'only images are accepted');
  assert.equal((await post(agent.id, Buffer.alloc(0), 'image/png')).status, 400, 'an empty image is refused');
  assert.equal((await post('nope', png, 'image/png')).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${app.port}/api/agents/${agent.id}/paste-image`, { method: 'POST', body: png })).status, 403, 'needs the token');
  assert.equal(typed.length, 1, 'refused pastes type nothing');
});
