// The Server page: the Raspberry Pi that runs Home Assistant. Health at a
// glance, fan control, the temperature over 24 h, updates and power actions.
import { h } from "../atoms/h";
import { pill, type Tone } from "../atoms/badge";
import { card } from "../molecules/card";
import { button } from "../atoms/button";
import { gauge } from "../molecules/gauge";
import { levelBars } from "../molecules/fan-bars";
import { sparkline } from "../molecules/sparkline";
import { empty } from "../molecules/empty";
import * as model from "../services/home-model";
import type { Entity } from "../services/home-model";
import { formatTemp, settings } from "../services/settings";

const pct = (v?: number) => (v === undefined ? "–" : `${Math.round(v)}%`);
const loadTone = (v?: number): Tone => (v === undefined ? "off" : v >= 90 ? "bad" : v >= 75 ? "warn" : "ok");

function tempTone(t?: number): Tone {
  if (t === undefined) return "off";
  const warn = settings().tempWarn;
  return t >= warn + 10 ? "bad" : t >= warn ? "warn" : "ok";
}

const TEMP_MAX = 85; // the Pi 5 throttles at 85 °C: a full ring

export function healthCard(list: Entity[], openControl: () => void): HTMLElement {
  const s = model.server(list);
  if (s.temp === undefined && s.cpu === undefined) {
    return card({ title: "Raspberry Pi", icon: "server", wide: true },
      empty("Set up the Pi sensors from home-assistant/ (fan + System Monitor) to see the Pi here.", { icon: "devices" }));
  }
  const fanText = s.fanLevel === undefined ? "–" : s.fanRpm ? `${s.fanRpm} rpm` : s.fanMode === "Auto" ? "idle" : "off";
  const aside = h("span", { class: "card-aside" },
    s.powerOk === undefined ? null : pill(s.powerOk ? "power OK" : "under-voltage!", s.powerOk ? "ok" : "bad"),
    button("Pi control", openControl, { icon: "plug", title: "Fan, restart, reboot, shut down, backups and updates" }));
  return card({ title: "Health", icon: "server", wide: true, aside },
    h("div", { class: "gauges" },
      gauge(s.temp === undefined ? undefined : s.temp / TEMP_MAX, s.temp === undefined ? "–" : formatTemp(s.temp), "CPU temperature", tempTone(s.temp), `of ${formatTemp(TEMP_MAX).replace(".0 ", " ")}`),
      gauge(s.cpu === undefined ? undefined : s.cpu / 100, pct(s.cpu), "CPU load", loadTone(s.cpu)),
      gauge(s.memory === undefined ? undefined : s.memory / 100, pct(s.memory), "Memory", loadTone(s.memory)),
      gauge(s.disk === undefined ? undefined : s.disk / 100, pct(s.disk), "Disk", loadTone(s.disk)),
      h("div", { class: "gauge gauge-fan" },
        h("div", { class: "g-bars" }, levelBars(s.fanLevel ?? 0)),
        h("div", { class: "g-value" }, fanText),
        h("div", { class: "g-label" }, `Fan level ${s.fanLevel ?? "–"}/4`)),
    ),
  );
}

export function tempHistoryCard(history: { t: number; v: number }[] | undefined): HTMLElement {
  return card({ title: "Temperature, last 24 h", icon: "thermo" },
    history ? sparkline(history, { unit: "°C" }) : h("div", { class: "spark empty-spark" }, "Loading history…"));
}

function uptime(iso?: string): string {
  if (!iso || iso === "unknown") return "–";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(min) || min < 0) return "–";
  const d = Math.floor(min / 1440), hrs = Math.floor((min % 1440) / 60);
  return d ? `${d} d ${hrs} h` : `${hrs} h ${min % 60} min`;
}

export function systemCard(list: Entity[]): HTMLElement {
  const s = model.server(list);
  const line = (k: string, v: string) => h("div", { class: "kv" }, h("span", { class: "muted" }, k), h("b", null, v));
  return card({ title: "System", icon: "server" },
    h("div", { class: "kv-list" },
      line("Address", s.ip ?? "–"),
      line("Up for", uptime(s.bootedAt)),
      line("Load (1 min)", s.load === undefined ? "–" : s.load.toFixed(2)),
      line("Network in", s.netIn ?? "–"),
      line("Network out", s.netOut ?? "–"),
    ),
  );
}
