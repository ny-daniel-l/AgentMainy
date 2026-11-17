// Pi control: fan, power and maintenance for the Raspberry Pi.
import { h, mount } from "../atoms/h";
import { fanControl, maintenanceControl, powerControl } from "../organisms/control-board";
import { haGate } from "../organisms/ha-ui";
import { ha } from "../services/home-assistant";
import * as model from "../services/home-model";
import { goTo, onlyWhenChanged, type DashPage } from "./page";

let root: HTMLElement;
let visible = false;

const render = onlyWhenChanged(() => {
  const gate = haGate("your Raspberry Pi", goTo);
  if (gate) return mount(root, gate);
  const list = ha.entities();
  mount(root, h("div", { class: "grid grid-2" }, fanControl(list), powerControl(), maintenanceControl(list)));
}, () => {
  const list = ha.entities();
  const s = model.server(list);
  return JSON.stringify([ha.status, s.fanLevel, s.fanRpm, s.fanMode, Math.round(s.temp ?? -1),
    list.find((e) => e.entity_id === "script.pi_fan_boost")?.state, model.updates(list)]);
});

export const controlPage: DashPage = {
  id: "control",
  mount(el) {
    root = el;
    ha.onChange(() => { if (visible) render(); });
  },
  show() { visible = true; render(true); },
  hide() { visible = false; },
};
