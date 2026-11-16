// The team engine (UltraClaude) from the dashboard's side: start / find /
// stop the server for a project folder (Rust: src-tauri/src/team.rs) and
// remember recent folders.

import { invoke } from "@tauri-apps/api/core";

const RECENT = "am_team_recent";
const CURRENT = "am_team_current";

export function recentFolders(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT) || "[]"); } catch { return []; }
}

export function currentFolder(): string | null {
  return localStorage.getItem(CURRENT);
}

function remember(folder: string) {
  const list = [folder, ...recentFolders().filter((f) => f !== folder)].slice(0, 6);
  localStorage.setItem(RECENT, JSON.stringify(list));
  localStorage.setItem(CURRENT, folder);
}

/** Starts (or reuses) the team for `folder`; resolves to its private URL. */
export async function openTeam(folder: string): Promise<string> {
  const url = await invoke<string>("team_open", { folder });
  remember(folder);
  return url;
}

/** URL of the team already running for `folder`, or null. */
export async function runningTeam(folder: string): Promise<string | null> {
  try { return await invoke<string | null>("team_status", { folder }); } catch { return null; }
}

/** Stops the team and all its agents. */
export async function stopTeam(folder: string): Promise<void> {
  await invoke("team_stop", { folder });
  if (currentFolder() === folder) localStorage.removeItem(CURRENT);
}

export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
