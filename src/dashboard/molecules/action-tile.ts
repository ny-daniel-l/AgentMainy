// A big button for one action: icon, title and a line of explanation.
// With `confirm`, the first click arms it ("Click again to …") for 3.5 s and
// only the second click runs it, like confirmButton. With `hold`, it runs only
// after being held down (mouse, touch, Enter or Space) for 3 s.
import { h } from "../atoms/h";
import { icon, type IconName } from "../atoms/icon";

export interface TileOpts {
  icon: IconName;
  title: string;
  hint: string;
  confirm?: string;          // text shown while armed
  danger?: boolean;
  active?: boolean;          // highlighted (e.g. the running boost)
  hold?: string;             // text shown while held
}

const HOLD_MS = 3000;
type Held = HTMLButtonElement & { __hold?: number };

function holdHandlers(opts: TileOpts, run: () => void) {
  // "armed" also makes mount() leave the tile alone mid-hold
  const release = (el: Held) => {
    if (el.__hold === undefined) return;
    window.clearTimeout(el.__hold);
    el.__hold = undefined;
    el.querySelector(".tile-hint")!.textContent = opts.hint;
    el.classList.remove("armed", "holding");
  };
  const start = (e: Event) => {
    const el = e.currentTarget as Held; // null again once the event is over: keep the element
    if (el.__hold !== undefined) return;
    el.querySelector(".tile-hint")!.textContent = opts.hold!;
    el.classList.add("armed", "holding");
    el.__hold = window.setTimeout(() => { release(el); run(); }, HOLD_MS);
  };
  const stop = (e: Event) => release(e.currentTarget as Held);
  const key = (fn: (e: Event) => void) => (e: Event) => {
    const k = e as KeyboardEvent;
    if ((k.key === "Enter" || k.key === " ") && !k.repeat) { e.preventDefault(); fn(e); }
  };
  return { onpointerdown: start, onpointerup: stop, onpointerleave: stop, onpointercancel: stop, onkeydown: key(start), onkeyup: key(stop), onblur: stop };
}

export function actionTile(opts: TileOpts, run: () => void): HTMLButtonElement {
  return h("button", {
    type: "button",
    class: `tile${opts.danger ? " tile-danger" : ""}${opts.active ? " tile-on" : ""}`,
    ...(opts.hold ? holdHandlers(opts, run) : {}),
    onclick: opts.hold ? undefined : (e: Event) => {
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
