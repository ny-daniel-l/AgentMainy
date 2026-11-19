// Radar: who and what is home, as a radar scope that pings every few seconds,
// with the contact list and the event log beside it.
import { h, mount } from "../atoms/h";
import { icon } from "../atoms/icon";
import { button } from "../atoms/button";
import { segmented } from "../atoms/segmented";
import { RadarScope, scopeOptions } from "../organisms/radar-scope";
import { contactsCard, logCard } from "../organisms/radar-panels";
import { haGate } from "../organisms/ha-ui";
import { ha } from "../services/home-assistant";
import { clearLog, onScan, radarState, scanNow } from "../services/radar";
import { RADAR_COLORS, onSettings, settings, updateSettings } from "../services/settings";
import { ping } from "../services/sound";
import { goTo, type DashPage } from "./page";

let root: HTMLElement;
let scope: RadarScope;
let visible = false;
const gateHost = h("div");
const bodyHost = h("div", { class: "radar-page" });
const side = h("div", { class: "radar-side" });
const scanEl = h("span", { class: "hud-chip" });
const nextEl = h("span", { class: "hud-chip" });
const countEl = h("span", { class: "hud-chip" });
const clockEl = h("div", { class: "hud hud-tr" });
const controls = h("span", { class: "scope-controls" });
let lastSecond = -1;

function renderControls() {
  const s = settings();
  mount(controls,
    segmented<"people" | "all">([{ value: "people", label: "People" }, { value: "all", label: "Everything" }],
      s.radarDevices ? "all" : "people", (v) => updateSettings({ radarDevices: v === "all" }), "Show"),
    button("Ping now", scanNow, { icon: "radar", title: "Scan right now" }),
    h("button", {
      type: "button", class: "btn icon-btn", "aria-pressed": String(s.radarSound),
      title: s.radarSound ? "Sound on" : "Sound off",
      onclick: () => updateSettings({ radarSound: !s.radarSound }),
    }, icon(s.radarSound ? "sound" : "mute")),
  );
}

function renderSide() {
  const { contacts, log, scans } = radarState();
  const n = (k: string) => contacts.filter((c) => c.kind === k).length;
  scanEl.textContent = `SCAN ${String(scans).padStart(4, "0")}`;
  const p = n("person"), d = n("device"), u = n("unknown");
  countEl.textContent = `${p} ${p === 1 ? "person" : "people"} · ${d} device${d === 1 ? "" : "s"}${u ? ` · ${u} new` : ""}`;
  mount(side, contactsCard(contacts), logCard(log, clearLog));
}

function renderGate() {
  const gate = haGate("who is home on the radar", goTo);
  mount(gateHost, gate);
  bodyHost.hidden = !!gate;
}

export const radarPage: DashPage = {
  id: "radar",
  mount(el) {
    root = el;
    const canvas = h("canvas", { class: "scope", role: "img", "aria-label": "Presence radar. The contact list beside it shows the same contacts as text." });
    scope = new RadarScope(canvas, scopeOptions());
    scope.onFrame = (left) => {
      const sec = Math.ceil(left);
      if (sec === lastSecond) return;
      lastSecond = sec;
      nextEl.textContent = `NEXT PING ${String(sec).padStart(2, "0")} s`;
      clockEl.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    };
    mount(bodyHost,
      h("section", { class: "scope-card" },
        h("div", { class: "scope-bar" }, scanEl, nextEl, countEl, h("span", { class: "spacer" }), controls),
        h("div", { class: "scope-wrap" },
          canvas,
          h("div", { class: "hud hud-tl" }, h("b", null, "PRESENCE RADAR"), h("span", null, "HOME")),
          clockEl,
          h("div", { class: "hud hud-bl" }, "◆ person   ■ device   ▲ new"),
          h("div", { class: "hud hud-br", title: "The radar knows who is home, not where. Each contact keeps a fixed spot: people on the inner rings, devices on the outer ones." }, "NOT REAL LOCATIONS"),
        ),
      ),
      side,
    );
    mount(root, gateHost, bodyHost);
    onScan(() => {
      scope.setContacts(radarState().contacts);
      scope.pingNow();
      if (visible && settings().radarSound) ping(settings().radarVolume);
      renderSide();
    });
    onSettings(() => {
      scope.setOptions(scopeOptions());
      root.style.setProperty("--radar", RADAR_COLORS[settings().radarColor]);
      renderControls();
    });
    ha.onChange(() => { if (visible) renderGate(); });
    root.style.setProperty("--radar", RADAR_COLORS[settings().radarColor]);
    scope.setContacts(radarState().contacts);
    renderControls();
    renderSide();
    renderGate();
  },
  show() {
    visible = true;
    renderGate();
    renderSide();
    scope.start();
  },
  hide() {
    visible = false;
    scope.stop();
  },
};
