// Your own names for devices ("Miele-001D63…" → "Washing machine"), and the
// new devices you marked as yours. Kept in this app only, keyed by the
// device's Wi-Fi address (or its name when the router gives none).

const NAMES = "am_aliases";
const MINE = "am_known_devices";

const read = <T>(key: string, empty: T): T => {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? empty; } catch { return empty; }
};

export const deviceKey = (d: { mac?: string; name: string }) => d.mac || d.name;

export function aliases(): Record<string, string> {
  return read<Record<string, string>>(NAMES, {});
}

/** An empty name removes the alias. */
export function setAlias(key: string, name: string) {
  const all = aliases();
  if (name.trim()) all[key] = name.trim();
  else delete all[key];
  localStorage.setItem(NAMES, JSON.stringify(all));
}

export function mine(): Set<string> {
  return new Set(read<string[]>(MINE, []));
}

export function markMine(key: string) {
  localStorage.setItem(MINE, JSON.stringify([...mine(), key]));
}
