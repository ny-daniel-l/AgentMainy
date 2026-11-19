// One chip per person: name, home or away, and since when.
import { h } from "../atoms/h";
import { sinceText, type Presence } from "../services/presence";

const WHY = "Home Assistant counts someone as home while their phone is on the home Wi-Fi. A locked phone can drop off the Wi-Fi for a while.";

export function personChips(people: Presence[]): HTMLElement {
  if (!people.length) return h("span", { class: "muted" }, "No people set up in Home Assistant");
  return h("div", { class: "people-chips" },
    ...people.map((p) => {
      const tone = p.home ? "home" : p.maybeAsleep ? "maybe" : "away";
      const sub = p.maybeAsleep ? "phone asleep?" : `${p.home ? "home" : "away"} ${sinceText(p.since)}`;
      return h("span", { class: `person-chip pc-${tone}`, "data-id": p.id, title: `${p.name}: ${sub.trim()}. ${WHY}` },
        h("span", { class: "pc-dot", "aria-hidden": "true" }),
        h("b", null, p.name),
        h("span", { class: "pc-sub" }, sub.trim()));
    }));
}
