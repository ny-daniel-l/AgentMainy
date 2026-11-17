// A big button for one action: icon, title and a line of explanation.
// With `confirm`, the first click arms it ("Click again to …") for 3.5 s and
// only the second click runs it, like confirmButton.
import { h } from "../atoms/h";
import { icon, type IconName } from "../atoms/icon";

export interface TileOpts {
  icon: IconName;
  title: string;
  hint: string;
  confirm?: string;          // text shown while armed
  danger?: boolean;
  active?: boolean;          // highlighted (e.g. the running boost)
}

export function actionTile(opts: TileOpts, run: () => void): HTMLButtonElement {
  return h("button", {
    type: "button",
    class: `tile${opts.danger ? " tile-danger" : ""}${opts.active ? " tile-on" : ""}`,
    onclick: (e: Event) => {
      if (!opts.confirm) return run();
      // state on the tile on screen; mount() leaves an armed tile alone
      const el = e.currentTarget as HTMLButtonElement & { __armed?: number };
      const hint = el.querySelector(".tile-hint")!;
      const disarm = () => { window.clearTimeout(el.__armed); el.__armed = undefined; hint.textContent = opts.hint; el.classList.remove("armed"); };
      if (el.__armed !== undefined) { disarm(); run(); return; }
      hint.textContent = opts.confirm;
      el.classList.add("armed");
      el.__armed = window.setTimeout(disarm, 3500);
    },
  },
    icon(opts.icon, "ic tile-ic"),
    h("span", { class: "tile-text" }, h("b", null, opts.title), h("span", { class: "tile-hint" }, opts.hint)),
  );
}
