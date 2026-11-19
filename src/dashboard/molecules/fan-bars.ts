// The fan's level as five bars, lit up to the current level (0 = off).
import { h } from "../atoms/h";

export function levelBars(level: number): HTMLElement {
  return h("div", { class: "fan-bars", role: "img", "aria-label": `Fan level ${level} of 4` },
    ...[0, 1, 2, 3, 4].map((i) => h("span", { class: `fan-bar${i <= level && level > 0 ? " on" : ""}${i === 0 ? " zero" : ""}` })));
}
