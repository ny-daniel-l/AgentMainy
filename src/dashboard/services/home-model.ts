// What the Home page shows, worked out from Home Assistant's entity list.
// Pure functions with no imports, so tests/home-model.test.ts runs them in
// plain Node. Everything is found by domain / device class, never by entity
// id, so any Home Assistant works without configuration.

export interface Entity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed?: string;
}

const domainOf = (e: Entity) => e.entity_id.split(".")[0];
export const nameOf = (e: Entity): string => dedupeName(e.attributes.friendly_name || e.entity_id);

/** HA joins device and entity name: "Front door (Nuki) Front door" -> "Front door (Nuki)". */
export function dedupeName(name: string): string {
  const words = name.split(" ");
  for (let i = words.length - 1; i > 0; i--) {
    const tail = words.slice(i).join(" ");
    if (name.startsWith(tail + " ") && i >= tail.split(" ").length) return words.slice(0, i).join(" ");
  }
  return name;
}
const withUnit = (e?: Entity) =>
  e && e.state !== "unknown" && e.state !== "unavailable"
    ? `${e.state}${e.attributes.unit_of_measurement ? " " + e.attributes.unit_of_measurement : ""}`
    : undefined;

/** People whose phone is home right now (away people are not shown). */
export function peopleHome(list: Entity[]): Entity[] {
  return list.filter((e) => domainOf(e) === "person" && e.state === "home");
}

export function peopleCount(list: Entity[]): number {
  return list.filter((e) => domainOf(e) === "person").length;
}

export function locks(list: Entity[]): Entity[] {
  return list.filter((e) => domainOf(e) === "lock");
}

/** Door / opening contact sensors. */
export function doors(list: Entity[]): Entity[] {
  return list.filter((e) => domainOf(e) === "binary_sensor" && ["door", "garage_door", "opening"].includes(e.attributes.device_class));
}

export interface Internet {
  online?: boolean;
  download?: string;
  upload?: string;
  ping?: string;
}

/** Online flag from a connectivity sensor, speeds from the Speedtest integration. */
export function internet(list: Entity[]): Internet {
  const conn = list.find((e) => domainOf(e) === "binary_sensor" && e.attributes.device_class === "connectivity");
  const speed = (kind: string) => list.find((e) => domainOf(e) === "sensor" && e.entity_id.includes("speedtest") && e.entity_id.endsWith(kind));
  return {
    online: conn && conn.state !== "unavailable" ? conn.state === "on" : undefined,
    download: withUnit(speed("download")),
    upload: withUnit(speed("upload")),
    ping: withUnit(speed("ping")),
  };
}

export interface Appliance {
  name: string;
  ends?: string;
}

/** Appliances whose "running" sensor is on; `x_running` pairs with `x_ends`. */
export function runningAppliances(list: Entity[]): Appliance[] {
  const byId = new Map(list.map((e) => [e.entity_id, e]));
  return list
    .filter((e) => domainOf(e) === "binary_sensor" && e.attributes.device_class === "running" && e.state === "on")
    .map((e) => {
      const ends = byId.get(e.entity_id.replace(/^binary_sensor\./, "sensor.").replace(/_running$/, "_ends"));
      return { name: nameOf(e).replace(/ running$/i, ""), ends: withUnit(ends) === "-" ? undefined : withUnit(ends) };
    });
}

export function appliancesCount(list: Entity[]): number {
  return list.filter((e) => domainOf(e) === "binary_sensor" && e.attributes.device_class === "running").length;
}

export function timers(list: Entity[]): Entity[] {
  return list.filter((e) => domainOf(e) === "timer");
}

/** A timer's "H:MM:SS" duration in whole minutes (0 if unreadable). */
export function durationMin(d: unknown): number {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(String(d ?? "").trim());
  return m ? Math.round(Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60) : 0;
}

/** Minutes as a timer reads them: 5 -> "05:00", 90 -> "1:30:00". */
export function clockText(min: number): string {
  const mm = String(min % 60).padStart(2, "0");
  return min >= 60 ? `${Math.floor(min / 60)}:${mm}:00` : `${mm}:00`;
}

// Router pseudo-entries (radios, ports) that are not real devices.
const NOT_A_DEVICE = /^(wl\d|eth\d|eppriv|wlguest)/i;

/**
 * Devices online right now, from any sensor carrying a router device list
 * (`attributes.devices = [{ name, active, mac }]`, e.g. the Swisscom script
 * in home-assistant/). Offline devices are left out.
 */
export function onlineDevices(list: Entity[]): string[] {
  const source = list.find((e) => Array.isArray(e.attributes.devices) && e.attributes.devices.some((d: any) => d && "active" in d));
  if (!source) return [];
  return (source.attributes.devices as any[])
    .filter((d) => d.active && d.name && !NOT_A_DEVICE.test(d.name) && !String(d.mac ?? "").startsWith("_"))
    .map((d) => String(d.name))
    .sort((a, b) => a.localeCompare(b));
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ago(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(min) || min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} d ago`;
}

const num = (e?: Entity): number | undefined => {
  const v = e ? parseFloat(e.state) : NaN;
  return Number.isFinite(v) ? v : undefined;
};

export interface Server {
  temp?: number;          // °C
  cpu?: number;           // %
  memory?: number;        // %
  disk?: number;          // %
  load?: number;          // 1-minute load average
  fanLevel?: number;      // 0-4
  fanRpm?: number;
  fanMode?: string;       // Auto / Off / Low / Medium / High / Max
  fanModes: string[];
  fanBoost: boolean;      // script.pi_fan_boost is running (Max, then Auto when its timer ends)
  netIn?: string;
  netOut?: string;
  ip?: string;
  bootedAt?: string;      // ISO time of the last boot
  powerOk?: boolean;      // false = under-voltage detected
}

/**
 * The Raspberry Pi running Home Assistant, from the `sensor.pi_*` entities
 * the kit sets up (home-assistant/README.md) plus the Raspberry Pi power check.
 */
export function server(list: Entity[]): Server {
  const by = new Map(list.map((e) => [e.entity_id, e]));
  const fan = by.get("sensor.pi_fan");
  const mode = by.get("input_select.pi_fan_mode");
  const power = by.get("binary_sensor.rpi_power_status");
  return {
    temp: num(by.get("sensor.pi_cpu_temperature")),
    cpu: num(by.get("sensor.pi_cpu_load")),
    memory: num(by.get("sensor.pi_memory_used")),
    disk: num(by.get("sensor.pi_disk_used")),
    load: num(by.get("sensor.pi_load_1m")),
    fanLevel: num(fan),
    fanRpm: fan?.attributes.rpm ?? num(by.get("sensor.pi_fan_speed")),
    fanMode: mode?.state,
    fanModes: mode?.attributes.options ?? [],
    fanBoost: by.get("script.pi_fan_boost")?.state === "on",
    netIn: withUnit(by.get("sensor.pi_network_in")),
    netOut: withUnit(by.get("sensor.pi_network_out")),
    ip: by.get("sensor.pi_ip_address")?.state,
    bootedAt: by.get("sensor.pi_last_boot")?.state,
    powerOk: power ? power.state === "off" : undefined,
  };
}

export type ServiceCall = [domain: string, service: string, target: Record<string, unknown> | null, data: Record<string, unknown>];

/**
 * Picking a fan mode. A running boost is stopped first: otherwise its timer
 * keeps running and puts the fan back to Auto when it ends, over your choice.
 */
export function fanModeCalls(mode: string, boosting: boolean): ServiceCall[] {
  return [
    ...(boosting ? [["script", "turn_off", { entity_id: "script.pi_fan_boost" }, {}] as ServiceCall] : []),
    ["input_select", "select_option", { entity_id: "input_select.pi_fan_mode" }, { option: mode }],
  ];
}

export interface Update {
  id: string;
  name: string;
  installed: string;
  latest: string;
  releaseUrl?: string;
  installing: boolean;
  percent?: number;       // 0–100 when HA knows it, else the bar just moves
}

// Older HA put the percentage in in_progress itself, newer in update_percentage.
const installingOf = (e: Entity) => e.attributes.in_progress === true || typeof e.attributes.in_progress === "number";
const percentOf = (e: Entity): number | undefined => {
  const p = e.attributes.update_percentage ?? (typeof e.attributes.in_progress === "number" ? e.attributes.in_progress : undefined);
  return typeof p === "number" && Number.isFinite(p) ? Math.min(100, Math.max(0, Math.round(p))) : undefined;
};
// No & % or quotes: open_url hands the address to cmd.
const safeUrl = (u: unknown) => (typeof u === "string" && /^https:\/\/[\w.:/?#=~+-]+$/.test(u) ? u : undefined);
const updateName = (e: Entity) => nameOf(e).replace(/ update$/i, "");

/** Software with an update waiting or installing (Home Assistant, the OS, add-ons). */
export function updates(list: Entity[]): Update[] {
  return list
    .filter((e) => domainOf(e) === "update" && (e.state === "on" || installingOf(e)))
    .map((e) => ({
      id: e.entity_id, name: updateName(e),
      installed: e.attributes.installed_version ?? "?", latest: e.attributes.latest_version ?? "?",
      releaseUrl: safeUrl(e.attributes.release_url), installing: installingOf(e), percent: percentOf(e),
    }));
}

export interface UpdateRow extends Update {
  phase: "waiting" | "installing" | "done";
  failed?: boolean;       // HA was installing it and stopped, still on the old version
}

/** An install this app knows about: the version before it, and whether HA flagged it in progress yet. */
export interface Started {
  from: string;
  flagged?: boolean;
  failed?: boolean;
}

/**
 * The Maintenance card's rows: installing first, then waiting, then done.
 * `started` holds installs clicked here or seen in progress (those are added
 * to it). One is "done" once the installed version moved on; if HA's
 * in_progress went off on the old version, it failed and can be retried.
 */
export function updateRows(list: Entity[], started: Map<string, Started>): UpdateRow[] {
  const ups = updates(list);
  const rows: UpdateRow[] = ups.map((u) => {
    let s = started.get(u.id);
    if (u.installing) {
      if (!s || s.from !== u.installed || s.failed) started.set(u.id, s = { from: u.installed });
      s.flagged = true;
    } else if (s?.flagged && s.from === u.installed) s.failed = true; // also covers a failure across an HA restart: no error reaches us then
    const installing = u.installing || (s?.from === u.installed && !s.flagged); // clicked, HA has not flagged it yet
    return { ...u, installing, phase: installing ? "installing" : "waiting", failed: !installing && s?.from === u.installed && s.failed };
  });
  for (const [id, { from }] of started) {
    const e = list.find((x) => x.entity_id === id);
    if (!e || installingOf(e) || e.attributes.installed_version === from) continue;
    rows.push({ id, name: updateName(e), installed: from, latest: e.attributes.installed_version ?? "?",
      releaseUrl: safeUrl(e.attributes.release_url), installing: false, phase: "done" });
  }
  const order = { installing: 0, waiting: 1, done: 2 };
  return rows.sort((a, b) => order[a.phase] - order[b.phase]);
}

export interface Alarm {
  id: string;
  name: string;
  time: string;           // "07:30"
  switchId?: string;      // input_boolean that arms it, if one is named like it
  armed?: boolean;
}

/** "Alarm" for a helper still on a default name: German "Wecker", or none at all (the entity id). */
export function alarmLabel(name: string, entityId: string): string {
  if (name === entityId) return "Alarm";
  return name.replace(/^wecker(?=$|\s)/i, "Alarm");
}

const SWITCH_SUFFIXES = ["_aktiv", "_on", "_enabled", "_active", "_armed", ""];
const objectId = (e: Entity) => e.entity_id.slice(e.entity_id.indexOf(".") + 1);

/**
 * Time-only input_datetimes, each paired with its input_boolean: by entity id
 * first (input_datetime.wecker + input_boolean.wecker_aktiv, so renaming one
 * of them in HA keeps the pair), else the one whose name starts with its name.
 */
export function alarms(list: Entity[]): Alarm[] {
  const switches = list.filter((e) => domainOf(e) === "input_boolean");
  const byId = new Map(switches.map((b) => [objectId(b), b]));
  return list
    .filter((e) => domainOf(e) === "input_datetime" && e.attributes.has_time && !e.attributes.has_date)
    .map((e) => {
      const name = nameOf(e);
      const sw = SWITCH_SUFFIXES.map((s) => byId.get(objectId(e) + s)).find(Boolean)
        ?? switches.find((b) => nameOf(b).toLowerCase().startsWith(name.toLowerCase()));
      return { id: e.entity_id, name: alarmLabel(name, e.entity_id), time: String(e.state).slice(0, 5), switchId: sw?.entity_id, armed: sw ? sw.state === "on" : undefined };
    });
}

export interface Device {
  name: string;
  active: boolean;
  mac: string;
  ip?: string;
  firstSeen?: string;
}

/** Every device the router knows, online first, router pseudo-entries removed. */
export function allDevices(list: Entity[]): Device[] {
  const source = list.find((e) => Array.isArray(e.attributes.devices) && e.attributes.devices.some((d: any) => d && "active" in d));
  if (!source) return [];
  return (source.attributes.devices as any[])
    .filter((d) => d.name && !NOT_A_DEVICE.test(d.name) && !String(d.mac ?? "").startsWith("_"))
    .map((d) => ({ name: String(d.name), active: !!d.active, mac: String(d.mac ?? ""), ip: d.ip && String(d.ip).includes(".") ? String(d.ip) : undefined, firstSeen: d.first_seen ?? undefined }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

/** The sensor holding the router's device list (refreshed on every radar ping). */
export function routerSensorId(list: Entity[]): string | undefined {
  return list.find((e) => Array.isArray(e.attributes.devices))?.entity_id;
}

/** Battery and "last action" sensors named after a lock: lock.x -> sensor.x_battery / sensor.x_last_action. */
export function lockDetails(list: Entity[], lockId: string): { battery?: string; lastAction?: string } {
  const base = lockId.replace(/^lock\./, "sensor.");
  const by = new Map(list.map((e) => [e.entity_id, e]));
  const last = by.get(`${base}_last_action`);
  return {
    battery: withUnit(by.get(`${base}_battery`)),
    lastAction: last && last.state !== "unknown" ? last.state : undefined,
  };
}

export interface ApplianceState {
  name: string;
  running: boolean;
  program?: string;
  ends?: string;
}

/** Every appliance with a "running" sensor, running ones first; pairs with x_program / x_ends. */
export function appliances(list: Entity[]): ApplianceState[] {
  const by = new Map(list.map((e) => [e.entity_id, e]));
  const extra = (e: Entity, suffix: string) => {
    const v = withUnit(by.get(e.entity_id.replace(/^binary_sensor\./, "sensor.").replace(/_running$/, suffix)));
    return v && v !== "-" && v !== "Off" ? v : undefined;
  };
  return list
    .filter((e) => domainOf(e) === "binary_sensor" && e.attributes.device_class === "running")
    .map((e) => ({ name: nameOf(e).replace(/ running$/i, ""), running: e.state === "on", program: extra(e, "_program"), ends: extra(e, "_ends") }))
    .sort((a, b) => Number(b.running) - Number(a.running) || a.name.localeCompare(b.name));
}
