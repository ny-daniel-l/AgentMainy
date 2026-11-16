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
