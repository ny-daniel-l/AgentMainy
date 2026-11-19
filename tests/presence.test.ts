import { test } from "node:test";
import assert from "node:assert/strict";
import { lastChange, presence, sinceText } from "../src/dashboard/services/presence.ts";

const now = Date.parse("2026-11-19T20:00:00");
const min = (m: number) => now - m * 60_000;
const person = (id: string, state: string, name?: string) =>
  ({ entity_id: `person.${id}`, state, attributes: name ? { friendly_name: name } : {}, last_changed: new Date(now).toISOString() }) as any;

test("people at home first, a short absence is 'maybe asleep'", () => {
  const list = [person("chris", "not_home", "Chris"), person("ben", "not_home", "Ben"), person("ada", "home", "Ada"),
    { entity_id: "sensor.x", state: "1", attributes: {} } as any];
  const p = presence(list, { "person.chris": min(600), "person.ben": min(10), "person.ada": min(90) }, now);
  assert.deepEqual(p.map((x) => [x.name, x.home, x.maybeAsleep]), [["Ada", true, false], ["Ben", false, true], ["Chris", false, false]]);
});

test("no history yet: no time and never 'maybe asleep'", () => {
  const [p] = presence([person("ben", "not_home", "Ben")], {}, now);
  assert.equal(p.since, undefined);
  assert.equal(p.maybeAsleep, false);
});

test("last change skips the same-state rows a restart writes", () => {
  const rows = [{ t: min(900), s: "home" }, { t: min(600), s: "not_home" }, { t: min(30), s: "not_home" }];
  assert.equal(lastChange(rows), min(600));
  assert.equal(lastChange([{ t: min(900), s: "home" }, { t: min(5), s: "home" }]), undefined);
  assert.equal(lastChange([]), undefined);
});

test("since text: today, this week, older", () => {
  assert.match(sinceText(min(60), now), /^since \d\d:\d\d$/);
  assert.match(sinceText(now - 3 * 86_400_000, now), /^since \S+ \d\d:\d\d$/);
  assert.match(sinceText(now - 20 * 86_400_000, now), /^since \S+/);
  assert.equal(sinceText(undefined, now), "");
});

test("a live arrival counts even before the recorder has it", () => {
  const history = [{ t: min(900), s: "home" }, { t: min(600), s: "not_home" }];
  assert.equal(lastChange([...history, { t: min(1), s: "home" }]), min(1));
  assert.equal(lastChange([...history, { t: min(1), s: "not_home" }]), min(600)); // a restart: same state
  assert.equal(lastChange([{ t: min(1), s: "home" }]), undefined); // no history yet
});

test("'maybe asleep' lasts 15 min, on top of HA's own 10 min grace (#23)", () => {
  const asleep = (m: number) => presence([person("ben", "not_home", "Ben")], { "person.ben": min(m) }, now)[0].maybeAsleep;
  assert.deepEqual([asleep(14), asleep(16), asleep(25)], [true, false, false]);
});
