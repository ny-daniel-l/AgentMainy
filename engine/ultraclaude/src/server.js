// Local web server: UI, REST API, terminal WebSocket, MCP endpoint and hook endpoint.
// Only listens on 127.0.0.1 and every non-static route needs the per-server token.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Project } from './project.js';
import { ROLES } from './roles.js';
import { KNOWLEDGE } from './vault.js';
import { claudeProjectDir, listAllProjects } from './history.js';
import { codeVersion } from './version.js';
import { handleMcp } from './mcp.js';
import { loadConfig } from './config.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const font = (family, weight) => `node_modules/@fontsource/ibm-plex-${family}/files/ibm-plex-${family}-latin-${weight}-normal.woff2`;
const VENDOR = {
  '/vendor/xterm.js': 'node_modules/@xterm/xterm/lib/xterm.js',
  '/vendor/xterm.css': 'node_modules/@xterm/xterm/css/xterm.css',
  '/vendor/addon-fit.js': 'node_modules/@xterm/addon-fit/lib/addon-fit.js',
  '/vendor/plex-sans-400.woff2': font('sans', 400),
  '/vendor/plex-sans-500.woff2': font('sans', 500),
  '/vendor/plex-sans-600.woff2': font('sans', 600),
  '/vendor/plex-mono-400.woff2': font('mono', 400),
  '/vendor/plex-mono-500.woff2': font('mono', 500),
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('The image is too large.')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function openExternal(target) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '', target]]
    : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

/** Whether Obsidian already knows a vault that contains `dir` (only then can we deep-link into it). */
function knownToObsidian(dir) {
  const configDir = process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'obsidian')
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'obsidian')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'obsidian');
  try {
    const { vaults = {} } = JSON.parse(fs.readFileSync(path.join(configDir, 'obsidian.json'), 'utf8'));
    const norm = (p) => path.resolve(p).toLowerCase();
    return Object.values(vaults).some((v) => v.path && (norm(dir) === norm(v.path) || norm(dir).startsWith(norm(v.path) + path.sep)));
  } catch {
    return false;
  }
}

export async function startServer({ dir, port = 0, vaultPath = loadConfig().vaultPath, autoExit = false } = {}) {
  const project = new Project({ dir, vaultPath });
  const token = crypto.randomBytes(18).toString('hex');
  const version = process.env.ULTRACLAUDE_TEST_VERSION || codeVersion(); // the code this server runs
  const clients = new Set();
  const broadcast = (msg) => {
    const data = JSON.stringify(msg);
    for (const ws of clients) if (ws.readyState === 1) ws.send(data);
  };
  const noteCount = () => project.vault.list(KNOWLEDGE).length;

  project.on('agents', (agents) => broadcast({ t: 'agents', agents }));
  project.on('tasks', (tasks) => broadcast({ t: 'tasks', tasks }));
  project.on('event', (e) => broadcast({ t: 'event', e }));
  project.on('notes', () => broadcast({ t: 'notes', count: noteCount() }));
  project.on('pty', (id, d) => broadcast({ t: 'out', id, d }));
  project.on('sessions', () => broadcast({ t: 'sessions', sessions: project.sessions() }));

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    project.stopAll();
    project.saveNow();
    for (const ws of clients) ws.terminate();
    try { fs.unlinkSync(path.join(project.dataDir, 'server.json')); } catch { /* not written */ }
    await new Promise((r) => server.close(r));
  };

  async function api(req, res, url) {
    const route = `${req.method} ${url.pathname}`;
    const paste = req.method === 'POST' && /^\/api\/agents\/([^/]+)\/paste-image$/.exec(url.pathname);
    if (paste) {
      if (!project.agent(paste[1])) return send(res, 404, { error: 'Agent not found' });
      const file = project.pasteImage(paste[1], await readRaw(req, 25_000_000), req.headers['content-type']);
      return send(res, 200, { path: file });
    }
    const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
    // files and folders of the vault, edited by the person in the Memory view
    const changed = (text, extra = {}) => { project.emit('notes'); project.event('memory', 'user', text, { op: 'write', ...extra }); };
    const label = (p) => `“${String(p).split('/').pop().replace(/\.md$/i, '')}”`;
    if (route === 'GET /api/tree') return send(res, 200, { tree: project.vault.tree(), project: project.vault.rel(project.vault.projectDir) });
    if (route === 'GET /api/file') return send(res, 200, project.vault.readRaw(url.searchParams.get('path')));
    if (route === 'POST /api/file') { const r = project.vault.saveRaw(body.path, body.content, { create: true }); changed(`wrote ${label(r.path)} into memory`, { path: r.path }); return send(res, 200, r); }
    if (route === 'PUT /api/file') { const r = project.vault.saveRaw(body.path, body.content); changed(`edited ${label(r.path)} in memory`, { path: r.path }); return send(res, 200, r); }
    if (route === 'POST /api/file/move') { const r = project.vault.move(body.from, body.to); changed(`moved ${label(body.from)} to ${r.path}`, { path: r.path }); return send(res, 200, r); }
    if (route === 'POST /api/file/copy') { const r = project.vault.copy(body.from, body.to); changed(`copied ${label(body.from)} to ${r.path}`, { path: r.path }); return send(res, 200, r); }
    if (route === 'DELETE /api/file') { const r = project.vault.remove(url.searchParams.get('path')); changed(`deleted ${label(r.path)} from memory`); return send(res, 200, r); }
    if (route === 'POST /api/folder') { const r = project.vault.makeFolder(body.path); changed(`made the folder ${r.path} in memory`); return send(res, 200, r); }
    const idMatch = /^\/api\/(agents|tasks)\/([^/]+)(?:\/(start|stop))?$/.exec(url.pathname);

    if (route === 'GET /api/state') {
      project.syncClaudeCode();
      return send(res, 200, {
        project: { name: project.name, dir: project.dir, vault: project.vault.root, inObsidian: knownToObsidian(project.vault.root) },
        roles: ROLES.map(({ prompt, ...r }) => r),
        agents: project.views(), tasks: project.state.tasks, events: project.events.slice(-150), notes: noteCount(), sessions: project.sessions(),
        version, latest: codeVersion(),
      });
    }
    if (route === 'POST /api/agents') return send(res, 200, project.createAgent(body));
    if (idMatch?.[1] === 'agents') {
      const id = idMatch[2];
      if (!project.agent(id)) return send(res, 404, { error: 'Agent not found' });
      if (req.method === 'POST' && idMatch[3] === 'start') { await project.startAgent(id, body); return send(res, 200, { ok: true }); }
      if (req.method === 'POST' && idMatch[3] === 'stop') { project.stopAgent(id); return send(res, 200, { ok: true }); }
      if (req.method === 'DELETE') { project.removeAgent(id); return send(res, 200, { ok: true }); }
    }
    if (route === 'POST /api/message') return send(res, 200, { result: project.sendMessage('user', body.to, body.text) });
    if (route === 'POST /api/tasks') return send(res, 200, project.createTask('user', body));
    if (idMatch?.[1] === 'tasks') {
      if (req.method === 'PATCH') return send(res, 200, project.updateTask('user', idMatch[2], body));
      if (req.method === 'DELETE') { project.deleteTask(idMatch[2]); return send(res, 200, { ok: true }); }
    }
    if (route === 'GET /api/chats') {
      // every Claude Code chat on this computer, by folder, for the map behind the "ultraclaude" mark
      const here = path.basename(claudeProjectDir(project.dir));
      const open = new Set(project.state.agents.map((a) => a.sessionId));
      const projects = listAllProjects().map((pr) => ({
        ...pr,
        dir: pr.key === here ? project.dir : pr.dir,
        name: pr.key === here ? project.name : pr.name,
        current: pr.key === here,
        sessions: pr.sessions.map(({ cwd, ...s }) => ({ ...s, open: pr.key === here && open.has(s.id) })),
      }));
      return send(res, 200, { projects });
    }
    if (route === 'GET /api/dirs') {
      // the subfolders of one folder, for the map; hidden and system folders and dependency folders are left out
      const dir = String(url.searchParams.get('path') || '');
      if (!path.isAbsolute(dir) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return send(res, 404, { error: 'That folder does not exist.' });
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return send(res, 200, { dirs: [], unreadable: true }); }
      const skip = /^[.$]|^(System Volume Information|node_modules|__pycache__)$/i;
      const dirs = entries.filter((e) => e.isDirectory() && !skip.test(e.name)).map((e) => e.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(0, 500);
      return send(res, 200, { dirs });
    }
    if (route === 'POST /api/open-project') {
      // starts (or shows) UltraClaude for another folder, in its own window
      const dir = String(body.dir || '');
      if (!path.isAbsolute(dir) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return send(res, 400, { error: 'That folder does not exist any more.' });
      spawn(process.execPath, [path.join(ROOT, 'bin', 'ultraclaude.js')], { cwd: dir, detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return send(res, 200, { ok: true });
    }
    if (route === 'GET /api/notes') { project.syncClaudeCode(); return send(res, 200, project.vault.list()); }
    if (route === 'GET /api/note') {
      const note = project.vault.read(url.searchParams.get('path'));
      return note ? send(res, 200, note) : send(res, 404, { error: 'Note not found' });
    }
    if (route === 'POST /api/open-obsidian') {
      // Obsidian can only open paths inside a vault it already knows; otherwise show the folder to pick.
      const known = knownToObsidian(project.vault.root);
      const target = body.path ? project.vault.abs(body.path) : project.vault.projectDir;
      openExternal(known ? `obsidian://open?path=${encodeURIComponent(target)}` : project.vault.root);
      return send(res, 200, { known });
    }
    if (route === 'POST /api/open-vault-folder') { openExternal(project.vault.root); return send(res, 200, { ok: true }); }
    if (route === 'POST /api/restart') {
      // The command line notices that this server is out of date, restarts it with the new code,
      // lets the running agents continue their sessions and opens a new window.
      spawn(process.execPath, [path.join(ROOT, 'bin', 'ultraclaude.js')], { cwd: project.dir, detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return send(res, 200, { ok: true });
    }
    if (route === 'POST /api/shutdown') {
      send(res, 200, { ok: true });
      return void setTimeout(() => close().then(() => process.exit(0)), 100);
    }
    return send(res, 404, { error: 'Not found' });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const host = (req.headers.host || '').split(':')[0];
      if (!['127.0.0.1', 'localhost'].includes(host)) return send(res, 403, { error: 'Forbidden' });
      const url = new URL(req.url, 'http://127.0.0.1');
      const parts = url.pathname.split('/').filter(Boolean);

      if (parts[0] === 'hook' || parts[0] === 'mcp') {
        if (parts[1] !== token) return send(res, 403, { error: 'Forbidden' });
        if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
        const body = await readBody(req);
        const out = parts[0] === 'hook' ? project.handleHook(parts[2], body) : handleMcp(project, parts[2], body);
        return out ? send(res, 200, out) : send(res, parts[0] === 'mcp' ? 202 : 200);
      }
      if (parts[0] === 'api') {
        if (url.pathname === '/api/ping') return send(res, 200, { ok: true, dir: project.dir, version });
        if (req.headers['x-uc-token'] !== token) return send(res, 403, { error: 'Forbidden' });
        return await api(req, res, url);
      }
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      const file = VENDOR[url.pathname] ? path.join(ROOT, VENDOR[url.pathname])
        : path.join(PUBLIC, path.normalize(url.pathname === '/' ? 'index.html' : url.pathname).replace(/^([/\\]|\.\.)+/, ''));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'Not found' });
      const isFont = file.endsWith('.woff2');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': isFont ? 'max-age=604800' : 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      if (!res.headersSent) send(res, 400, { error: err.message });
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const host = (req.headers.host || '').split(':')[0];
    if (url.pathname !== '/ws' || url.searchParams.get('t') !== token || !['127.0.0.1', 'localhost'].includes(host)) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      for (const [id, r] of project.runtime) if (r.buffer) ws.send(JSON.stringify({ t: 'replay', id, d: r.buffer }));
      ws.on('message', (raw) => {
        let m;
        try { m = JSON.parse(raw); } catch { return; }
        if (m.t === 'in') project.write(m.id, m.d);
        else if (m.t === 'resize') project.resize(m.id, m.cols, m.rows);
      });
      ws.on('close', () => clients.delete(ws));
    });
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const actualPort = server.address().port;
  project.endpoint = { port: actualPort, token };
  // Agents that were running when the previous server was replaced by an update continue right away.
  const resume = project.state.agents.filter((a) => a.resumeOnStart);
  for (const a of resume) {
    delete a.resumeOnStart;
    project.startAgent(a.id).catch((err) => project.event('error', a.name, `failed to start: ${err.message}`));
  }
  if (resume.length) project.save();
  const info = { port: actualPort, token, pid: process.pid, url: `http://127.0.0.1:${actualPort}/?t=${token}` };
  fs.writeFileSync(path.join(project.dataDir, 'server.json'), JSON.stringify(info));

  if (autoExit) {
    // Stop the background server once the window is closed and no agent is running any more.
    let idleSince = Date.now();
    setInterval(() => {
      if (clients.size || project.running()) idleSince = Date.now();
      else if (Date.now() - idleSince > 60_000) close().then(() => process.exit(0));
    }, 10_000).unref();
  }

  return { ...info, project, close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  if (process.platform === 'win32' && process.argv.includes('--background') && !process.argv.includes('--has-console')) {
    // Started in the background, this process has no console at all. On Windows every helper
    // it launches (where.exe, node-pty's process lister) would then pop up its own terminal
    // window for a moment. So run the real server as a child that owns one hidden console,
    // which all of its helpers inherit.
    const child = spawn(process.execPath, [...process.argv.slice(1), '--has-console'], { stdio: 'inherit', windowsHide: true });
    child.on('exit', (code) => process.exit(code ?? 0));
  } else {
    const app = await startServer({ dir: arg('--dir') || process.cwd(), autoExit: true });
    console.log(`UltraClaude server for ${app.project.dir} on ${app.url}`);
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
  }
}
