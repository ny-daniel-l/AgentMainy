// The radar's scan loop. Every `radarInterval` seconds it takes a snapshot of
// who and what is home, logs what appeared or disappeared since the last scan,
// and (active ping) asks the router sensor for a fresh list for the next scan.
// It keeps running while you look at other pages, so the log stays complete.

import { ha } from "./home-assistant";
import { routerSensorId } from "./home-model";
import { contacts, diff, type Contact, type ContactKind } from "./radar-model";
import { onSettings, settings } from "./settings";

export interface LogEntry {
  t: number;
  type: "acquired" | "lost" | "info";
  kind?: ContactKind;
  label: string;
}

const LOG_KEY = "am_radar_log";
let current: Contact[] = [];
let log: LogEntry[] = loadLog();
let scans = 0;
let timer: number | undefined;
let started = false;
const listeners = new Set<() => void>();

function loadLog(): LogEntry[] {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch { return []; }
}

function changed() {
  localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 100)));
  listeners.forEach((fn) => fn());
}

export function radarState() {
  return { contacts: current, log, scans };
}

/** One sweep: snapshot, compare, log, and request fresh data for the next one. */
export function scan(): void {
  const list = ha.entities();
  if (ha.status !== "online" || !list.length) return;
  const next = contacts(list, { devices: settings().radarDevices });
  const events = scans === 0
    ? [{ t: Date.now(), type: "info" as const, label: `Radar online · ${next.length} contact${next.length === 1 ? "" : "s"}` }]
    : diff(current, next);
  log = [...events.reverse(), ...log].slice(0, 100);
  current = next;
  scans++;
  if (settings().radarActivePing) {
    const id = routerSensorId(list);
    if (id) ha.call("homeassistant", "update_entity", { entity_id: id }).catch(() => {});
  }
  changed();
}

function restartTimer() {
  window.clearInterval(timer);
  timer = window.setInterval(scan, settings().radarInterval * 1000);
}

/** "Ping now": scan immediately and start the next interval from here. */
export function scanNow(): void {
  restartTimer();
  scan();
}

export function clearLog(): void {
  log = [];
  changed();
}

export function onScan(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function startRadar(): void {
  if (started) return;
  started = true;
  restartTimer();
  // First scan as soon as Home Assistant's entities are there.
  const off = ha.onChange(() => {
    if (scans === 0 && ha.status === "online" && ha.entities().length) { off(); scan(); }
  });
  let last = settings();
  onSettings((s) => {
    if (s.radarInterval !== last.radarInterval) restartTimer();
    if (s.radarDevices !== last.radarDevices && scans > 0) {
      // A different filter is not news: take the new view as the baseline.
      current = contacts(ha.entities(), { devices: s.radarDevices });
      changed();
    }
    last = s;
  });
}
