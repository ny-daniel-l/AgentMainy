// A small line chart of the last hours with its min / max / now, a time axis
// and the value under the mouse.
import { h } from "../atoms/h";

/** Average many samples (a 10 s sensor gives ~8,600 a day) into `n` buckets. */
function smooth(points: { t: number; v: number }[], n = 120): { t: number; v: number }[] {
  if (points.length <= n) return points;
  const size = points.length / n;
  return Array.from({ length: n }, (_, i) => {
    const slice = points.slice(Math.floor(i * size), Math.floor((i + 1) * size));
    return { t: slice[slice.length - 1].t, v: slice.reduce((a, p) => a + p.v, 0) / slice.length };
  });
}

export function sparkline(raw: { t: number; v: number }[], opts: { unit?: string; digits?: number } = {}): HTMLElement {
  if (raw.length < 2) return h("div", { class: "spark empty-spark" }, "Not enough history yet");
  const points = smooth(raw);
  const W = 300, H = 64, pad = 3;
  const vs = points.map((p) => p.v);
  const min = Math.min(...vs), max = Math.max(...vs);
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const x = (t: number) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - min) / Math.max(1e-9, max - min)) * (H - 2 * pad);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const area = `${line}L${x(t1).toFixed(1)},${H}L${x(t0).toFixed(1)},${H}Z`;
  const fmt = (v: number) => `${v.toFixed(opts.digits ?? 1)}${opts.unit ? " " + opts.unit : ""}`;
  const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const hover = (e: MouseEvent) => {
    const plot = e.currentTarget as HTMLElement;
    const r = plot.getBoundingClientRect();
    const t = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
    const p = points.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
    const tip = plot.querySelector<HTMLElement>(".spark-tip")!;
    tip.hidden = false;
    tip.textContent = `${clock(p.t)} · ${fmt(p.v)}`;
    tip.style.left = `${Math.min(85, Math.max(15, ((p.t - t0) / Math.max(1, t1 - t0)) * 100))}%`;
  };
  return h("div", { class: "spark" },
    h("div", { class: "spark-plot", role: "img", "aria-label": `From ${fmt(min)} to ${fmt(max)}, ${clock(t0)} to now`,
      onmousemove: hover, onmouseleave: (e: Event) => { (e.currentTarget as HTMLElement).querySelector<HTMLElement>(".spark-tip")!.hidden = true; } },
      h("div", { class: "spark-svg",
        html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path class="sp-area" d="${area}"/><path class="sp-line" d="${line}"/></svg>` }),
      h("div", { class: "spark-tip", hidden: true })),
    h("div", { class: "spark-axis", "aria-hidden": "true" },
      h("span", null, clock(t0)), h("span", null, clock((t0 + t1) / 2)), h("span", null, "now")),
    h("div", { class: "spark-legend" },
      h("span", null, `min ${fmt(min)}`), h("span", null, `max ${fmt(max)}`), h("b", null, `now ${fmt(raw[raw.length - 1].v)}`)),
  );
}
