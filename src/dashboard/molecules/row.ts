// One line in a list: something on the left (dot, icon or avatar), a title
// with a smaller line under it, and something on the right (pill, time, button).
import { h, type Child } from "../atoms/h";

export interface RowOpts {
  lead?: Child;
  title: string;
  sub?: string;
  trail?: Child;
  onClick?: () => void;
}

export function row(opts: RowOpts): HTMLElement {
  return h(
    "div",
    {
      class: `lrow${opts.onClick ? " click" : ""}`,
      onclick: opts.onClick,
      role: opts.onClick ? "button" : undefined,
      tabindex: opts.onClick ? 0 : undefined,
    },
    opts.lead != null ? h("span", { class: "lrow-lead" }, opts.lead) : null,
    h("span", { class: "lrow-text" },
      h("span", { class: "lrow-title" }, opts.title),
      opts.sub ? h("span", { class: "lrow-sub" }, opts.sub) : null,
    ),
    opts.trail != null ? h("span", { class: "lrow-trail" }, opts.trail) : null,
  );
}

/** Up to `max` rows, then a "+N more" line. */
export function rows(items: HTMLElement[], max = 8): HTMLElement {
  const list = h("div", { class: "lrows" }, ...items.slice(0, max));
  if (items.length > max) list.append(h("div", { class: "lrow-more" }, `+${items.length - max} more`));
  return list;
}
