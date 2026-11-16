// A big number with a label, for the stat strip on top of the Overview.
import { h } from "../atoms/h";
import { icon, type IconName } from "../atoms/icon";
import type { Tone } from "../atoms/badge";

export function stat(label: string, value: string | number, opts: { hint?: string; icon?: IconName; tone?: Tone } = {}): HTMLElement {
  return h(
    "div",
    { class: `stat tone-${opts.tone ?? "off"}` },
    opts.icon ? icon(opts.icon, "ic stat-ic") : null,
    h("div", { class: "stat-text" },
      h("div", { class: "stat-value" }, String(value)),
      h("div", { class: "stat-label" }, label),
      opts.hint ? h("div", { class: "stat-hint" }, opts.hint) : null,
    ),
  );
}
