// The Home page's cards: who is home, the door, the internet, appliances,
// timers and the devices online. Built only from what Home Assistant has, so
// a card without matching entities simply does not appear.
import { h } from "../atoms/h";
import { icon } from "../atoms/icon";
import { pill, type Tone } from "../atoms/badge";
import { button, confirmButton } from "../atoms/button";
import { card } from "../molecules/card";
import { row, rows } from "../molecules/row";
import { stat } from "../molecules/stat";
import { empty } from "../molecules/empty";
import { toast } from "../molecules/toast";
import { ha } from "../services/home-assistant";
import * as model from "../services/home-model";
import type { Entity } from "../services/home-model";

const LOCK_TONE: Record<string, Tone> = { locked: "ok", unlocked: "warn", open: "warn", jammed: "bad", locking: "info", unlocking: "info", opening: "info" };

async function act(domain: string, service: string, entity_id: string, data: Record<string, unknown> = {}, done?: string) {
  try {
    await ha.call(domain, service, { entity_id }, data);
    if (done) toast(done, "ok");
  } catch (e) {
    toast(`${domain}.${service} failed: ${(e as Error).message}`, "bad");
  }
}

export function peopleCard(list: Entity[]): HTMLElement {
  const home = model.peopleHome(list);
  const total = model.peopleCount(list);
  return card(
    { title: "Who's home", icon: "person", aside: pill(`${home.length} / ${total} home`, home.length ? "ok" : "off") },
    home.length
      ? rows(home.map((p) => row({
          lead: h("span", { class: "avatar" }, model.nameOf(p).slice(0, 1).toUpperCase()),
          title: model.nameOf(p),
          sub: `home · ${model.ago(p.last_changed)}`,
        })))
      : empty(total ? "Nobody is home right now." : "No people in Home Assistant yet.", { icon: "home" }),
  );
}

export function doorCard(list: Entity[]): HTMLElement | null {
  const locks = model.locks(list);
  const doors = model.doors(list);
  if (!locks.length && !doors.length) return null;
  const lockRows = locks.map((l) => row({
    lead: icon(l.state === "locked" ? "lock" : "unlock"),
    title: model.nameOf(l),
    sub: model.ago(l.last_changed),
    trail: h("span", { class: "trail-stack" },
      pill(l.state, LOCK_TONE[l.state] ?? "off"),
      l.state === "locked"
        ? confirmButton("Unlock", "Click again to unlock", () => act("lock", "unlock", l.entity_id, {}, "Unlocking…"), { icon: "unlock" })
        : button("Lock", () => act("lock", "lock", l.entity_id, {}, "Locking…"), { icon: "lock", variant: "primary" }),
    ),
  }));
  const doorRows = doors.map((d) => row({
    lead: icon("door"),
    title: model.nameOf(d),
    sub: model.ago(d.last_changed),
    trail: pill(d.state === "on" ? "open" : d.state === "off" ? "closed" : d.state, d.state === "on" ? "warn" : d.state === "off" ? "ok" : "off"),
  }));
  return card({ title: "Door", icon: "door" }, rows([...lockRows, ...doorRows]));
}

export function internetCard(list: Entity[]): HTMLElement | null {
  const net = model.internet(list);
  if (net.online === undefined && !net.download) return null;
  return card(
    { title: "Internet", icon: "wifi", aside: net.online === undefined ? null : pill(net.online ? "online" : "offline", net.online ? "ok" : "bad") },
    h("div", { class: "stat-grid" },
      stat("Download", net.download ?? "–", { icon: "speed" }),
      stat("Upload", net.upload ?? "–", { icon: "speed" }),
      stat("Ping", net.ping ?? "–", { icon: "wifi" }),
    ),
  );
}

export function appliancesCard(list: Entity[]): HTMLElement | null {
  if (!model.appliancesCount(list)) return null;
  const running = model.runningAppliances(list);
  return card(
    { title: "Kitchen & appliances", icon: "cook", aside: pill(running.length ? `${running.length} running` : "all idle", running.length ? "ok" : "off") },
    running.length
      ? rows(running.map((a) => row({ lead: icon("cook"), title: a.name, sub: a.ends ? `ends ${a.ends}` : "running" })))
      : empty("Nothing is cooking. Running programs show up here.", { icon: "cook" }),
  );
}

function timerRow(tm: Entity): HTMLElement {
  const active = tm.state === "active";
  const ends = active && tm.attributes.finishes_at
    ? new Date(tm.attributes.finishes_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  const start = (min: number) => button(`${min}m`, () =>
    act("timer", "start", tm.entity_id, { duration: `00:${String(min).padStart(2, "0")}:00` }, `${model.nameOf(tm)}: ${min} min`));
  return row({
    lead: icon("timer"),
    title: model.nameOf(tm),
    sub: active ? `running · ends ${ends}` : tm.state,
    trail: h("span", { class: "trail-stack" },
      ...(active ? [button("Stop", () => act("timer", "cancel", tm.entity_id), { icon: "stop", variant: "danger" })] : [1, 5, 10, 30].map(start)),
    ),
  });
}

export function timersCard(list: Entity[]): HTMLElement | null {
  const timers = model.timers(list);
  if (!timers.length) return null;
  return card({ title: "Timers", icon: "timer" }, rows(timers.map(timerRow)));
}

export function devicesCard(list: Entity[]): HTMLElement | null {
  const names = model.onlineDevices(list);
  if (!names.length) return null;
  return card(
    { title: "Online now", icon: "devices", wide: true, aside: h("span", { class: "count" }, String(names.length)) },
    h("div", { class: "chips" }, ...names.map((n) => h("span", { class: "chip" }, n))),
  );
}

/** All Home cards that have something to show. */
export function homeBoard(list: Entity[]): HTMLElement[] {
  return [peopleCard(list), doorCard(list), internetCard(list), appliancesCard(list), timersCard(list), devicesCard(list)]
    .filter((c): c is HTMLElement => c !== null);
}
