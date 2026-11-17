import { test } from "node:test";
import assert from "node:assert/strict";
import * as r from "../src/dashboard/services/radar-model.ts";
import type { Entity } from "../src/dashboard/services/home-model.ts";

const e = (entity_id: string, state: string, attributes: Record<string, unknown> = {}): Entity =>
  ({ entity_id, state, attributes, last_changed: "2026-01-01T10:00:00Z" });

const now = Date.parse("2026-01-02T12:00:00Z");
const house: Entity[] = [
  e("person.ada", "home", { friendly_name: "Ada" }),
  e("person.bob", "not_home", { friendly_name: "Bob" }),
  e("sensor.router_devices", "4", { devices: [
    { name: "Ada-iPhone", active: true, mac: "aa", first_seen: "2025-06-01T00:00:00Z" },
    { name: "Visitor phone", active: true, mac: "bb", first_seen: "2026-01-02T11:00:00Z" },
    { name: "TV", active: false, mac: "cc" },
    { name: "wl0", active: true, mac: "_x" },
  ] }),
];

test("contacts: people at home + online devices; a device first seen today is unknown", () => {
  const c = r.contacts(house, { devices: true, now });
  assert.deepEqual(c.map((x) => [x.label, x.kind]), [["Ada", "person"], ["Ada-iPhone", "device"], ["Visitor phone", "unknown"]]);
  assert.deepEqual(r.contacts(house, { devices: false, now }).map((x) => x.label), ["Ada"]);
});

test("placement is stable and stays inside each kind's band", () => {
  for (const id of ["person.ada", "dev:aa", "dev:bb", "x", "a much longer id with spaces"]) {
    const p = r.place(id, "person");
    assert.deepEqual(r.place(id, "person"), p);
    assert.ok(p.bearing >= 0 && p.bearing < 360);
    assert.ok(p.range >= 0.16 && p.range <= 0.42);
    const d = r.place(id, "device");
    assert.ok(d.range >= 0.58 && d.range <= 0.93);
  }
  assert.notEqual(r.place("a", "device").bearing, r.place("b", "device").bearing);
});

test("diff reports contacts acquired and lost between two scans", () => {
  const before = r.contacts(house, { devices: true, now });
  const after = before.filter((c) => c.label !== "Ada-iPhone").concat({ id: "person.bob", label: "Bob", kind: "person", bearing: 1, range: 0.2 });
  const ev = r.diff(before, after, 5);
  assert.deepEqual(ev.map((x) => [x.type, x.label]), [["acquired", "Bob"], ["lost", "Ada-iPhone"]]);
  assert.deepEqual(r.diff(after, after), []);
});

test("readouts", () => {
  assert.equal(r.bearingText(5), "005°");
  assert.equal(r.bearingText(359.6), "000°");
  assert.equal(r.ring(0.1), 1);
  assert.equal(r.ring(0.93), 4);
});
