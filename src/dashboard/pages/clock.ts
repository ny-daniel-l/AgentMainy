// Clock: timers and alarm clocks. The countdowns tick every second without
// rebuilding the page, so typing a custom time is never interrupted.
import { h, mount } from "../atoms/h";
import { alarmsCard, timersCard } from "../organisms/clock-board";
import { haGate } from "../organisms/ha-ui";
import { ha } from "../services/home-assistant";
import * as model from "../services/home-model";
import { goTo, onlyWhenChanged, type DashPage } from "./page";

let root: HTMLElement;
let visible = false;
let ticker: number | undefined;

const render = onlyWhenChanged(() => {
  const gate = haGate("your timers and alarm clocks", goTo);
  if (gate) return mount(root, gate);
  const list = ha.entities();
  mount(root, h("div", { class: "grid grid-2" }, timersCard(list, () => render(true)), alarmsCard(list)));
}, () => {
  const list = ha.entities();
  return JSON.stringify([ha.status, model.timers(list).map((t) => [t.state, t.attributes.finishes_at, t.attributes.remaining]), model.alarms(list)]);
});

/** Live countdown: only the running timers' numbers change. */
function tick() {
  const list = ha.entities();
  for (const tm of model.timers(list)) {
    if (tm.state !== "active" || !tm.attributes.finishes_at) continue;
    const s = Math.max(0, Math.round((Date.parse(tm.attributes.finishes_at) - Date.now()) / 1000));
    const el = root.querySelector<HTMLElement>(`.timer-tile.live[data-id="${tm.entity_id}"] .timer-display`);
    if (el) el.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
}

export const clockPage: DashPage = {
  id: "clock",
  mount(el) {
    root = el;
    ha.onChange(() => { if (visible) render(); });
  },
  show() {
    visible = true;
    render(true);
    window.clearInterval(ticker);
    ticker = window.setInterval(tick, 1000);
  },
  hide() {
    visible = false;
    window.clearInterval(ticker);
  },
};
