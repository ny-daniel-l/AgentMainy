// The House page: the door (locks, contacts, battery, last action) and the
// appliances (running ones first, with program and end time).
import { h } from "../atoms/h";
import { icon } from "../atoms/icon";
import { pill, type Tone } from "../atoms/badge";
import { button, confirmButton } from "../atoms/button";
import { card } from "../molecules/card";
import { row, rows } from "../molecules/row";
import { empty } from "../molecules/empty";
import { act } from "./ha-ui";
import * as model from "../services/home-model";
import type { Entity } from "../services/home-model";

const LOCK_TONE: Record<string, Tone> = { locked: "ok", unlocked: "warn", open: "warn", jammed: "bad", locking: "info", unlocking: "info", opening: "info" };

const UNKNOWN = ["unknown", "unavailable"];

function lockRow(list: Entity[], l: Entity, only: boolean): HTMLElement {
  const d = model.lockDetails(list, l.entity_id);
  return row({
    lead: icon(l.state === "locked" ? "lock" : "unlock"),
    title: only ? "Lock" : model.nameOf(l),
    sub: [d.lastAction && `last: ${d.lastAction}`, d.battery && `battery ${d.battery}`, model.ago(l.last_changed)].filter(Boolean).join(" · "),
    trail: h("span", { class: "trail-stack" },
      pill(l.state, LOCK_TONE[l.state] ?? "off"),
      l.state === "locked"
        ? confirmButton("Unlock", "Click again to unlock", () => act("lock", "unlock", { entity_id: l.entity_id }, {}, "Unlocking…"), { icon: "unlock" })
        : button("Lock", () => act("lock", "lock", { entity_id: l.entity_id }, {}, "Locking…"), { icon: "lock", variant: "primary" }),
    ),
  });
}

export function doorCard(list: Entity[]): HTMLElement {
  const locks = model.locks(list);
  const doors = model.doors(list);
  // "secure" only when every lock is locked AND every door sensor says closed
  const jammed = locks.some((l) => l.state === "jammed");
  const lockUnknown = locks.some((l) => UNKNOWN.includes(l.state));
  const moving = locks.some((l) => ["locking", "unlocking", "opening"].includes(l.state));
  const unlocked = locks.some((l) => ["unlocked", "open"].includes(l.state));
  const open = doors.some((d) => d.state === "on");
  const doorUnknown = doors.some((d) => UNKNOWN.includes(d.state));
  const status = !locks.length && !doors.length ? null
    : jammed ? pill("lock jammed", "bad")
    : open ? pill("door open", "warn")
    : lockUnknown ? pill("lock state unknown", "warn")
    : moving ? pill(locks.find((l) => l.state.endsWith("ing"))!.state + "…", "info")
    : unlocked ? pill("unlocked", "warn")
    : doorUnknown ? pill(locks.length ? "locked · door state unknown" : "door state unknown", "warn")
    : pill(doors.length ? "secure" : "locked", "ok");
  return card({ title: "Door & security", icon: "door", aside: status },
    locks.length || doors.length
      ? rows([
          ...locks.map((l) => lockRow(list, l, locks.length === 1)),
          ...doors.map((d) => row({
            lead: icon("door"),
            title: doors.length === 1 ? "Door sensor" : model.nameOf(d),
            sub: UNKNOWN.includes(d.state) ? `no report from the sensor · ${model.ago(d.last_changed)}` : model.ago(d.last_changed),
            trail: pill(d.state === "on" ? "open" : d.state === "off" ? "closed" : d.state, d.state === "on" ? "warn" : d.state === "off" ? "ok" : "off"),
          })),
        ])
      : empty("No lock or door sensor in Home Assistant yet.", { icon: "door" }),
  );
}

export function appliancesCard(list: Entity[]): HTMLElement {
  const all = model.appliances(list);
  const running = all.filter((a) => a.running).length;
  return card({ title: "Appliances", icon: "cook", aside: all.length ? pill(running ? `${running} running` : "all idle", running ? "ok" : "off") : null },
    all.length
      ? rows(all.map((a) => row({
          lead: icon("cook"),
          title: a.name,
          sub: a.running ? [a.program, a.ends && `ends ${a.ends}`].filter(Boolean).join(" · ") || undefined : undefined,
          trail: pill(a.running ? "running" : "idle", a.running ? "ok" : "off"),
        })), 12)
      : empty("Appliances with a \"running\" sensor show up here (see home-assistant/ for V-ZUG).", { icon: "cook" }),
  );
}
