// House: the door and the appliances.
import { h, mount } from "../atoms/h";
import { appliancesCard, doorCard } from "../organisms/house-board";
import { haGate } from "../organisms/ha-ui";
import { ha } from "../services/home-assistant";
import * as model from "../services/home-model";
import { goTo, onlyWhenChanged, type DashPage } from "./page";

let root: HTMLElement;
let visible = false;

const render = onlyWhenChanged(() => {
  const gate = haGate("your door and appliances", goTo);
  if (gate) return mount(root, gate);
  const list = ha.entities();
  mount(root, h("div", { class: "grid grid-2" }, doorCard(list), appliancesCard(list)));
}, () => {
  const list = ha.entities();
  return JSON.stringify([ha.status, model.locks(list).map((l) => [l.state, model.lockDetails(list, l.entity_id)]),
    model.doors(list).map((d) => d.state), model.appliances(list)]);
});

export const housePage: DashPage = {
  id: "house",
  mount(el) {
    root = el;
    ha.onChange(() => { if (visible) render(); });
  },
  show() { visible = true; render(true); },
  hide() { visible = false; },
};
