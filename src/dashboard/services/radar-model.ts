// What the presence radar shows. Pure functions (tests/radar-model.test.ts).
//
// The radar has no real positions: a contact's bearing and range come from a
// hash of its id, so every contact keeps its spot from scan to scan. People
// sit on the inner rings ("inside the house"), devices on the outer ones.

import type { Entity } from "./home-model";

export type ContactKind = "person" | "device" | "unknown";

export interface Contact {
  id: string;
  label: string;
  kind: ContactKind;
  bearing: number;   // degrees, 0 = north, clockwise
  range: number;     // 0 (centre) .. 1 (edge)
  since?: string;    // when the person came home / the device was first seen
  ip?: string;
}

export interface RadarEvent {
  t: number;
  type: "acquired" | "lost";
  kind: ContactKind;
  label: string;
}

/** FNV-1a, 32-bit: small and stable. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const BANDS: Record<ContactKind, [number, number]> = {
  person: [0.16, 0.42],
  unknown: [0.5, 0.68],
  device: [0.58, 0.93],
};

export function place(id: string, kind: ContactKind): { bearing: number; range: number } {
  const [lo, hi] = BANDS[kind];
  return {
    bearing: hash(id) % 360,
    range: lo + ((hash(`${id}#r`) % 1000) / 1000) * (hi - lo),
  };
}

const DAY = 86_400_000;

/**
 * Contacts for the scope: people who are home, and (optionally) devices that
 * are online. A device the router first saw less than a day ago is "unknown".
 */
/** `names`: your own device names (services/aliases), keyed by Wi-Fi address or router name. */
export function contacts(list: Entity[], opts: { devices: boolean; now?: number; names?: Record<string, string> }): Contact[] {
  const now = opts.now ?? Date.now();
  const people: Contact[] = list
    .filter((e) => e.entity_id.startsWith("person.") && e.state === "home")
    .map((e) => ({ id: e.entity_id, label: e.attributes.friendly_name || e.entity_id, kind: "person" as const, since: e.last_changed, ...place(e.entity_id, "person") }));
  if (!opts.devices) return people;
  const source = list.find((e) => Array.isArray(e.attributes.devices));
  const devices: Contact[] = ((source?.attributes.devices ?? []) as any[])
    .filter((d) => d && d.active && d.name && !/^(wl\d|eth\d|eppriv|wlguest)/i.test(d.name) && !String(d.mac ?? "").startsWith("_"))
    .map((d) => {
      const id = `dev:${d.mac || d.name}`;
      const fresh = d.first_seen && now - Date.parse(d.first_seen) < DAY;
      const kind: ContactKind = fresh ? "unknown" : "device";
      return { id, label: opts.names?.[d.mac || d.name] || String(d.name), kind, since: d.first_seen, ip: String(d.ip ?? "").includes(".") ? String(d.ip) : undefined, ...place(id, kind) };
    });
  return [...people, ...devices];
}

/** What changed between two scans. */
export function diff(before: Contact[], after: Contact[], t = Date.now()): RadarEvent[] {
  const was = new Map(before.map((c) => [c.id, c]));
  const now = new Map(after.map((c) => [c.id, c]));
  const events: RadarEvent[] = [];
  for (const c of after) if (!was.has(c.id)) events.push({ t, type: "acquired", kind: c.kind, label: c.label });
  for (const c of before) if (!now.has(c.id)) events.push({ t, type: "lost", kind: c.kind, label: c.label });
  return events;
}
