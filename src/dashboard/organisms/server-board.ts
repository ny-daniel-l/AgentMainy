// The Server page: the Raspberry Pi that runs Home Assistant. Health at a
// glance, fan control, the temperature over 24 h, updates and power actions.
import { h } from "../atoms/h";
import { pill, type Tone } from "../atoms/badge";
import { card } from "../molecules/card";
import { gauge } from "../molecules/gauge";
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

export function healthCard(list: Entity[]): HTMLElement {
  const s = model.server(list);
  if (s.temp === undefined && s.cpu === undefined) {
    return card({ title: "Raspberry Pi", icon: "server", wide: true },
      empty("Set up the Pi sensors from home-assistant/ (fan + System Monitor) to see the Pi here.", { icon: "devices" }));
  }
  const fanText = s.fanLevel === undefined ? "–" : s.fanRpm ? `${s.fanRpm} rpm` : "off";
  return card({ title: "Health", icon: "server", wide: true,
      aside: s.powerOk === undefined ? null : pill(s.powerOk ? "power OK" : "under-voltage!", s.powerOk ? "ok" : "bad") },
    h("div", { class: "gauges" },
      gauge(s.temp === undefined ? undefined : s.temp / 85, s.temp === undefined ? "–" : formatTemp(s.temp), "CPU temperature", tempTone(s.temp)),
      gauge(s.cpu === undefined ? undefined : s.cpu / 100, pct(s.cpu), "CPU load", loadTone(s.cpu)),
      gauge(s.memory === undefined ? undefined : s.memory / 100, pct(s.memory), "Memory", loadTone(s.memory)),
      gauge(s.disk === undefined ? undefined : s.disk / 100, pct(s.disk), "Disk", loadTone(s.disk)),
      gauge(s.fanLevel === undefined ? undefined : s.fanLevel / 4, fanText, `Fan level ${s.fanLevel ?? "–"}/4`, s.fanLevel ? "info" : "off"),
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
