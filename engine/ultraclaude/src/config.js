// User-wide settings in ~/.ultraclaude/config.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME_DIR = path.join(os.homedir(), '.ultraclaude');
const FILE = path.join(HOME_DIR, 'config.json');

export function loadConfig() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* no config yet */ }
  const config = { vaultPath: path.join(os.homedir(), 'UltraClaudeVault'), ...saved };
  if (process.env.ULTRACLAUDE_VAULT) config.vaultPath = process.env.ULTRACLAUDE_VAULT;
  return config;
}

export function saveConfig(patch) {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* no config yet */ }
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ ...saved, ...patch }, null, 2));
}
