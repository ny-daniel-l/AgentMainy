// AgentMainy's own settings (the Settings page), kept in localStorage.
// The original AgentPet settings keep their own ap_* keys.

export type RadarColor = "phosphor" | "cyan" | "amber" | "violet";
export type Accent = "violet" | "blue" | "green" | "amber" | "rose";

export interface Settings {
  radarInterval: number;      // seconds per sweep = one ping
  radarColor: RadarColor;
  radarAfterglow: number;     // seconds a blip stays lit after the sweep
  radarLabels: boolean;
  radarDevices: boolean;      // show devices, not only people
  radarSound: boolean;
  radarVolume: number;        // 0..1
  radarActivePing: boolean;   // ask the router for a fresh list on every ping
  tempWarn: number;           // °C where the Pi's temperature turns amber
  tempUnit: "C" | "F";
  accent: Accent;
  reduceMotion: boolean;
  startPage: string;
}

export const DEFAULTS: Settings = {
  radarInterval: 10,
  radarColor: "phosphor",
  radarAfterglow: 6,
  radarLabels: true,
  radarDevices: true,
  radarSound: false,
  radarVolume: 0.35,
  radarActivePing: true,
  tempWarn: 65,
  tempUnit: "C",
  accent: "violet",
  reduceMotion: false,
  startPage: "overview",
};

const KEY = "am_settings";
let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

function load(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...DEFAULTS }; }
}

export function settings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  localStorage.setItem(KEY, JSON.stringify(current));
  listeners.forEach((fn) => fn(current));
}

export function resetSettings(): void {
  localStorage.removeItem(KEY);
  current = { ...DEFAULTS };
  listeners.forEach((fn) => fn(current));
}

export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Radar colour themes: the sweep, blips and grid. */
export const RADAR_COLORS: Record<RadarColor, string> = {
  phosphor: "#3dff8f",
  cyan: "#3fe3ff",
  amber: "#ffb547",
  violet: "#a594ff",
};

/** Accent pairs for the dashboard's gradient. */
export const ACCENTS: Record<Accent, [string, string]> = {
  violet: ["#7c6cff", "#3fa8ff"],
  blue: ["#3f7bff", "#3fd0ff"],
  green: ["#22c38e", "#3fb8ff"],
  amber: ["#f59e0b", "#f97366"],
  rose: ["#f0568a", "#a66bff"],
};

export function formatTemp(celsius: number, unit = current.tempUnit): string {
  return unit === "F" ? `${Math.round(celsius * 1.8 + 32)} °F` : `${celsius.toFixed(1)} °C`;
}
