// Status atoms. Colour only ever means state: green = working / ok,
// amber = needs you, blue = info, grey = idle or off.
import { h } from "./h";

export type Tone = "ok" | "warn" | "info" | "off" | "bad";

/** A small coloured dot (pulses when tone is "ok" and live is set). */
export function dot(tone: Tone, live = false): HTMLSpanElement {
  return h("span", { class: `dot dot-${tone}${live ? " live" : ""}`, "aria-hidden": "true" });
}

/** A rounded label like "working" or "2 home". */
export function pill(text: string, tone: Tone = "off"): HTMLSpanElement {
  return h("span", { class: `pill pill-${tone}` }, dot(tone), text);
}

/** Maps an agent session state to its tone. */
export function stateTone(state: string): Tone {
  if (state === "working") return "ok";
  if (state === "waiting") return "warn";
  if (state === "done") return "info";
  return "off";
}
