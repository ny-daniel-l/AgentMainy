// Pi control: fan, power and maintenance for the Raspberry Pi.
import { h, mount } from "../atoms/h";
import { fanControl, installing, maintenanceControl, powerControl } from "../organisms/control-board";
import { haGate } from "../organisms/ha-ui";
import { ha } from "../services/home-assistant";
import * as model from "../services/home-model";
import type { Entity } from "../services/home-model";
import { goTo, onlyWhenChanged, type DashPage } from "./page";

let root: HTMLElement;
let visible = false;
let last: Entity[] = []; // the entities before HA went away, for an update that restarts it

const render = onlyWhenChanged(() => {
  const refresh = () => render(true);
  const list = ha.entities();
  if (ha.status === "online") last = list;
  // a Core update restarts HA mid-install: keep its progress up instead of stale cards or the "connecting" card
  if (haWasHere() && installing(last)) return mount(root, h("div", { class: "grid" }, maintenanceControl(last, refresh, true)));
  const gate = haGate("your Raspberry Pi", goTo);
  if (gate) return mount(root, gate);
  mount(root, h("div", { class: "grid grid-2" }, fanControl(list), powerControl(), maintenanceControl(list, refresh)));
}, () => {
  const list = ha.entities();
  const s = model.server(list);
  return JSON.stringify([ha.status, s.fanLevel, s.fanRpm, s.fanMode, Math.round(s.temp ?? -1),
    list.find((e) => e.entity_id === "script.pi_fan_boost")?.state, model.updates(list)]);
});

/** Reconnecting to an HA we had data from (not a first connect, a wrong token or a removed config). */
const haWasHere = () => last.length > 0 && ha.status === "connecting";

export const controlPage: DashPage = {
  id: "control",
  mount(el) {
    root = el;
    ha.onChange(() => { if (visible) render(); });
  },
  show() { visible = true; render(true); },
  hide() { visible = false; },
};
