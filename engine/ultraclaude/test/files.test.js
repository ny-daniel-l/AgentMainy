// Editing the vault by hand: notes and folders can be made, edited, moved, copied and deleted,
// paths stay inside the vault, and the folders UltraClaude rewrites itself stay read-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `uc-${name}-`));
process.env.CLAUDE_CONFIG_DIR = tmp('claude');
const { startServer } = await import('../src/server.js');

test('notes and folders can be managed from the Memory view', async (t) => {
  const vault = tmp('vault');
  const app = await startServer({ dir: tmp('proj'), vaultPath: vault });
  t.after(() => app.close());
  const { project } = app;
  const mem = `${project.vault.rel(project.vault.projectDir)}/Memory`;
  const call = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${app.port}${url}`, { method, headers: { 'x-uc-token': app.token, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, ...(await res.json()) };
  };
  const file = (rel) => path.join(vault, ...rel.split('/'));

  // a new note gets frontmatter and is found by the agents' search right away
  let r = await call('POST', '/api/file', { path: `${mem}/Release checklist`, content: '# Release checklist\n\n- bump the version\n- tag it' });
  assert.equal(r.path, `${mem}/Release checklist.md`);
  assert.match(fs.readFileSync(file(r.path), 'utf8'), /^---\ncreated: .+\nupdated: .+\nauthors: \[user\]\n---\n\n# Release checklist/);
  assert.equal(project.vault.search('bump version')[0].title, 'Release checklist');
  assert.equal((await call('POST', '/api/file', { path: `${mem}/Release checklist.md`, content: 'x' })).status, 400, 'no silent overwrite');

  // editing keeps the frontmatter and moves its "updated" stamp
  const raw = (await call('GET', `/api/file?path=${encodeURIComponent(r.path)}`)).content;
  r = await call('PUT', '/api/file', { path: r.path, content: raw.replace('updated:', 'updated: 1999-01-01 00:00 #').replace('tag it', 'tag it and push') });
  const edited = fs.readFileSync(file(r.path), 'utf8');
  assert.match(edited, /tag it and push/);
  assert.doesNotMatch(edited, /1999/);

  // folders, moving, copying, deleting
  assert.equal((await call('POST', '/api/folder', { path: `${mem}/Releases` })).status, 200);
  r = await call('POST', '/api/file/move', { from: `${mem}/Release checklist.md`, to: `${mem}/Releases/Checklist` });
  assert.equal(r.path, `${mem}/Releases/Checklist.md`);
  assert.ok(fs.existsSync(file(r.path)) && !fs.existsSync(file(`${mem}/Release checklist.md`)));
  assert.equal((await call('POST', '/api/file/copy', { from: r.path })).path, `${mem}/Releases/Checklist copy.md`);
  assert.equal((await call('POST', '/api/file/copy', { from: r.path })).path, `${mem}/Releases/Checklist copy 2.md`);
  assert.equal((await call('DELETE', `/api/file?path=${encodeURIComponent(`${mem}/Releases`)}`)).status, 400, 'a folder with notes in it stays');
  for (const n of ['Checklist', 'Checklist copy', 'Checklist copy 2']) assert.equal((await call('DELETE', `/api/file?path=${encodeURIComponent(`${mem}/Releases/${n}.md`)}`)).status, 200);
  r = await call('POST', '/api/file/move', { from: `${mem}/Releases`, to: `${mem}/Shipped` });
  assert.ok(fs.existsSync(file(`${mem}/Shipped`)), 'folders can be renamed');
  assert.equal((await call('POST', '/api/file/move', { from: `${mem}/Shipped`, to: `${mem}/Shipped/Inner` })).status, 400, 'not into itself');
  assert.equal((await call('DELETE', `/api/file?path=${encodeURIComponent(`${mem}/Shipped`)}`)).status, 200, 'an empty folder can go');

  // the tree shows folders first and marks what UltraClaude manages itself
  const { tree } = await call('GET', '/api/tree');
  const find = (nodes, p) => { for (const n of nodes) { if (n.path === p) return n; const hit = find(n.children || [], p); if (hit) return hit; } return undefined; };
  assert.equal(find(tree, mem).type, 'dir');
  assert.equal(find(tree, `${project.vault.rel(project.vault.projectDir)}/Tasks`).readOnly, true);
  assert.equal(find(tree, 'Home.md').type, 'file');
  assert.ok(!tree.some((n) => n.name.startsWith('.')), '.obsidian is hidden');

  // nothing outside the vault, nothing in the managed folders, no odd names
  for (const bad of ['../outside', '..\\outside', `${mem}/../../../../x`, '.obsidian/app', `${mem}/a:b`, '']) {
    assert.equal((await call('POST', '/api/file', { path: bad, content: 'x' })).status, 400, bad);
  }
  const managed = await call('POST', '/api/file', { path: `${project.vault.rel(project.vault.projectDir)}/Agents/Mine`, content: 'x' });
  assert.equal(managed.status, 400);
  assert.match(managed.error, /keeps this folder up to date/);
  assert.equal((await call('PUT', '/api/file', { path: `${mem}/Gone.md`, content: 'x' })).status, 400, 'editing a deleted note does not recreate it');
  assert.ok(!fs.existsSync(path.join(path.dirname(vault), 'outside.md')));
});
