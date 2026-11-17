// An on/off switch (a real checkbox underneath, so keyboard and screen readers work).
import { h } from "./h";

export function toggle(checked: boolean, onChange: (on: boolean) => void, label: string): HTMLLabelElement {
  const input = h("input", { type: "checkbox", "aria-label": label, checked });
  input.addEventListener("change", () => onChange(input.checked));
  return h("label", { class: "switch" }, input, h("span", { class: "switch-track", "aria-hidden": "true" }));
}
