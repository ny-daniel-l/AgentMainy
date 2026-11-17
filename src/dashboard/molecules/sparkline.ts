// A small line chart of the last hours with its min / max / now.
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
  return h("div", { class: "spark" },
    h("div", { class: "spark-plot", role: "img", "aria-label": `From ${fmt(min)} to ${fmt(max)}`,
      html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path class="sp-area" d="${area}"/><path class="sp-line" d="${line}"/></svg>` }),
    h("div", { class: "spark-legend" },
      h("span", null, `min ${fmt(min)}`), h("span", null, `max ${fmt(max)}`), h("b", null, `now ${fmt(raw[raw.length - 1].v)}`)),
  );
}
