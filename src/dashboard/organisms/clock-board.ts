// The Clock page: timers with a live countdown and alarm clocks you can set
// and arm. Everything runs in Home Assistant, so alarms ring even when this
// app is closed.
import { h } from "../atoms/h";
import { icon } from "../atoms/icon";
import { pill } from "../atoms/badge";
import { button } from "../atoms/button";
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

function timerTile(tm: Entity): HTMLElement {
  const id = { entity_id: tm.entity_id };
  // read the minutes from the field on screen (the one next to the clicked button)
  const startCustom = (e: Event) => {
    const box = (e.currentTarget as HTMLElement).closest(".custom")?.querySelector("input");
    const m = Math.round(Number(box?.value));
    if (m > 0) void act("timer", "start", id, { duration: hms(m) }, `${model.nameOf(tm)}: ${m} min`);
  };
  const custom = h("input", { class: "field mini-field", type: "number", min: 1, max: 600, placeholder: "min", "aria-label": "Minutes",
    onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === "Enter") startCustom(e); } });
  const state = tm.state;
  return h("div", { class: `timer-tile${state === "active" ? " live" : ""}`, "data-id": tm.entity_id },
    h("div", { class: "timer-head" }, icon("timer"), h("b", null, model.nameOf(tm)), h("span", { class: "spacer" }),
      pill(state, state === "active" ? "ok" : state === "paused" ? "warn" : "off")),
    h("div", { class: "timer-display", "aria-live": "polite" }, left(tm)),
    state === "idle"
      ? h("div", { class: "timer-actions" },
          ...PRESETS.map((m) => button(m < 60 ? `${m}m` : "1h", () => act("timer", "start", id, { duration: hms(m) }, `${model.nameOf(tm)}: ${m} min`))),
          h("span", { class: "custom" }, custom, button("Start", startCustom, { variant: "primary", icon: "play" })))
      : h("div", { class: "timer-actions" },
          state === "active"
            ? button("Pause", () => act("timer", "pause", id))
            : button("Resume", () => act("timer", "start", id), { variant: "primary", icon: "play" }),
          button("+1 min", () => act("timer", "change", id, { duration: "00:01:00" })),
          button("Stop", () => act("timer", "cancel", id), { icon: "stop", variant: "danger" })),
  );
}

export function timersCard(list: Entity[]): HTMLElement {
  const timers = model.timers(list);
  return card({ title: "Timers", icon: "timer", wide: true },
    timers.length
      ? h("div", { class: "timer-grid" }, ...timers.map(timerTile))
      : empty("Add a timer helper in Home Assistant (Settings → Devices → Helpers → Timer).", { icon: "timer" }),
  );
}

export function alarmsCard(list: Entity[]): HTMLElement {
  const alarms = model.alarms(list);
  return card({ title: "Alarm clocks", icon: "clock", wide: true },
    alarms.length
      ? h("div", { class: "alarm-list" }, ...alarms.map((a) => {
          const time = h("input", { class: "field time-field", type: "time", value: a.time, "aria-label": `${a.name} time`,
            onchange: (e: Event) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              void act("input_datetime", "set_datetime", { entity_id: a.id }, { time: `${v}:00` }, `${a.name}: ${v}`);
            } });
          return h("div", { class: `alarm${a.armed ? " armed" : ""}` },
            h("div", { class: "alarm-time" }, a.time),
            h("div", { class: "alarm-text" }, h("b", null, a.name), h("span", { class: "muted" }, a.armed === undefined ? "always on" : a.armed ? "armed" : "off")),
            time,
            a.switchId ? toggle(!!a.armed, (on) => act("input_boolean", on ? "turn_on" : "turn_off", { entity_id: a.switchId }, {}, `${a.name} ${on ? "armed" : "off"}`), `${a.name} on/off`) : null,
          );
        }))
      : empty("Add a time-only Date/Time helper (and a Toggle helper named like it) in Home Assistant.", { icon: "timer" }),
  );
}
