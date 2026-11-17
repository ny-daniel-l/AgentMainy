// A row of mutually exclusive buttons ("Auto | Off | Low | …").
import { h } from "./h";

export interface Segment<T extends string | number> {
  value: T;
  label: string;
}

export function segmented<T extends string | number>(
  items: Segment<T>[],
  current: T | undefined,
  onPick: (v: T) => void,
  label: string,
): HTMLElement {
  return h("div", { class: "segs", role: "group", "aria-label": label },
    ...items.map((it) => h("button", {
      type: "button",
      class: `seg-btn${it.value === current ? " on" : ""}`,
      "aria-pressed": String(it.value === current),
      onclick: () => onPick(it.value),
    }, it.label)),
  );
}
