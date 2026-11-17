// Network: the internet connection and every device on it.
import { h, mount } from "../atoms/h";
import { devicesCard, internetCard, newDevicesCard, type DeviceFilter } from "../organisms/network-board";
import { haGate } from "../organisms/ha-ui";
import { ha } from "../services/home-assistant";
import { cachedHistory } from "../services/history-cache";
import * as model from "../services/home-model";
import { goTo, onlyWhenChanged, type DashPage } from "./page";

let root: HTMLElement;
let visible = false;
let query = "";
let filter: DeviceFilter = "all";

const speedId = () => ha.entities().find((e) => e.entity_id.includes("speedtest") && e.entity_id.endsWith("download"))?.entity_id;
const history = () => {
  const id = speedId();
  return id ? cachedHistory(id, 24, () => visible && render()) : undefined;
};

const render = onlyWhenChanged(() => {
  const gate = haGate("your internet and devices", goTo);
  if (gate) return mount(root, gate);
  const list = ha.entities();
  // keep the cursor in the search box when the list re-renders while typing
  const typing = document.activeElement?.classList.contains("dev-search");
  const caret = typing ? (document.activeElement as HTMLInputElement).selectionStart : null;
  mount(root, h("div", { class: "grid" },
    internetCard(list, history()),
    newDevicesCard(list),
    devicesCard(list, query, filter,
      (q) => { query = q; render(true); },
      (f) => { filter = f; render(true); }),
  ));
  if (typing) {
    const box = root.querySelector<HTMLInputElement>(".dev-search");
    box?.focus();
    if (box && caret !== null) box.setSelectionRange(caret, caret);
  }
}, () => {
  const list = ha.entities();
  return JSON.stringify([ha.status, model.internet(list), model.allDevices(list).map((d) => [d.name, d.active]), !!history()]);
});

export const networkPage: DashPage = {
  id: "network",
  mount(el) {
    root = el;
    ha.onChange(() => { if (visible) render(); });
  },
  show() { visible = true; render(true); },
  hide() { visible = false; },
};
