// A short message at the bottom of the dashboard that fades out by itself.
import { h } from "../atoms/h";
import { dot, type Tone } from "../atoms/badge";

export function toast(text: string, tone: Tone = "info", ms = 3500): void {
  const el = h("div", { class: "toast", role: "status" }, dot(tone), text);
  document.body.append(el);
  window.setTimeout(() => el.classList.add("out"), ms);
  window.setTimeout(() => el.remove(), ms + 400);
}
