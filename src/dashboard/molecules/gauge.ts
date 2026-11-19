// A ring gauge: 0-100 % filled, the value in the middle, a label below and,
// when 100 % is not obvious, its scale ("of 85 °C").
import { h } from "../atoms/h";
import type { Tone } from "../atoms/badge";

export function gauge(fraction: number | undefined, value: string, label: string, tone: Tone = "info", scale?: string): HTMLElement {
  const f = fraction === undefined ? 0 : Math.min(1, Math.max(0, fraction));
  const r = 34, c = 2 * Math.PI * r;
  return h("div", { class: `gauge tone-${tone}`, role: "img", "aria-label": `${label}: ${value}${scale ? ` ${scale}` : ""}` },
    // full <svg> markup inside a wrapper, so the parser creates real SVG elements
    h("div", { class: "g-ring", "aria-hidden": "true", html:
      `<svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="${r}" class="g-track"/>` +
      `<circle cx="40" cy="40" r="${r}" class="g-fill" stroke-dasharray="${(f * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 40 40)"/></svg>` }),
    h("div", { class: "g-value" }, value),
    h("div", { class: "g-label" }, label),
    scale ? h("div", { class: "g-scale" }, scale) : null,
  );
}
