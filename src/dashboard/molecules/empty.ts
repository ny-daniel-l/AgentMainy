// What a card shows when there is nothing to list yet.
import { h, type Child } from "../atoms/h";
import { icon, type IconName } from "../atoms/icon";

export function empty(text: string, opts: { icon?: IconName; action?: Child } = {}): HTMLElement {
  return h("div", { class: "empty" },
    opts.icon ? icon(opts.icon, "ic empty-ic") : null,
    h("p", null, text),
    opts.action ?? null,
  );
}
