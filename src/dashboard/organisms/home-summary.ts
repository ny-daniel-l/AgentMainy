// The Overview's Home card: who is home, the door and the internet in a few
// lines, or a button to connect Home Assistant.
import { h } from "../atoms/h";
import { pill } from "../atoms/badge";
import { button } from "../atoms/button";
import { card } from "../molecules/card";
import { empty } from "../molecules/empty";
import { personChips } from "../molecules/person-chips";
import { lastChange, presence } from "../services/presence";
import { ha, haConfig } from "../services/home-assistant";
import * as model from "../services/home-model";

// Each person's state history (cached; refetched when someone comes or goes)
let rows: Record<string, { t: number; s: string }[]> = {};
let changedKey = "";
let changedAt = 0;

function refreshChanged(list: ReturnType<typeof ha.entities>) {
  const people = list.filter((e) => e.entity_id.startsWith("person."));
  const key = people.map((e) => `${e.entity_id}=${e.state}`).join(",");
  if (key === changedKey && Date.now() - changedAt < 10 * 60_000) return;
  changedKey = key;
  changedAt = Date.now();
  const ids = people.map((e) => e.entity_id);
  if (!ids.length) return;
  ha.stateHistory(ids, 24 * 7)
    .then((h) => { rows = h; })
    .catch(() => { changedKey = ""; });
}

/** Last change per person: the history plus the live state, which the recorder may not have written yet. */
function lastChanges(list: ReturnType<typeof ha.entities>): Record<string, number | undefined> {
  return Object.fromEntries(list.filter((e) => e.entity_id.startsWith("person.")).map((e) =>
    [e.entity_id, lastChange([...(rows[e.entity_id] ?? []), { t: Date.parse(e.last_changed ?? ""), s: e.state }])]));
}

export function homeSummary(goTo: (page: string) => void): HTMLElement {
  if (!haConfig()) {
    return card({ title: "Home", icon: "home" },
      empty("Connect Home Assistant to see who is home, your door and your internet.", {
        icon: "home",
        action: button("Connect Home Assistant", () => goTo("settings"), { variant: "primary", icon: "plug" }),
      }));
  }
  if (ha.status !== "online") {
    return card({ title: "Home", icon: "home", aside: pill(ha.status, ha.status === "error" ? "bad" : "info") },
      empty(ha.error || "Connecting to Home Assistant…", { icon: "home" }));
  }
  const list = ha.entities();
  refreshChanged(list);
  const lock = model.locks(list)[0];
  const net = model.internet(list);
  return card(
    { title: "Home", icon: "home", aside: button("Open", () => goTo("house"), { icon: "home" }) },
    personChips(presence(list, lastChanges(list))),
    h("div", { class: "summary-lines" },
      lock ? h("div", null, h("span", { class: "muted" }, `${model.nameOf(lock)} `), pill(lock.state, lock.state === "locked" ? "ok" : "warn")) : null,
      net.online !== undefined || net.download
        ? h("div", null, h("span", { class: "muted" }, "Internet "),
            pill(net.online === false ? "offline" : "online", net.online === false ? "bad" : "ok"),
            net.download ? h("span", { class: "muted" }, ` ↓ ${net.download}`) : null)
        : null,
    ),
  );
}
