// One line on the Settings page: what it is, a hint, and its control.
import { h, type Child } from "../atoms/h";

export function settingRow(title: string, hint: string, control: Child): HTMLElement {
  return h("div", { class: "set-row" },
    h("div", { class: "set-text" }, h("div", { class: "set-title" }, title), hint ? h("div", { class: "set-hint" }, hint) : null),
    h("div", { class: "set-control" }, control),
  );
}
