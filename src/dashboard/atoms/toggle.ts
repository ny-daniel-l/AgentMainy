// An on/off switch (a real checkbox underneath, so keyboard and screen readers work).
import { h } from "./h";

export function toggle(checked: boolean, onChange: (on: boolean) => void, label: string): HTMLLabelElement {
  const input = h("input", { type: "checkbox", "aria-label": label, checked,
    onchange: (e: Event) => onChange((e.currentTarget as HTMLInputElement).checked) });
  return h("label", { class: "switch" }, input, h("span", { class: "switch-track", "aria-hidden": "true" }));
}
