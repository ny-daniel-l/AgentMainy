// The Server page: the Raspberry Pi that runs Home Assistant. Health at a
// glance, fan control, the temperature over 24 h, updates and power actions.
import { h } from "../atoms/h";
import { pill, type Tone } from "../atoms/badge";
import { confirmButton } from "../atoms/button";
import { segmented } from "../atoms/segmented";
import { card } from "../molecules/card";
import { gauge } from "../molecules/gauge";
import { row, rows } from "../molecules/row";
import { sparkline } from "../molecules/sparkline";
import { empty } from "../molecules/empty";
import { act } from "./ha-ui";
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

const MODE_HINT: Record<string, string> = {
  Auto: "Follows the Pi's own curve: on at 50 °C, max at 75 °C.",
  Off: "Silent. Forced back on above 70 °C.",
  Low: "Quiet airflow. Forced up above 70 °C.",
  Medium: "Half speed. Forced up above 70 °C.",
  High: "Strong cooling.",
  Max: "Full speed, loud.",
};

export function fanCard(list: Entity[]): HTMLElement | null {
  const s = model.server(list);
  if (!s.fanModes.length) return null;
  return card({ title: "Fan", icon: "fan", aside: pill(s.fanRpm ? `${s.fanRpm} rpm` : "stopped", s.fanRpm ? "info" : "off") },
    segmented(s.fanModes.map((m) => ({ value: m, label: m })), s.fanMode, (m) =>
      act("input_select", "select_option", { entity_id: "input_select.pi_fan_mode" }, { option: m }, `Fan: ${m}`), "Fan mode"),
    h("p", { class: "muted small fan-hint" }, MODE_HINT[s.fanMode ?? ""] ?? ""),
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

export function updatesCard(list: Entity[]): HTMLElement {
  const ups = model.updates(list);
  return card({ title: "Updates", icon: "spark", aside: pill(ups.length ? `${ups.length} waiting` : "up to date", ups.length ? "warn" : "ok") },
    ups.length
      ? rows(ups.map((u) => row({
          title: u.name,
          sub: `${u.installed} → ${u.latest}`,
          trail: confirmButton("Install", "Click again to install", () => act("update", "install", { entity_id: u.id }, {}, `Installing ${u.name}…`), { variant: "primary" }),
        })))
      : empty("Everything is up to date.", { icon: "spark" }),
  );
}

export function powerCard(): HTMLElement {
  return card({ title: "Power", icon: "plug" },
    h("div", { class: "power-actions" },
      confirmButton("Back up now", "Click again to back up", () => act("backup", "create_automatic", null, {}, "Backup started"), { icon: "spark" }),
      confirmButton("Restart Home Assistant", "Click again to restart", () => act("homeassistant", "restart", null, {}, "Home Assistant is restarting (about 1 min)"), { icon: "play" }),
      confirmButton("Reboot the Pi", "Click again: reboot now", () => act("hassio", "host_reboot", null, {}, "The Pi is rebooting (about 2 min)"), { icon: "play", variant: "danger" }),
      confirmButton("Shut down the Pi", "Click again: power off", () => act("hassio", "host_shutdown", null, {}, "The Pi is shutting down. Unplug and replug it to start it again."), { icon: "stop", variant: "danger" }),
    ),
    h("p", { class: "muted small" }, "Every action asks for a second click. A shut-down Pi only starts again when you unplug and replug it."),
  );
}
