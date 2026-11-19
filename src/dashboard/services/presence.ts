// Who is home, as people rather than a bare count. Pure (tests/presence.test.ts).
//
// Home Assistant marks a person away when their phone is off the home Wi-Fi
// for a while, and a locked iPhone does that now and then. So a short absence
// is shown as "phone asleep?" instead of a hard "away".
//
// "Since when" comes from the recorder history, not from last_changed: Home
// Assistant resets last_changed on every restart.

import type { Entity } from "./home-model";

export interface Presence {
  id: string;
  name: string;
  home: boolean;
  since?: number;       // when they came home / left (ms), undefined = not in the history window
  maybeAsleep: boolean; // away for less than ASLEEP_MIN minutes
}

// on top of the 10 minutes Home Assistant already waits before "away"
const ASLEEP_MIN = 15;

/** The time of the last real change: the newest row whose state differs from the one before it. */
export function lastChange(rows: { t: number; s: string }[]): number | undefined {
  for (let i = rows.length - 1; i > 0; i--) if (rows[i].s !== rows[i - 1].s) return rows[i].t;
  return undefined;
}

/** `changed`: lastChange() per person id, from the history. */
export function presence(list: Entity[], changed: Record<string, number | undefined>, now = Date.now()): Presence[] {
  return list
    .filter((e) => e.entity_id.startsWith("person."))
    .map((e) => {
      const home = e.state === "home";
      const since = changed[e.entity_id];
      return { id: e.entity_id, name: e.attributes.friendly_name || e.entity_id, home, since,
        maybeAsleep: !home && since !== undefined && now - since < ASLEEP_MIN * 60_000 };
    })
    .sort((a, b) => Number(b.home) - Number(a.home) || a.name.localeCompare(b.name));
}

/** "since 19:27" today, "since Tue 19:27" this week, else "since 12 Nov". */
export function sinceText(t: number | undefined, now = Date.now()): string {
  if (t === undefined || !Number.isFinite(t)) return "";
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === new Date(now).toDateString()) return `since ${time}`;
  if (now - t < 6 * 86_400_000) return `since ${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return `since ${d.toLocaleDateString([], { day: "numeric", month: "short" })}`;
}
