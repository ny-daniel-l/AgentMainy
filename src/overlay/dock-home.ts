// The Home card in the pet's panel: a live mini radar, who is home, the door,
// the Pi and the internet, plus shortcuts that open the dashboard on a page.
// It reuses the dashboard's Home Assistant client, radar model and scope; this
// window keeps its own connection (the dashboard may be closed).

import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { ha, haConfig } from "../dashboard/services/home-assistant";
import * as model from "../dashboard/services/home-model";
import { contacts } from "../dashboard/services/radar-model";
import { RadarScope, scopeOptions } from "../dashboard/organisms/radar-scope";
import { formatTemp, settings } from "../dashboard/services/settings";

let info: HTMLElement;
let scope: RadarScope | undefined;
let open = false;
let lastHtml = "";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pill = (text: string, tone: "ok" | "warn" | "bad" | "off") => `<span class="dk-pill ${tone}">${esc(text)}</span>`;

/** Open the dashboard on `page` (an open dashboard hears the event, a new one reads the key). */
function goToDashboard(page: string) {
  localStorage.setItem("am_goto", page);
  void emit("dashboard-goto", page);
  void invoke("open_settings");
}

export function initHome(section: HTMLElement) {
  section.innerHTML =
    `<h3>Home</h3>` +
    `<div class="dk-home-row"><div class="dk-mini" title="Open the radar"></div><div class="dk-home-info"></div></div>` +
    `<div class="dk-go"><button data-go="radar" class="prim">Radar</button><button data-go="control">Pi control</button><button data-go="overview">Dashboard</button></div>`;
  info = section.querySelector(".dk-home-info")!;
  const mini = section.querySelector<HTMLElement>(".dk-mini")!;
  const canvas = document.createElement("canvas");
  mini.append(canvas);
  mini.addEventListener("click", () => goToDashboard("radar"));
  section.querySelector(".dk-go")!.addEventListener("click", (e) => {
    const page = (e.target as HTMLElement).closest<HTMLElement>("[data-go]")?.dataset.go;
    if (page) goToDashboard(page);
  });
  scope = new RadarScope(canvas, scopeOptions({ mini: true, labels: false }));
  const cfg = haConfig();
  if (cfg) ha.connect(cfg).catch(() => {}); // keeps retrying in the background
  let queued = false;
  ha.onChange(() => {
    if (queued || !open) return;
    queued = true;
    setTimeout(() => { queued = false; renderHome(); }, 500);
  });
}

/** Called when the panel opens or closes: the radar only sweeps while it shows. */
export function homeOpen(isOpen: boolean) {
  open = isOpen;
  if (!scope) return;
  if (isOpen) { renderHome(); scope.start(); } else scope.stop();
}

export function renderHome() {
  if (!info) return;
  let html: string;
  if (!haConfig()) {
    html = `<div class="dk-home-empty">Connect Home Assistant in the dashboard's Settings to see your home here.</div>`;
  } else if (ha.status !== "online" && !ha.entities().length) {
    html = `<div class="dk-home-empty">${esc(ha.error || "Connecting to Home Assistant…")}</div>`;
  } else {
    const list = ha.entities();
    const people = model.peopleHome(list).map(model.nameOf);
    const lock = model.locks(list)[0];
    const s = model.server(list);
    const net = model.internet(list);
    scope?.setContacts(contacts(list, { devices: settings().radarDevices }));
    html =
      `<div><span class="k">Home</span><span class="v">${people.length ? esc(people.join(", ")) : "nobody"}</span></div>` +
      (lock ? `<div><span class="k">Door</span>${pill(lock.state, lock.state === "locked" ? "ok" : "warn")}</div>` : "") +
      (s.temp !== undefined
        ? `<div><span class="k">Pi</span><span class="v">${esc(formatTemp(s.temp))}</span>${pill(s.fanRpm ? `fan ${s.fanRpm} rpm` : "fan off", s.temp >= settings().tempWarn ? "warn" : "off")}</div>`
        : "") +
      (net.online !== undefined || net.download
        ? `<div><span class="k">Net</span>${pill(net.online === false ? "offline" : "online", net.online === false ? "bad" : "ok")}${net.download ? `<span class="v">↓ ${esc(net.download)}</span>` : ""}</div>`
        : "");
  }
  if (html !== lastHtml) { info.innerHTML = html; lastHtml = html; } // no flicker: only when it changed
}
