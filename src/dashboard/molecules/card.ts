// A titled panel. Every block on the new pages is a card.
import { h, type Child } from "../atoms/h";
import { icon, type IconName } from "../atoms/icon";

export interface CardOpts {
  title: string;
  icon?: IconName;
  /** Something on the right of the title: a pill, a button or a count. */
  aside?: Child;
  /** Span the full row of the grid. */
  wide?: boolean;
  /** Extra class, e.g. "card-hero". */
  cls?: string;
}

export function card(opts: CardOpts, ...body: Child[]): HTMLElement {
  return h(
    "section",
    { class: `card${opts.wide ? " wide" : ""}${opts.cls ? " " + opts.cls : ""}` },
    h("header", { class: "card-head" },
      opts.icon ? icon(opts.icon) : null,
      h("h3", null, opts.title),
      h("span", { class: "spacer" }),
      opts.aside ?? null,
    ),
    h("div", { class: "card-body" }, ...body),
  );
}
