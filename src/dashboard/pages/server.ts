// Server: the Raspberry Pi running Home Assistant.
import { h, mount } from "../atoms/h";
import { healthCard, systemCard, tempHistoryCard } from "../organisms/server-board";
import { haGate } from "../organisms/ha-ui";
import { ha } from "../services/home-assistant";
import { cachedHistory } from "../services/history-cache";
import * as model from "../services/home-model";
import { onSettings } from "../services/settings";
import { goTo, onlyWhenChanged, type DashPage } from "./page";

let root: HTMLElement;
let visible = false;

const tempHistory = () => cachedHistory("sensor.pi_cpu_temperature", 24, () => visible && render());

const render = onlyWhenChanged(() => {
  const gate = haGate("your Raspberry Pi", goTo);
  if (gate) return mount(root, gate);
  const list = ha.entities();
  mount(root, h("div", { class: "grid" },
    healthCard(list, () => goTo("control")),
    tempHistoryCard(tempHistory()),
    systemCard(list),
  ));
}, () => {
  const list = ha.entities();
  const s = model.server(list);
  // round the noisy numbers so the page does not rebuild for every 0.1 °C
  return JSON.stringify([ha.status, Math.round(s.temp ?? -1), Math.round(s.cpu ?? -1), Math.round(s.memory ?? -1), s.disk, s.fanLevel, s.fanMode, s.powerOk, s.ip,
    !!tempHistory()]);
});

export const serverPage: DashPage = {
  id: "server",
  mount(el) {
    root = el;
    ha.onChange(() => { if (visible) render(); });
    onSettings(() => { if (visible) render(true); });
  },
  show() { visible = true; render(true); },
  hide() { visible = false; },
};
