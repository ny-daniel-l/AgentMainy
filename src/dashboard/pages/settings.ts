// Settings: AgentMainy's own options. The Home Assistant connection, the
// radar, the Pi, the look. (The pet's settings live on its own pages.)
import { h, mount } from "../atoms/h";
import { pill } from "../atoms/badge";
import { button, confirmButton } from "../atoms/button";
import { segmented } from "../atoms/segmented";
import { toggle } from "../atoms/toggle";
import { card } from "../molecules/card";
import { settingRow } from "../molecules/setting-row";
import { toast } from "../molecules/toast";
import { ha, haConfig, normalizeUrl, saveHaConfig } from "../services/home-assistant";
import { clearLog } from "../services/radar";
import { ACCENTS, RADAR_COLORS, onSettings, resetSettings, settings, updateSettings, type Accent, type RadarColor } from "../services/settings";
import type { DashPage } from "./page";

let root: HTMLElement;
let visible = false;

function connectionCard(error = ""): HTMLElement {
  const cfg = haConfig();
  if (cfg) {
    return card({ title: "Home Assistant", icon: "home", wide: true, aside: pill(ha.status === "online" ? "connected" : ha.status, ha.status === "online" ? "ok" : ha.status === "error" ? "bad" : "info") },
      settingRow("Address", ha.error || "Used by Radar, House, Clock, Network and Server.", h("span", { class: "mono" }, cfg.url)),
      h("div", { class: "row-actions" },
        button("Reconnect", () => { ha.connect(cfg).catch(() => {}); }),
        button("Disconnect", () => { ha.disconnect(); saveHaConfig(null); render(); })),
    );
  }
  const url = h("input", { class: "field", type: "text", placeholder: "http://homeassistant.local:8123", spellcheck: "false", "aria-label": "Home Assistant address" });
  const token = h("input", { class: "field", type: "password", placeholder: "Long-lived access token", autocomplete: "off", "aria-label": "Access token" });
  const go = button("Connect", async () => {
    const next = { url: normalizeUrl(url.value), token: token.value.trim() };
    if (!url.value.trim() || !next.token) return mount(root, ...cards("Enter the address and a token."));
    go.disabled = true;
    try {
      await ha.connect(next);
      saveHaConfig(next);
      toast("Connected to Home Assistant", "ok");
      render();
    } catch (e) {
      ha.disconnect();
      mount(root, ...cards((e as Error).message));
    }
  }, { variant: "primary", icon: "plug" });
  return card({ title: "Connect Home Assistant", icon: "home", wide: true, cls: "card-hero" },
    h("p", { class: "lead" }, "Radar, House, Clock, Network and Server all read your Home Assistant."),
    h("div", { class: "form" }, h("label", null, h("span", null, "Address"), url), h("label", null, h("span", null, "Token"), token), go),
    error ? h("div", { class: "form-error", role: "alert" }, error) : null,
    h("p", { class: "muted small" }, "Create a token in Home Assistant: your profile → Security → Long-lived access tokens. It stays on this computer and is only sent to your Home Assistant."),
  );
}

function radarCard(): HTMLElement {
  const s = settings();
  const volume = h("input", { class: "range", type: "range", min: 0, max: 1, step: 0.05, value: s.radarVolume, "aria-label": "Ping volume" });
  volume.addEventListener("change", () => updateSettings({ radarVolume: Number(volume.value) }));
  return card({ title: "Radar", icon: "radar" },
    settingRow("Ping every", "One sweep of the beam, one scan.",
      segmented([5, 10, 15, 30, 60].map((v) => ({ value: v, label: `${v} s` })), s.radarInterval, (v) => updateSettings({ radarInterval: v }), "Ping interval")),
    settingRow("Colour", "",
      h("div", { class: "swatches" }, ...(Object.keys(RADAR_COLORS) as RadarColor[]).map((c) => h("button", {
        type: "button", class: `swatch${c === s.radarColor ? " on" : ""}`, style: `--sw:${RADAR_COLORS[c]}`, title: c, "aria-label": c, "aria-pressed": String(c === s.radarColor),
        onclick: () => updateSettings({ radarColor: c }) })))),
    settingRow("Afterglow", "How long a blip stays lit after the beam passes.",
      segmented([{ value: 3, label: "Short" }, { value: 6, label: "Medium" }, { value: 10, label: "Long" }], s.radarAfterglow, (v) => updateSettings({ radarAfterglow: v }), "Afterglow")),
    settingRow("Labels", "Names next to the blips.", toggle(s.radarLabels, (on) => updateSettings({ radarLabels: on }), "Labels")),
    settingRow("Show devices", "Off: people only.", toggle(s.radarDevices, (on) => updateSettings({ radarDevices: on }), "Show devices")),
    settingRow("Active ping", "Ask the router for a fresh device list on every ping (one router login per ping).", toggle(s.radarActivePing, (on) => updateSettings({ radarActivePing: on }), "Active ping")),
    settingRow("Sound", "A sonar ping on every scan while the Radar is open.", toggle(s.radarSound, (on) => updateSettings({ radarSound: on }), "Sound")),
    settingRow("Volume", "", volume),
    h("div", { class: "row-actions" }, confirmButton("Clear the event log", "Click again to clear", () => { clearLog(); toast("Radar log cleared", "info"); })),
  );
}

function serverCard(): HTMLElement {
  const s = settings();
  return card({ title: "Server", icon: "server" },
    settingRow("Warm at", "The Pi's temperature turns amber from here, red 10 °C higher.",
      segmented([55, 60, 65, 70].map((v) => ({ value: v, label: `${v} °C` })), s.tempWarn, (v) => updateSettings({ tempWarn: v }), "Warning temperature")),
    settingRow("Unit", "", segmented<"C" | "F">([{ value: "C", label: "°C" }, { value: "F", label: "°F" }], s.tempUnit, (v) => updateSettings({ tempUnit: v }), "Temperature unit")),
  );
}

const PAGES = [["overview", "Overview"], ["radar", "Radar"], ["team", "Team"], ["house", "House"], ["clock", "Clock"], ["network", "Network"], ["server", "Server"]];

function appearanceCard(): HTMLElement {
  const s = settings();
  const start = h("select", { class: "field select", "aria-label": "Start page" },
    ...PAGES.map(([v, label]) => h("option", { value: v, selected: v === s.startPage }, label)));
  start.addEventListener("change", () => updateSettings({ startPage: start.value }));
  return card({ title: "Appearance", icon: "gear" },
    settingRow("Accent", "",
      h("div", { class: "swatches" }, ...(Object.keys(ACCENTS) as Accent[]).map((a) => h("button", {
        type: "button", class: `swatch${a === s.accent ? " on" : ""}`, style: `--sw:linear-gradient(135deg, ${ACCENTS[a][0]}, ${ACCENTS[a][1]})`, title: a, "aria-label": a, "aria-pressed": String(a === s.accent),
        onclick: () => updateSettings({ accent: a }) })))),
    settingRow("Reduce motion", "No sweeping beam, no animations.", toggle(s.reduceMotion, (on) => updateSettings({ reduceMotion: on }), "Reduce motion")),
    settingRow("Start on", "The page the dashboard opens on.", start),
    h("div", { class: "row-actions" }, confirmButton("Reset these settings", "Click again to reset", () => { resetSettings(); toast("Settings reset", "info"); })),
  );
}

function cards(error = ""): HTMLElement[] {
  return [h("div", { class: "grid grid-2" }, connectionCard(error), radarCard(), serverCard(), appearanceCard())];
}

function render() {
  mount(root, ...cards());
}

export const settingsPage: DashPage = {
  id: "settings",
  mount(el) {
    root = el;
    onSettings(() => { if (visible) render(); });
    // only when the connection status changes (never for entity updates, never
    // while a half-typed connect form is open)
    let status = "";
    ha.onChange(() => {
      const now = ha.status + ha.error;
      if (now === status) return;
      status = now;
      if (visible && haConfig()) render();
    });
  },
  show() { visible = true; render(); },
  hide() { visible = false; },
};
