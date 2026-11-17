import { h } from "./h";
import { icon, type IconName } from "./icon";

export interface ButtonOpts {
  variant?: "primary" | "ghost" | "danger";
  icon?: IconName;
  title?: string;
  disabled?: boolean;
}

export function button(label: string, onClick: (e: Event) => void, opts: ButtonOpts = {}): HTMLButtonElement {
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
  // State lives on the button on screen (e.currentTarget): a live refresh
  // patches in place and leaves an armed button alone (see mount()).
  return button(label, (e) => {
    const btn = e.currentTarget as HTMLButtonElement & { __armed?: number };
    const disarm = () => {
      window.clearTimeout(btn.__armed);
      btn.__armed = undefined;
      btn.lastChild!.textContent = label;
      btn.classList.remove("armed");
    };
    if (btn.__armed !== undefined) {
      disarm();
      onConfirm();
      return;
    }
    btn.lastChild!.textContent = confirmLabel;
    btn.classList.add("armed");
    btn.__armed = window.setTimeout(disarm, 3500);
  }, opts);
}
