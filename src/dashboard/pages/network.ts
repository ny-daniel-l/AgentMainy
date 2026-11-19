// Network: the internet connection and every device on it.
import { h, mount } from "../atoms/h";
import { devicesCard, internetCard, newDevicesCard, type DeviceFilter, type DeviceSort, type NetUi } from "../organisms/network-board";
import { act, haGate } from "../organisms/ha-ui";
import { ha } from "../services/home-assistant";
import { cachedHistory } from "../services/history-cache";
import { aliases, markMine, mine, setAlias } from "../services/aliases";
import * as model from "../services/home-model";
import { goTo, onlyWhenChanged, type DashPage } from "./page";

let root: HTMLElement;
let visible = false;

const ui: NetUi = {
  query: "",
  filter: "all" as DeviceFilter,
  sort: "name" as DeviceSort,
  renaming: null,
  testing: false,
  onQuery(q) { ui.query = q; render(true); },
  onFilter(f) { ui.filter = f; render(true); },
  onSort(s) { ui.sort = s; render(true); },
  onRename(key, name) {
    if (key === null && ui.renaming !== null && name !== undefined) setAlias(ui.renaming, name);
    ui.renaming = key;
    render(true);
    if (key) root.querySelector<HTMLInputElement>(".rename-field")?.select();
  },
  onMine(key) { markMine(key); render(true); },
  async onTest(entityId) {
    ui.testing = true;
    render(true);
    // update_entity returns once the speed test has finished; if HA drops meanwhile it never
    // settles, so give up after 90 s (a test takes about 30)
    await Promise.race([
      act("homeassistant", "update_entity", { entity_id: entityId }, {}, "Speed test done"),
      new Promise((r) => setTimeout(r, 90_000)),
    ]);
    ui.testing = false;
    render(true);
  },
};

const speedId = () => ha.entities().find((e) => e.entity_id.includes("speedtest") && e.entity_id.endsWith("download"))?.entity_id;
const history = () => {
  const id = speedId();
  return id ? cachedHistory(id, 24, () => visible && render()) : undefined;
};

const render = onlyWhenChanged(() => {
  const gate = haGate("your internet and devices", goTo);
  if (gate) return mount(root, gate);
  const list = ha.entities();
  // mount() patches in place, so the search box keeps focus and caret while typing
  mount(root, h("div", { class: "grid" },
    internetCard(list, history(), ui),
    newDevicesCard(list, ui),
    devicesCard(list, ui),
  ));
}, () => {
  const list = ha.entities();
  return JSON.stringify([ha.status, model.internet(list), model.allDevices(list).map((d) => [d.name, d.active]), !!history(),
    ui.renaming, ui.testing, aliases(), [...mine()]]);
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
