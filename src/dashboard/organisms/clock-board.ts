// The Clock page: timers with a live countdown and alarm clocks you can set
// and arm. Everything runs in Home Assistant, so alarms ring even when this
// app is closed.
import { h } from "../atoms/h";
import { icon } from "../atoms/icon";
import { pill } from "../atoms/badge";
import { button } from "../atoms/button";
import { segmented } from "../atoms/segmented";
import { toggle } from "../atoms/toggle";
import { card } from "../molecules/card";
import { empty } from "../molecules/empty";
import { act } from "./ha-ui";
import * as model from "../services/home-model";
import type { Entity } from "../services/home-model";

const PRESETS = [1, 3, 5, 10, 15, 30, 60];
const hms = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`;

function left(tm: Entity): string {
  if (tm.state === "active" && tm.attributes.finishes_at) {
    const s = Math.max(0, Math.round((Date.parse(tm.attributes.finishes_at) - Date.now()) / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  if (tm.state === "paused" && tm.attributes.remaining) return String(tm.attributes.remaining).replace(/^0:/, "");
  return String(tm.attributes.duration ?? "0:00:00").replace(/^0:/, "");
}

// the duration picked for an idle timer, by timer id (until it starts); default: the timer's own duration
const picked = new Map<string, number>();
const minLabel = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);

function timerTile(tm: Entity, refresh: () => void): HTMLElement {
  const id = { entity_id: tm.entity_id };
  const state = tm.state;
  const chosen = picked.get(tm.entity_id) ?? (model.durationMin(tm.attributes.duration) || 5);
  const pick = (m: number) => { picked.set(tm.entity_id, m); refresh(); };
  const start = () => { picked.delete(tm.entity_id); void act("timer", "start", id, { duration: hms(chosen) }, `${model.nameOf(tm)}: ${minLabel(chosen)}`); };
  // typing other minutes picks them (no re-render while you type: the field keeps focus)
  const custom = h("input", { class: "field mini-field", type: "number", min: 1, max: 600, placeholder: "min", "aria-label": "Other minutes",
    value: PRESETS.includes(chosen) ? undefined : chosen,
    oninput: (e: Event) => { const m = Math.round(Number((e.currentTarget as HTMLInputElement).value)); if (m > 0 && m <= 600) pick(m); },
    onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === "Enter") start(); } });
  return h("div", { class: `timer-tile${state === "active" ? " live" : ""}`, "data-id": tm.entity_id },
    h("div", { class: "timer-head" }, icon("timer"), h("b", null, model.nameOf(tm)), h("span", { class: "spacer" }),
      pill(state, state === "active" ? "ok" : state === "paused" ? "warn" : "off")),
    h("div", { class: "timer-display", "aria-live": "polite" }, state === "idle" ? model.clockText(chosen) : left(tm)),
    state === "idle"
      ? h("div", { class: "timer-setup" },
          segmented(PRESETS.map((m) => ({ value: m, label: m < 60 ? `${m}m` : "1h" })), chosen, pick, `${model.nameOf(tm)} duration`),
          h("div", { class: "timer-actions" }, custom, button(`Start ${minLabel(chosen)}`, start, { variant: "primary", icon: "play" })))
      : h("div", { class: "timer-actions" },
          state === "active"
            ? button("Pause", () => act("timer", "pause", id))
            : button("Resume", () => act("timer", "start", id), { variant: "primary", icon: "play" }),
          button("+1 min", () => act("timer", "change", id, { duration: "00:01:00" })),
          button("Stop", () => act("timer", "cancel", id), { icon: "stop", variant: "danger" })),
  );
}

export function timersCard(list: Entity[], refresh: () => void): HTMLElement {
  const timers = model.timers(list);
  return card({ title: "Timers", icon: "timer" },
    timers.length
      ? h("div", { class: "timer-grid" }, ...timers.map((t) => timerTile(t, refresh)))
      : empty("Add a timer helper in Home Assistant (Settings → Devices → Helpers → Timer).", { icon: "timer" }),
  );
}

export function alarmsCard(list: Entity[]): HTMLElement {
  const alarms = model.alarms(list);
  return card({ title: "Alarm clocks", icon: "clock" },
    alarms.length
      ? h("div", { class: "alarm-list" }, ...alarms.map((a) => {
          // the big time is the editor itself
          const time = h("input", { class: "alarm-time", type: "time", value: a.time, "aria-label": `${a.name}: alarm time`, title: "Click to change",
            onchange: (e: Event) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              if (v) void act("input_datetime", "set_datetime", { entity_id: a.id }, { time: `${v}:00` }, `${a.name}: ${v}`);
            } });
          return h("div", { class: `alarm${a.armed === false ? "" : " alarm-on"}` },
            time,
            h("div", { class: "alarm-text" }, h("b", null, a.name), a.switchId ? null : h("span", { class: "muted" }, "always on")),
            a.switchId ? toggle(!!a.armed, (on) => act("input_boolean", on ? "turn_on" : "turn_off", { entity_id: a.switchId }, {}, `${a.name} ${on ? "armed" : "off"}`), `${a.name} on/off`) : null,
          );
        }))
      : empty("Add a time-only Date/Time helper (and a Toggle helper named like it) in Home Assistant.", { icon: "timer" }),
  );
}
