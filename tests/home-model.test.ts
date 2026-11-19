// Runs with `node --test tests/` (Node 22.18+ runs TypeScript directly).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as m from "../src/dashboard/services/home-model.ts";
import type { Entity } from "../src/dashboard/services/home-model.ts";

const e = (entity_id: string, state: string, attributes: Record<string, unknown> = {}): Entity =>
  ({ entity_id, state, attributes });

const house: Entity[] = [
  e("person.ada", "home", { friendly_name: "Ada" }),
  e("person.bob", "not_home", { friendly_name: "Bob" }),
  e("lock.front_door", "locked", { friendly_name: "Front door" }),
  e("binary_sensor.front_door", "off", { device_class: "door" }),
  e("binary_sensor.motion", "on", { device_class: "motion" }),
  e("binary_sensor.1_1_1_1", "on", { device_class: "connectivity" }),
  e("sensor.speedtest_download", "80.2", { unit_of_measurement: "Mbit/s" }),
  e("sensor.speedtest_ping", "unavailable"),
  e("binary_sensor.oven_running", "on", { device_class: "running", friendly_name: "Oven running" }),
  e("sensor.oven_ends", "18:40"),
  e("binary_sensor.washer_running", "off", { device_class: "running" }),
  e("timer.timer", "idle"),
  e("sensor.router_devices", "3", { devices: [
    { name: "Ada-iPhone", active: true, mac: "aa" },
    { name: "TV", active: false, mac: "bb" },
    { name: "wl0", active: true, mac: "_x_wl0" },
    { name: "Laptop", active: true, mac: "cc" },
  ] }),
];

test("only people at home are listed, but all are counted", () => {
  assert.deepEqual(m.peopleHome(house).map(m.nameOf), ["Ada"]);
  assert.equal(m.peopleCount(house), 2);
});

test("locks and door contacts are found by domain and device class", () => {
  assert.deepEqual(m.locks(house).map((x) => x.entity_id), ["lock.front_door"]);
  assert.deepEqual(m.doors(house).map((x) => x.entity_id), ["binary_sensor.front_door"]);
});

test("internet: connectivity sensor + speedtest values, unavailable ones left out", () => {
  assert.deepEqual(m.internet(house), { online: true, download: "80.2 Mbit/s", upload: undefined, ping: undefined });
  assert.deepEqual(m.internet([]), { online: undefined, download: undefined, upload: undefined, ping: undefined });
});

test("running appliances pair with their _ends sensor", () => {
  assert.deepEqual(m.runningAppliances(house), [{ name: "Oven", ends: "18:40" }]);
  assert.equal(m.appliancesCount(house), 2);
});

test("online devices: active only, router pseudo-entries removed, sorted", () => {
  assert.deepEqual(m.onlineDevices(house), ["Ada-iPhone", "Laptop"]);
  assert.deepEqual(m.onlineDevices([]), []);
});

test("ago() reads like a person would say it", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  assert.equal(m.ago("2026-01-01T11:59:40Z", now), "just now");
  assert.equal(m.ago("2026-01-01T11:55:00Z", now), "5 min ago");
  assert.equal(m.ago("2026-01-01T09:00:00Z", now), "3 h ago");
  assert.equal(m.ago("2025-12-29T12:00:00Z", now), "3 d ago");
  assert.equal(m.ago(undefined, now), "");
});

const pi: Entity[] = [
  e("sensor.pi_cpu_temperature", "48.5"), e("sensor.pi_cpu_load", "12"), e("sensor.pi_memory_used", "41.2"),
  e("sensor.pi_disk_used", "9.8"), e("sensor.pi_fan", "2", { rpm: 3083 }),
  e("input_select.pi_fan_mode", "Medium", { options: ["Auto", "Off", "Low", "Medium", "High", "Max"] }),
  e("binary_sensor.rpi_power_status", "off"), e("sensor.pi_ip_address", "10.0.0.5"),
  e("update.home_assistant_core_update", "on", { friendly_name: "Home Assistant Core update", installed_version: "2026.11.1", latest_version: "2026.11.2" }),
  e("update.terminal", "off", { friendly_name: "Terminal update" }),
  e("input_datetime.wecker", "07:30:00", { friendly_name: "Wecker", has_time: true, has_date: false }),
  e("input_datetime.birthday", "2026-05-01", { friendly_name: "Birthday", has_time: false, has_date: true }),
  e("input_boolean.wecker_aktiv", "on", { friendly_name: "Wecker aktiv" }),
  e("sensor.front_door_battery", "97", { unit_of_measurement: "%" }),
  e("sensor.front_door_last_action", "Unlocked (app)"),
];

test("server: the Pi's numbers from sensor.pi_*, power ok when the problem sensor is off", () => {
  const s = m.server(pi);
  assert.equal(s.temp, 48.5);
  assert.equal(s.cpu, 12);
  assert.equal(s.fanLevel, 2);
  assert.equal(s.fanRpm, 3083);
  assert.equal(s.fanMode, "Medium");
  assert.equal(s.fanModes.length, 6);
  assert.equal(s.powerOk, true);
  assert.equal(m.server([]).temp, undefined);
});

test("fan: the mode shown is input_select's, even while the boost script still runs (task #5)", () => {
  // Boost 10 min, then Auto picked: the helper says Auto, the script is still in its delay
  const s = m.server([...pi.filter((x) => x.entity_id !== "input_select.pi_fan_mode"),
    e("input_select.pi_fan_mode", "Auto", { options: ["Auto", "Off", "Low", "Medium", "High", "Max"] }),
    e("script.pi_fan_boost", "on")]);
  assert.equal(s.fanMode, "Auto");
  assert.equal(s.fanBoost, true);
  assert.equal(m.server(pi).fanBoost, false);
});

test("fan: picking a mode during a boost stops the boost first, so its timer cannot override the choice", () => {
  const stop = ["script", "turn_off", { entity_id: "script.pi_fan_boost" }, {}];
  const pick = (o: string) => ["input_select", "select_option", { entity_id: "input_select.pi_fan_mode" }, { option: o }];
  assert.deepEqual(m.fanModeCalls("Auto", true), [stop, pick("Auto")]);
  assert.deepEqual(m.fanModeCalls("Low", true), [stop, pick("Low")]);
  assert.deepEqual(m.fanModeCalls("Medium", false), [pick("Medium")]);
});

test("updates: only the ones waiting", () => {
  assert.deepEqual(m.updates(pi), [{ id: "update.home_assistant_core_update", name: "Home Assistant Core", installed: "2026.11.1", latest: "2026.11.2",
    releaseUrl: undefined, installing: false, percent: undefined }]);
});

test("updates: progress from update_percentage (or the old numeric in_progress), unsafe release links dropped (task #8)", () => {
  const up = (attrs: Record<string, unknown>, state = "on") => m.updates([e("update.x", state, { friendly_name: "X update", installed_version: "1", latest_version: "2", ...attrs })])[0];
  assert.deepEqual([up({ in_progress: true, update_percentage: 42.4 }).installing, up({ in_progress: true, update_percentage: 42.4 }).percent], [true, 42]);
  assert.equal(up({ in_progress: true, update_percentage: null }).percent, undefined);
  assert.equal(up({ in_progress: 70 }).percent, 70);
  assert.equal(up({ in_progress: false }).installing, false);
  assert.equal(up({ release_url: "https://github.com/home-assistant/core/releases/tag/2026.11.2" }).releaseUrl, "https://github.com/home-assistant/core/releases/tag/2026.11.2");
  assert.equal(up({ release_url: "https://x.io/a&calc" }).releaseUrl, undefined);
  assert.equal(up({ release_url: "javascript:alert(1)" }).releaseUrl, undefined);
  assert.equal(up({ in_progress: true }, "off").installing, true); // still listed while installing, even if HA flipped the state
});

test("update rows: waiting -> installing (clicked or seen) -> done, installing first", () => {
  const core = (state: string, installed: string, attrs: Record<string, unknown> = {}) =>
    e("update.home_assistant_core_update", state, { friendly_name: "Home Assistant Core update", installed_version: installed, latest_version: "2026.11.2", ...attrs });
  const os = e("update.os", "on", { friendly_name: "OS update", installed_version: "18.5", latest_version: "18.6" });
  const started = new Map<string, m.Started>();
  const phases = (list: Entity[]) => m.updateRows(list, started).map((r) => [r.name, r.phase, r.percent]);

  assert.deepEqual(phases([os, core("on", "2026.11.1")]), [["OS", "waiting", undefined], ["Home Assistant Core", "waiting", undefined]]);
  started.set("update.home_assistant_core_update", { from: "2026.11.1" }); // clicked Install, HA has not flagged it yet
  assert.deepEqual(phases([os, core("on", "2026.11.1")]), [["Home Assistant Core", "installing", undefined], ["OS", "waiting", undefined]]);
  assert.deepEqual(phases([os, core("on", "2026.11.1", { in_progress: true, update_percentage: 30 })])[0], ["Home Assistant Core", "installing", 30]);
  const done = m.updateRows([os, core("off", "2026.11.2")], started);
  assert.deepEqual(done.map((r) => [r.name, r.phase, r.installed, r.latest]), [["OS", "waiting", "18.5", "18.6"], ["Home Assistant Core", "done", "2026.11.1", "2026.11.2"]]);

  const seen = new Map<string, m.Started>(); // installed from HA's own UI: picked up from in_progress
  m.updateRows([e("update.os", "on", { installed_version: "18.5", latest_version: "18.6", in_progress: true })], seen);
  assert.equal(seen.get("update.os")?.from, "18.5");
  assert.deepEqual(m.updateRows([e("update.os", "off", { installed_version: "18.6", latest_version: "18.6" })], seen).map((r) => r.phase), ["done"]);
});

test("update rows: an install that stops on the old version is not stuck on installing (Tester, #8)", () => {
  const os = (attrs: Record<string, unknown>) => e("update.os", "on", { friendly_name: "OS update", installed_version: "18.5", latest_version: "18.6", ...attrs });
  const row = (list: Entity[], started: Map<string, m.Started>) => { const r = m.updateRows(list, started)[0]; return [r.phase, !!r.failed]; };

  // E1: started from HA's UI, 30 %, then in_progress off on 18.5
  const e1 = new Map<string, m.Started>();
  assert.deepEqual(row([os({ in_progress: true, update_percentage: 30 })], e1), ["installing", false]);
  assert.deepEqual(row([os({ in_progress: false })], e1), ["waiting", true]);

  // E2: clicked here, HA flags it, drops for a restart, comes back on 18.5 (the pending call never errors)
  const e2 = new Map<string, m.Started>([["update.os", { from: "18.5" }]]);
  assert.deepEqual(row([os({})], e2), ["installing", false]); // not flagged yet
  assert.deepEqual(row([os({ in_progress: true })], e2), ["installing", false]);
  assert.deepEqual(row([os({ in_progress: false })], e2), ["waiting", true]);

  // retry: a new click starts over, and this time it works
  e2.set("update.os", { from: "18.5" });
  assert.deepEqual(row([os({})], e2), ["installing", false]);
  assert.deepEqual(row([os({ in_progress: true })], e2), ["installing", false]);
  assert.deepEqual(m.updateRows([e("update.os", "off", { installed_version: "18.6", latest_version: "18.6" })], e2).map((r) => r.phase), ["done"]);
});

test("alarms: time-only datetimes paired with the switch named like them", () => {
  // the switch still pairs by the real name; only the shown name reads "Alarm"
  assert.deepEqual(m.alarms(pi), [{ id: "input_datetime.wecker", name: "Alarm", time: "07:30", switchId: "input_boolean.wecker_aktiv", armed: true }]);
});

test("allDevices lists offline devices too, online first; lockDetails by naming", () => {
  assert.deepEqual(m.allDevices(house).map((d) => [d.name, d.active]), [["Ada-iPhone", true], ["Laptop", true], ["TV", false]]);
  assert.deepEqual(m.lockDetails(pi, "lock.front_door"), { battery: "97 %", lastAction: "Unlocked (app)" });
  assert.equal(m.routerSensorId(house), "sensor.router_devices");
});

test("appliances: running first, with their end time", () => {
  assert.deepEqual(m.appliances(house), [{ name: "Oven", running: true, program: undefined, ends: "18:40" }, { name: "binary_sensor.washer_running", running: false, program: undefined, ends: undefined }]);
});

test("addresses: one or several, each with http:// and no trailing slash", async () => {
  const { normalizeUrl } = await import("../src/dashboard/services/home-assistant.ts");
  assert.equal(normalizeUrl(" 192.168.1.5:8123/ "), "http://192.168.1.5:8123");
  assert.equal(normalizeUrl("homeassistant:8123, https://ha.example/"), "http://homeassistant:8123, https://ha.example");
  assert.equal(normalizeUrl("a:1  b:2"), "http://a:1, http://b:2");
});

test("isAway: Tailscale and public addresses are away, the home network is not (#13)", async () => {
  const { isAway } = await import("../src/dashboard/services/home-assistant.ts");
  for (const u of ["http://100.101.102.103:8123", "http://homeassistant.tail1234.ts.net:8123", "https://abc.ui.nabu.casa"]) assert.equal(isAway(u), true, u);
  for (const u of ["http://192.168.1.5:8123", "http://10.0.0.2:8123", "http://172.20.0.5:8123", "http://homeassistant.local:8123",
    "http://homeassistant:8123", "http://127.0.0.1:8785", "http://localhost:8123", "", "not a url"]) assert.equal(isAway(u), false, u);
});

test("names: device + entity name joined by HA are de-duplicated", () => {
  assert.equal(m.dedupeName("Front door (Nuki) Front door"), "Front door (Nuki)");
  assert.equal(m.dedupeName("Oven Oven"), "Oven");
  assert.equal(m.dedupeName("Living room light"), "Living room light");
  assert.equal(m.dedupeName("Door"), "Door");
});

test("timer durations: H:MM:SS to minutes and back, as the Clock shows them (#18)", () => {
  assert.deepEqual(["0:05:00", "1:30:00", "00:10:30", "", undefined, "5 min"].map(m.durationMin), [5, 90, 11, 0, 0, 0]);
  assert.deepEqual([1, 5, 59, 60, 90].map(m.clockText), ["01:00", "05:00", "59:00", "1:00:00", "1:30:00"]);
});

test("alarm: default names read as 'Alarm', your own names stay", () => {
  assert.equal(m.alarmLabel("Wecker", "input_datetime.wecker"), "Alarm");
  assert.equal(m.alarmLabel("Wecker 2", "input_datetime.wecker_2"), "Alarm 2");
  assert.equal(m.alarmLabel("input_datetime.x", "input_datetime.x"), "Alarm");
  assert.equal(m.alarmLabel("Morning run", "input_datetime.run"), "Morning run");
});

test("alarm pairs with its switch by entity id, so renaming only one of them keeps the pair (#25)", () => {
  const time = (id: string, name: string) => e(`input_datetime.${id}`, "06:45:00", { friendly_name: name, has_time: true, has_date: false });
  const sw = (id: string, name: string, state = "on") => e(`input_boolean.${id}`, state, { friendly_name: name });
  // only the time helper renamed: "Alarm" + "Wecker aktiv"
  assert.deepEqual(m.alarms([time("wecker", "Alarm"), sw("wecker_aktiv", "Wecker aktiv", "off")]).map((a) => [a.name, a.switchId, a.armed]),
    [["Alarm", "input_boolean.wecker_aktiv", false]]);
  // other suffixes, and no friendly names at all
  assert.equal(m.alarms([time("run", "Run"), sw("run_enabled", "x")])[0].switchId, "input_boolean.run_enabled");
  assert.equal(m.alarms([e("input_datetime.nap", "13:00:00", { has_time: true, has_date: false }), e("input_boolean.nap_on", "on", {})])[0].switchId, "input_boolean.nap_on");
  // no id match: the name prefix still pairs; nothing matching: always on
  assert.equal(m.alarms([time("a1", "Gym"), sw("other", "Gym on")])[0].switchId, "input_boolean.other");
  assert.equal(m.alarms([time("a1", "Gym"), sw("other", "Lights")])[0].armed, undefined);
});
