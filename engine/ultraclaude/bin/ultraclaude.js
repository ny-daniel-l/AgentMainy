#!/usr/bin/env node
// `ultraclaude` — opens the UltraClaude window for the folder you are in.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig } from '../src/config.js';
import { codeVersion } from '../src/version.js';

const SERVER = fileURLToPath(new URL('../src/server.js', import.meta.url));
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('-')));
const [command, ...rest] = args.filter((a) => !a.startsWith('-'));
const dir = process.cwd();
const dataDir = path.join(dir, '.ultraclaude');
const infoFile = path.join(dataDir, 'server.json');

const HELP = `UltraClaude — a team of Claude Code agents with shared Obsidian memory

  ultraclaude               Open the window for the current folder (starts the server if needed)
  ultraclaude stop          Stop the server and all agents of this folder
  ultraclaude status        Show whether a server is running for this folder
  ultraclaude vault [path]  Show or change the Obsidian vault
  ultraclaude help          Show this help

  --no-open                 Start the server without opening a window`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function running() {
  let info;
  try { info = JSON.parse(fs.readFileSync(infoFile, 'utf8')); } catch { return null; }
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/api/ping`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const ping = await res.json().catch(() => ({}));
    return { ...info, version: ping.version }; // servers from before version 0.2 report none
  } catch {
    return null;
  }
}

/** Replaces a server that runs older code. Agents that were running continue their sessions in the new one. */
async function replace(info) {
  const base = `http://127.0.0.1:${info.port}`;
  const headers = { 'x-uc-token': info.token };
  let runningIds = [];
  try {
    const state = await (await fetch(`${base}/api/state`, { headers })).json();
    runningIds = state.agents.filter((a) => a.state !== 'stopped').map((a) => a.id);
  } catch { /* nothing to carry over */ }
  await fetch(`${base}/api/shutdown`, { method: 'POST', headers }).catch(() => {});
  for (let i = 0; i < 60 && await running(); i++) await sleep(250);
  await sleep(500);
  if (!runningIds.length) return;
  const file = path.join(dataDir, 'state.json');
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const a of state.agents) if (runningIds.includes(a.id)) a.resumeOnStart = true;
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
  } catch { /* the agents can be started by hand */ }
}

function openWindow(url) {
  const candidates = process.platform === 'win32' ? [
    `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  const browser = candidates.find((c) => c && fs.existsSync(c));
  // A Chromium browser gives a clean app window; otherwise fall back to the default browser.
  const [cmd, cmdArgs] = browser ? [browser, [`--app=${url}`, '--window-size=1500,950']]
    : process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' }).unref();
}

async function open() {
  let info = await running();
  if (info && info.version !== codeVersion()) {
    console.log('UltraClaude was updated. Restarting it for this folder; running agents continue their sessions.');
    await replace(info);
    info = null;
  }
  if (!info) {
    fs.mkdirSync(dataDir, { recursive: true });
    try { fs.unlinkSync(infoFile); } catch { /* no stale file */ }
    const log = fs.openSync(path.join(dataDir, 'server.log'), 'a');
    spawn(process.execPath, [SERVER, '--dir', dir, '--background'], { detached: true, stdio: ['ignore', log, log], windowsHide: true, cwd: dir }).unref();
    for (let i = 0; i < 60 && !info; i++) {
      await new Promise((r) => setTimeout(r, 250));
      info = await running();
    }
    if (!info) {
      console.error(`The server did not start. See ${path.join(dataDir, 'server.log')}`);
      process.exit(1);
    }
    console.log(`UltraClaude is running for ${dir}`);
  } else {
    console.log(`UltraClaude is already running for ${dir}`);
  }
  console.log(info.url);
  if (!flags.has('--no-open')) openWindow(info.url);
}

if (flags.has('-h') || flags.has('--help') || command === 'help') {
  console.log(HELP);
} else if (!command || command === 'open') {
  await open();
} else if (command === 'stop') {
  const info = await running();
  if (!info) console.log('UltraClaude is not running for this folder.');
  else {
    await fetch(`http://127.0.0.1:${info.port}/api/shutdown`, { method: 'POST', headers: { 'x-uc-token': info.token } }).catch(() => {});
    console.log('UltraClaude stopped.');
  }
} else if (command === 'status') {
  const info = await running();
  console.log(info ? `Running: ${info.url}` : 'UltraClaude is not running for this folder.');
} else if (command === 'vault') {
  if (rest[0]) {
    const vaultPath = path.resolve(rest.join(' '));
    saveConfig({ vaultPath });
    console.log(`Vault set to ${vaultPath}\nApplies the next time a project starts (ultraclaude stop, then ultraclaude).`);
  } else {
    console.log(loadConfig().vaultPath);
  }
} else {
  console.error(`Unknown command: ${command}\n\n${HELP}`);
  process.exit(1);
}
