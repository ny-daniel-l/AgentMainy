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

test("updates: only the ones waiting", () => {
  assert.deepEqual(m.updates(pi), [{ id: "update.home_assistant_core_update", name: "Home Assistant Core", installed: "2026.11.1", latest: "2026.11.2" }]);
});

test("alarms: time-only datetimes paired with the switch named like them", () => {
  assert.deepEqual(m.alarms(pi), [{ id: "input_datetime.wecker", name: "Wecker", time: "07:30", switchId: "input_boolean.wecker_aktiv", armed: true }]);
});

test("allDevices lists offline devices too, online first; lockDetails by naming", () => {
  assert.deepEqual(m.allDevices(house).map((d) => [d.name, d.active]), [["Ada-iPhone", true], ["Laptop", true], ["TV", false]]);
  assert.deepEqual(m.lockDetails(pi, "lock.front_door"), { battery: "97 %", lastAction: "Unlocked (app)" });
  assert.equal(m.routerSensorId(house), "sensor.router_devices");
});

test("appliances: running first, with their end time", () => {
  assert.deepEqual(m.appliances(house), [{ name: "Oven", running: true, program: undefined, ends: "18:40" }, { name: "binary_sensor.washer_running", running: false, program: undefined, ends: undefined }]);
});
