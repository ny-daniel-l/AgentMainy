// A thin progress bar with a caption, e.g. the pet's XP to the next level.
import { h } from "../atoms/h";

export function meter(fraction: number, caption?: string): HTMLElement {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return h("div", { class: "meter" },
    h("div", { class: "meter-track", role: "progressbar", "aria-valuenow": pct, "aria-valuemin": 0, "aria-valuemax": 100 },
      h("div", { class: "meter-fill", style: `width:${pct}%` }),
    ),
    caption ? h("div", { class: "meter-cap" }, caption) : null,
  );
}
