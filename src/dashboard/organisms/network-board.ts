// The Network page: is the internet up and how fast, its 24 h history, and
// every device the router knows (searchable, sortable, renamable), with the
// new ones flagged and something to do about them.
import { h } from "../atoms/h";
import { icon } from "../atoms/icon";
import { pill } from "../atoms/badge";
import { button } from "../atoms/button";
import { segmented } from "../atoms/segmented";
import { card } from "../molecules/card";
import { stat } from "../molecules/stat";
import { sparkline } from "../molecules/sparkline";
import { empty } from "../molecules/empty";
import * as model from "../services/home-model";
import type { Entity } from "../services/home-model";
import { aliases, deviceKey, mine } from "../services/aliases";

/** "118.83 Mbit/s" -> "118.8 Mbit/s": one decimal everywhere. */
export const oneDecimal = (s?: string) => s?.replace(/\d+\.\d+/, (n) => Number(n).toFixed(1));

const WEEK = 7 * 86_400_000;
const fullDate = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "");

export type DeviceFilter = "all" | "online" | "offline";
export type DeviceSort = "name" | "ip" | "seen";

export interface NetUi {
  query: string;
  filter: DeviceFilter;
  sort: DeviceSort;
  renaming: string | null;     // device key whose name is being edited
  testing: boolean;            // a speed test is running
  onQuery(q: string): void;
  onFilter(f: DeviceFilter): void;
  onSort(s: DeviceSort): void;
  onRename(key: string | null, name?: string): void;
  onMine(key: string): void;
  onTest(entityId: string): void;
}

export function internetCard(list: Entity[], history: { t: number; v: number }[] | undefined, ui: NetUi): HTMLElement {
  const net = model.internet(list);
  const speedId = list.find((e) => e.entity_id.includes("speedtest") && e.entity_id.endsWith("download"))?.entity_id;
  const test = speedId
    ? h("button", { type: "button", class: "btn", disabled: ui.testing, title: "Runs a speed test on the Pi (about 30 s)",
        onclick: () => ui.onTest(speedId) }, icon("speed"), h("span", null, ui.testing ? "Testing… ~30 s" : "Test now"))
    : null;
  return card(
    { title: "Internet", icon: "wifi", wide: true,
      aside: h("span", { class: "trail-stack" }, net.online === undefined ? null : pill(net.online ? "online" : "offline", net.online ? "ok" : "bad"), test) },
    h("div", { class: "stat-grid" },
      stat("Download", oneDecimal(net.download) ?? "–", { icon: "speed" }),
      stat("Upload", oneDecimal(net.upload) ?? "–", { icon: "speed" }),
      stat("Ping", net.ping ?? "–", { icon: "wifi" }),
    ),
    speedId ? h("div", { class: "card-sub" }, h("div", { class: "sub-title" }, "Download, last 24 h"),
      history ? sparkline(history, { unit: "Mbit/s", digits: 1 }) : h("div", { class: "spark empty-spark" }, "Loading history…")) : null,
  );
}

/** The device's name, or a field to rename it (Enter saves, Esc cancels, empty = back to the router's name). */
function nameCell(d: model.Device, shown: string, ui: NetUi): HTMLElement {
  const key = deviceKey(d);
  if (ui.renaming === key) {
    return h("input", { class: "field rename-field", type: "text", value: shown, "aria-label": `New name for ${d.name}`,
      onkeydown: (e: KeyboardEvent) => {
        const field = e.currentTarget as HTMLInputElement;
        if (e.key === "Enter") ui.onRename(null, field.value);
        if (e.key === "Escape") ui.onRename(null);
      },
      onblur: (e: Event) => ui.onRename(null, (e.currentTarget as HTMLInputElement).value) });
  }
  return h("button", { type: "button", class: "name-btn", title: shown === d.name ? "Rename" : `Router name: ${d.name}. Click to rename`,
    onclick: () => ui.onRename(key) }, shown, h("span", { class: "pencil", "aria-hidden": "true" }, "✎"));
}

export function devicesCard(list: Entity[], ui: NetUi): HTMLElement {
  const all = model.allDevices(list);
  if (!all.length) {
    return card({ title: "Devices", icon: "devices", wide: true },
      empty("The device list needs a router sensor (see home-assistant/ for the Swisscom Internet-Box).", { icon: "devices" }));
  }
  const names = aliases();
  const known = mine();
  const shownName = (d: model.Device) => names[deviceKey(d)] || d.name;
  const q = ui.query.trim().toLowerCase();
  const seen = (d: model.Device) => Date.parse(d.firstSeen ?? "") || 0;
  const order: Record<DeviceSort, (a: model.Device, b: model.Device) => number> = {
    name: (a, b) => shownName(a).localeCompare(shownName(b)),
    ip: (a, b) => (a.ip ? 0 : 1) - (b.ip ? 0 : 1) || (a.ip ?? "").localeCompare(b.ip ?? "", undefined, { numeric: true }),
    seen: (a, b) => seen(b) - seen(a),
  };
  const shown = all
    .filter((d) => ui.filter === "all" || (ui.filter === "online") === d.active)
    .filter((d) => !q || shownName(d).toLowerCase().includes(q) || d.name.toLowerCase().includes(q) || (d.ip ?? "").includes(q))
    .sort(order[ui.sort]);
  const search = h("input", { class: "field dev-search", type: "search", placeholder: "Search name or IP", "aria-label": "Search devices",
    oninput: (e: Event) => ui.onQuery((e.currentTarget as HTMLInputElement).value) });
  const head = (key: DeviceSort, label: string) => h("button", { type: "button", class: `sort-btn${ui.sort === key ? " on" : ""}`,
    "aria-sort": ui.sort === key ? (key === "seen" ? "descending" : "ascending") : "none", onclick: () => ui.onSort(key) }, label, ui.sort === key ? " ▾" : "");
  return card(
    { title: "Devices", icon: "devices", wide: true, aside: h("span", { class: "count" }, `${all.filter((d) => d.active).length} online / ${all.length}`) },
    h("div", { class: "toolbar" }, search,
      segmented<DeviceFilter>([{ value: "all", label: "All" }, { value: "online", label: "Online" }, { value: "offline", label: "Offline" }], ui.filter, ui.onFilter, "Device filter")),
    h("div", { class: "dev-table", role: "table", "aria-label": "Devices" },
      h("div", { class: "dev-row dev-head", role: "row" }, h("span", null, ""), head("name", "Name"), head("ip", "IP"), head("seen", "First seen")),
      ...shown.map((d) => h("div", { class: `dev-row${d.active ? "" : " off"}`, role: "row", "data-id": deviceKey(d) },
        h("span", { class: `dot dot-${d.active ? "ok" : "off"}`, "aria-label": d.active ? "online" : "offline" }),
        h("span", { class: "dev-name" }, nameCell(d, shownName(d), ui),
          seen(d) > Date.now() - WEEK && !known.has(deviceKey(d)) ? h("span", { class: "pill pill-warn new-tag" }, "new") : null),
        h("span", { class: "mono" }, d.ip ?? "–"),
        h("span", { class: "muted", title: fullDate(d.firstSeen) }, d.firstSeen ? model.ago(d.firstSeen) : "–"),
      )),
      shown.length ? null : h("div", { class: "lrow-more" }, "No device matches."),
    ),
  );
}

/** Devices the router saw for the first time in the last 7 days that you haven't marked as yours. */
export function newDevicesCard(list: Entity[], ui: NetUi): HTMLElement | null {
  const names = aliases();
  const known = mine();
  const fresh = model.allDevices(list)
    .filter((d) => d.firstSeen && Date.parse(d.firstSeen) > Date.now() - WEEK && !known.has(deviceKey(d)))
    .sort((a, b) => Date.parse(b.firstSeen!) - Date.parse(a.firstSeen!));
  if (!fresh.length) return null;
  return card({ title: "New this week", icon: "spark", wide: true, aside: pill(String(fresh.length), "warn") },
    h("p", { class: "muted small" }, "Not yours? Change the Wi-Fi password in the Swisscom app, and the device is out."),
    h("div", { class: "lrows" }, ...fresh.slice(0, 8).map((d) => h("div", { class: "lrow", "data-id": deviceKey(d) },
      h("span", { class: "lrow-lead" }, icon("devices")),
      h("span", { class: "lrow-text" },
        h("span", { class: "lrow-title" }, ui.renaming === deviceKey(d) ? nameCell(d, names[deviceKey(d)] || d.name, ui) : names[deviceKey(d)] || d.name),
        h("span", { class: "lrow-sub", title: fullDate(d.firstSeen) },
          [`first seen ${model.ago(d.firstSeen)}`, d.active ? "online" : "offline", d.ip, d.mac].filter(Boolean).join(" · "))),
      h("span", { class: "lrow-trail trail-stack" },
        button("Name it", () => ui.onRename(deviceKey(d))),
        button("It's mine", () => ui.onMine(deviceKey(d)), { variant: "primary" })),
    ))),
  );
}
