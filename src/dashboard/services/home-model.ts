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
export const nameOf = (e: Entity): string => e.attributes.friendly_name || e.entity_id;
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
