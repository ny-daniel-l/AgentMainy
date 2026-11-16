import { h } from "./h";
import { icon, type IconName } from "./icon";

export interface ButtonOpts {
  variant?: "primary" | "ghost" | "danger";
  icon?: IconName;
  title?: string;
  disabled?: boolean;
}

export function button(label: string, onClick: () => void, opts: ButtonOpts = {}): HTMLButtonElement {
  return h(
    "button",
    {
      class: `btn btn-${opts.variant ?? "ghost"}`,
      type: "button",
      title: opts.title,
      disabled: opts.disabled,
      onclick: onClick,
    },
    opts.icon ? icon(opts.icon) : null,
    label,
  );
}

/**
 * A button that asks for a second click before acting ("Unlock" -> "Click
 * again to unlock"), for actions you do not want to fire by accident.
 * Native confirm() dialogs are unreliable inside the app's webview.
 */
export function confirmButton(label: string, confirmLabel: string, onConfirm: () => void, opts: ButtonOpts = {}): HTMLButtonElement {
  let armed: number | undefined;
  const btn = button(label, () => {
    if (armed !== undefined) {
      window.clearTimeout(armed);
      armed = undefined;
      btn.lastChild!.textContent = label;
      btn.classList.remove("armed");
      onConfirm();
      return;
    }
    btn.lastChild!.textContent = confirmLabel;
    btn.classList.add("armed");
    armed = window.setTimeout(() => {
      armed = undefined;
      btn.lastChild!.textContent = label;
      btn.classList.remove("armed");
    }, 3500);
  }, opts);
  return btn;
}
