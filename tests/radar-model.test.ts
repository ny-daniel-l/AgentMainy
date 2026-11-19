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

test("devices carry their IP for the contact list", () => {
  const list = [{ entity_id: "sensor.router_devices", state: "2", attributes: { devices: [
    { name: "TV", mac: "aa", active: true, ip: "10.0.0.5", first_seen: "2026-01-01T00:00:00Z" },
    { name: "Box", mac: "bb", active: true, first_seen: "2026-01-01T00:00:00Z" },
  ] } }] as any;
  const [tv, box] = r.contacts(list, { devices: true, now: Date.parse("2026-02-01T00:00:00Z") });
  assert.equal(tv.ip, "10.0.0.5");
  assert.equal(box.ip, undefined);
});

test("only an IPv4 address is shown", () => {
  const list = [{ entity_id: "sensor.router_devices", state: "1", attributes: { devices: [
    { name: "Echo", mac: "cc", active: true, ip: "2a02:1210::1", first_seen: "2026-01-01T00:00:00Z" },
  ] } }] as any;
  assert.equal(r.contacts(list, { devices: true })[0].ip, undefined);
});

test("your own device names replace the router's", () => {
  const list = [{ entity_id: "sensor.router_devices", state: "1", attributes: { devices: [
    { name: "Miele-001D63", mac: "dd", active: true, first_seen: "2026-01-01T00:00:00Z" },
  ] } }] as any;
  assert.equal(r.contacts(list, { devices: true, names: { dd: "Washing machine" } })[0].label, "Washing machine");
});
