// Beside the radar scope: the contact list (what the scope shows, as text,
// so it is readable without the animation) and the event log.
import { h } from "../atoms/h";
import { pill } from "../atoms/badge";
import { button } from "../atoms/button";
import { card } from "../molecules/card";
import { empty } from "../molecules/empty";
import { ago } from "../services/home-model";
import { bearingText, ring, type Contact, type ContactKind } from "../services/radar-model";
import type { LogEntry } from "../services/radar";

const GLYPH: Record<ContactKind, string> = { person: "◆", device: "■", unknown: "▲" };
const IFF: Record<ContactKind, [string, "ok" | "off" | "warn"]> = { person: ["FRIEND", "ok"], device: ["KNOWN", "off"], unknown: ["UNKNOWN", "warn"] };

function contactRow(c: Contact): HTMLElement {
  return h("div", { class: `contact k-${c.kind}` },
    h("span", { class: "c-glyph", "aria-hidden": "true" }, GLYPH[c.kind]),
    h("span", { class: "c-text" },
      h("span", { class: "c-name" }, c.label),
      h("span", { class: "c-sub" }, `BRG ${bearingText(c.bearing)} · RING ${ring(c.range)}${c.kind === "person" && c.since ? ` · home ${ago(c.since)}` : ""}`)),
    pill(IFF[c.kind][0], IFF[c.kind][1]),
  );
}

export function contactsCard(list: Contact[]): HTMLElement {
  const people = list.filter((c) => c.kind === "person");
  const unknown = list.filter((c) => c.kind === "unknown");
  const devices = list.filter((c) => c.kind === "device");
  const section = (title: string, items: Contact[]) => items.length
    ? h("div", { class: "c-section" }, h("div", { class: "chip-title" }, `${title} · ${items.length}`), ...items.map(contactRow))
    : null;
  return card({ title: "Contacts", icon: "radar", aside: h("span", { class: "count" }, String(list.length)) },
    list.length
      ? h("div", { class: "contacts" }, section("Personnel", people), section("Unidentified", unknown), section("Devices", devices))
      : empty("No contacts. Nobody is home, or no data yet.", { icon: "radar" }),
  );
}

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function logCard(log: LogEntry[], onClear: () => void): HTMLElement {
  return card({ title: "Event log", icon: "clock", aside: log.length ? button("Clear", onClear) : null },
    log.length
      ? h("div", { class: "radar-log", role: "log", "aria-live": "polite" },
          ...log.slice(0, 60).map((e) => h("div", { class: `log-line l-${e.type}` },
            h("span", { class: "l-time" }, time(e.t)),
            h("span", { class: "l-type" }, e.type === "acquired" ? "ACQUIRED" : e.type === "lost" ? "LOST" : "INFO"),
            h("span", { class: "l-what" }, e.kind ? `${GLYPH[e.kind]} ${e.label}` : e.label),
          )))
      : empty("Contacts that appear or disappear are logged here.", { icon: "clock" }),
  );
}
