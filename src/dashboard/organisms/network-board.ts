// The Network page: is the internet up and how fast, its 24 h history, and
// every device the router knows (searchable), with the new ones flagged.
import { h } from "../atoms/h";
import { icon } from "../atoms/icon";
import { pill } from "../atoms/badge";
import { button } from "../atoms/button";
import { segmented } from "../atoms/segmented";
import { card } from "../molecules/card";
import { stat } from "../molecules/stat";
import { sparkline } from "../molecules/sparkline";
import { empty } from "../molecules/empty";
import { act } from "./ha-ui";
import * as model from "../services/home-model";
import type { Entity } from "../services/home-model";

export function internetCard(list: Entity[], history: { t: number; v: number }[] | undefined): HTMLElement {
  const net = model.internet(list);
  const speedId = list.find((e) => e.entity_id.includes("speedtest") && e.entity_id.endsWith("download"))?.entity_id;
  return card(
    { title: "Internet", icon: "wifi", wide: true,
      aside: h("span", { class: "trail-stack" },
        net.online === undefined ? null : pill(net.online ? "online" : "offline", net.online ? "ok" : "bad"),
        speedId ? button("Test now", () => act("homeassistant", "update_entity", { entity_id: speedId }, {}, "Speed test started, about 30 s…"), { icon: "speed" }) : null) },
    h("div", { class: "stat-grid" },
      stat("Download", net.download ?? "–", { icon: "speed" }),
      stat("Upload", net.upload ?? "–", { icon: "speed" }),
      stat("Ping", net.ping ?? "–", { icon: "wifi" }),
    ),
    speedId ? h("div", { class: "card-sub" }, h("div", { class: "sub-title" }, "Download, last 24 h"),
      history ? sparkline(history, { unit: "Mbit/s", digits: 0 }) : h("div", { class: "spark empty-spark" }, "Loading history…")) : null,
  );
}

export type DeviceFilter = "all" | "online" | "offline";

export function devicesCard(list: Entity[], query: string, filter: DeviceFilter, onQuery: (q: string) => void, onFilter: (f: DeviceFilter) => void): HTMLElement {
  const all = model.allDevices(list);
  if (!all.length) {
    return card({ title: "Devices", icon: "devices", wide: true },
      empty("The device list needs a router sensor (see home-assistant/ for the Swisscom Internet-Box).", { icon: "devices" }));
  }
  const q = query.trim().toLowerCase();
  const shown = all
    .filter((d) => filter === "all" || (filter === "online") === d.active)
    .filter((d) => !q || d.name.toLowerCase().includes(q) || (d.ip ?? "").includes(q));
  const search = h("input", { class: "field dev-search", type: "search", placeholder: "Search name or IP", value: query, "aria-label": "Search devices" });
  search.addEventListener("input", () => onQuery(search.value));
  const week = Date.now() - 7 * 86_400_000;
  return card(
    { title: "Devices", icon: "devices", wide: true, aside: h("span", { class: "count" }, `${all.filter((d) => d.active).length} online / ${all.length}`) },
    h("div", { class: "toolbar" }, search,
      segmented<DeviceFilter>([{ value: "all", label: "All" }, { value: "online", label: "Online" }, { value: "offline", label: "Offline" }], filter, onFilter, "Device filter")),
    h("div", { class: "dev-table", role: "table", "aria-label": "Devices" },
      h("div", { class: "dev-row dev-head", role: "row" }, h("span", null, ""), h("span", null, "Name"), h("span", null, "IP"), h("span", null, "First seen")),
      ...shown.map((d) => h("div", { class: `dev-row${d.active ? "" : " off"}`, role: "row" },
        h("span", { class: `dot dot-${d.active ? "ok" : "off"}`, "aria-label": d.active ? "online" : "offline" }),
        h("span", { class: "dev-name" }, d.name, d.firstSeen && Date.parse(d.firstSeen) > week ? h("span", { class: "pill pill-warn new-tag" }, "new") : null),
        h("span", { class: "mono" }, d.ip ?? "–"),
        h("span", { class: "muted" }, d.firstSeen ? new Date(d.firstSeen).toLocaleDateString() : "–"),
      )),
      shown.length ? null : h("div", { class: "lrow-more" }, "No device matches."),
    ),
  );
}

/** Devices the router saw for the first time in the last 7 days. */
export function newDevicesCard(list: Entity[]): HTMLElement | null {
  const week = Date.now() - 7 * 86_400_000;
  const fresh = model.allDevices(list).filter((d) => d.firstSeen && Date.parse(d.firstSeen) > week)
    .sort((a, b) => Date.parse(b.firstSeen!) - Date.parse(a.firstSeen!));
  if (!fresh.length) return null;
  return card({ title: "New this week", icon: "spark", aside: pill(String(fresh.length), "warn") },
    h("div", { class: "lrows" }, ...fresh.slice(0, 8).map((d) => h("div", { class: "lrow" },
      h("span", { class: "lrow-lead" }, icon("devices")),
      h("span", { class: "lrow-text" }, h("span", { class: "lrow-title" }, d.name), h("span", { class: "lrow-sub" }, `first seen ${model.ago(d.firstSeen)}`)),
      h("span", { class: "lrow-trail" }, pill(d.active ? "online" : "offline", d.active ? "ok" : "off")),
    ))),
  );
}
