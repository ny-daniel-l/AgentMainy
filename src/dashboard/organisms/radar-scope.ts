// The presence radar: a PPI scope drawn on a canvas. A beam sweeps clockwise
// from north; one full turn is one "ping". Like a phosphor screen, a blip
// lights up when the beam passes it and then fades (the afterglow), and the
// beam drags a fading trail. The page calls pingNow() on every scan. People are diamonds, devices small squares,
// unknown devices blinking triangles.

import type { Contact } from "../services/radar-model";
import { ago } from "../services/home-model";
import { RADAR_COLORS, settings } from "../services/settings";

export interface ScopeOptions {
  color: string;          // "#rrggbb"
  period: number;         // seconds per turn
  afterglow: number;      // seconds a blip stays lit
  labels: boolean;
  mini?: boolean;         // small version for the Overview: no labels, no bearings
  still?: boolean;        // reduced motion: no sweep, every blip lit
}

const TAU = Math.PI * 2;

interface Label { k: Contact; x: number; y: number; lit: number; col: string }
interface Box { x: number; y: number; w: number; h: number }

/** Where the 000-330 bearing numbers sit, so blip labels keep clear of them. */
function bearingBoxes(cx: number, cy: number, R: number): Box[] {
  const boxes: Box[] = [];
  for (let d = 0; d < 360; d += 30) {
    const a = (d / 360) * TAU - Math.PI / 2;
    boxes.push({ x: cx + Math.cos(a) * (R + 14) - 12, y: cy + Math.sin(a) * (R + 14) - 7, w: 24, h: 14 });
  }
  return boxes;
}
const ORDER: Record<Contact["kind"], number> = { person: 0, unknown: 1, device: 2 };
const MONO = '"Cascadia Mono", "Consolas", monospace';

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

export class RadarScope {
  /** Called every frame with the seconds left until the beam is back north. */
  onFrame?: (secondsToPing: number) => void;

  private ctx: CanvasRenderingContext2D;
  private contacts: Contact[] = [];
  private raf = 0;
  private t0 = performance.now();
  private pingAt = -1e9;
  private size = { w: 0, h: 0, dpr: 1 };

  constructor(private canvas: HTMLCanvasElement, private opts: ScopeOptions) {
    this.ctx = canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  setContacts(list: Contact[]) {
    this.contacts = list;
    if (!this.raf) this.draw(performance.now());
  }

  setOptions(o: Partial<ScopeOptions>) {
    // Keep the beam where it is when the speed changes.
    if (o.period && o.period !== this.opts.period) {
      const now = performance.now();
      const phase = ((now - this.t0) / (this.opts.period * 1000)) % 1;
      this.t0 = now - phase * o.period * 1000;
    }
    Object.assign(this.opts, o);
    if (!this.raf) this.draw(performance.now());
  }

  start() {
    if (this.raf) return;
    const loop = (t: number) => { this.draw(t); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** A ping happened: put the beam back to north and run the ping ring. */
  pingNow() {
    this.t0 = performance.now();
    this.pingAt = this.t0;
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.size = { w: r.width, h: r.height, dpr };
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.draw(performance.now());
  }

  private draw(now: number) {
    const { ctx, opts } = this;
    const { w, h, dpr } = this.size;
    if (!w || !h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const period = opts.period * 1000;
    const phase = ((now - this.t0) % period) / period;
    this.onFrame?.((1 - phase) * opts.period);

    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) / 2 - (opts.mini ? 3 : 26);
    const beam = phase * TAU;                      // bearing of the beam, radians
    const toCanvas = (bearing: number) => bearing - Math.PI / 2;
    const c = opts.color;

    // scope face
    const face = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    face.addColorStop(0, rgba(c, 0.10));
    face.addColorStop(0.7, rgba(c, 0.035));
    face.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = face;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();

    // range rings + crosshair
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      ctx.strokeStyle = rgba(c, i === 4 ? 0.55 : 0.2);
      ctx.beginPath(); ctx.arc(cx, cy, (R * i) / 4, 0, TAU); ctx.stroke();
    }
    ctx.strokeStyle = rgba(c, 0.14);
    ctx.beginPath();
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.stroke();

    // bearing ticks + labels
    if (!opts.mini) {
      ctx.font = `10px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let d = 0; d < 360; d += 5) {
        const a = toCanvas((d / 360) * TAU);
        const len = d % 30 === 0 ? 9 : d % 10 === 0 ? 5 : 2.5;
        ctx.strokeStyle = rgba(c, d % 30 === 0 ? 0.6 : 0.3);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.lineTo(cx + Math.cos(a) * (R - len), cy + Math.sin(a) * (R - len));
        ctx.stroke();
        if (d % 30 === 0) {
          ctx.fillStyle = rgba(c, 0.65);
          ctx.fillText(String(d).padStart(3, "0"), cx + Math.cos(a) * (R + 14), cy + Math.sin(a) * (R + 14));
        }
      }
    }

    // beam trail (the phosphor afterglow behind the beam) + the beam itself
    if (!opts.still) {
      const trail = Math.PI * 0.55;
      const start = toCanvas(beam) - trail;
      const g = ctx.createConicGradient(start, cx, cy);
      g.addColorStop(0, rgba(c, 0));
      g.addColorStop(trail / TAU, rgba(c, 0.3));
      g.addColorStop(Math.min(1, trail / TAU + 0.0001), rgba(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, start, toCanvas(beam)); ctx.closePath(); ctx.fill();
      const a = toCanvas(beam);
      ctx.strokeStyle = rgba(c, 0.95);
      ctx.lineWidth = 1.6;
      ctx.shadowColor = c; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // ping: a ring running out from the centre for 1.4 s
    const since = (now - this.pingAt) / 1400;
    if (since >= 0 && since < 1) {
      ctx.strokeStyle = rgba(c, (1 - since) * 0.6);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, R * since, 0, TAU); ctx.stroke();
    }

    // contacts
    const blink = Math.floor(now / 450) % 2 === 0;
    const labels: Label[] = [];
    for (const k of this.contacts) {
      const b = (k.bearing / 360) * TAU;
      const age = opts.still ? 0 : (((beam - b + TAU) % TAU) / TAU) * opts.period;
      const floor = k.kind === "person" ? 0.4 : k.kind === "unknown" ? 0.3 : 0.14;
      const lit = Math.max(floor, Math.exp(-age / Math.max(0.5, opts.afterglow)));
      const a = toCanvas(b);
      const x = cx + Math.cos(a) * k.range * R;
      const y = cy + Math.sin(a) * k.range * R;
      const col = k.kind === "unknown" ? "#ffb547" : c;
      ctx.fillStyle = rgba(col, lit);
      ctx.shadowColor = col;
      ctx.shadowBlur = 10 * lit;
      ctx.beginPath();
      if (k.kind === "person") {
        const s = opts.mini ? 4 : 6.5;
        ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y);
      } else if (k.kind === "unknown") {
        const s = opts.mini ? 4 : 6;
        if (blink || opts.still) { ctx.moveTo(x, y - s); ctx.lineTo(x + s, y + s * 0.8); ctx.lineTo(x - s, y + s * 0.8); }
      } else {
        const s = opts.mini ? 1.6 : 2.6;
        ctx.rect(x - s, y - s, s * 2, s * 2);
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      if (k.kind === "person" && !opts.mini) {
        ctx.strokeStyle = rgba(col, lit * 0.6);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 11, 0, TAU); ctx.stroke();
      }
      if (opts.labels && !opts.mini) labels.push({ k, x, y, lit, col });
    }
    this.drawLabels(labels, opts.mini ? [] : bearingBoxes(cx, cy, R));

    // home marker
    ctx.fillStyle = rgba(c, 0.9);
    ctx.beginPath(); ctx.arc(cx, cy, opts.mini ? 2 : 3, 0, TAU); ctx.fill();
  }

  /**
   * Names beside the blips without overlapping: people first, then unknown,
   * then devices. Each label tries right, left, above, below; a device label
   * (not a person or a new device) with no free spot is left out (it is still in the contact list).
   */
  private drawLabels(labels: Label[], reserved: Box[]) {
    const { ctx } = this;
    const { w: W, h: H } = this.size;
    // every dot counts as taken, so no name is written over another contact
    const taken: Box[] = [...reserved, ...labels.map(({ x, y }) => ({ x: x - 7, y: y - 7, w: 14, h: 14 }))];
    // inside the canvas and clear of every label (and bearing number) already placed
    const free = (x: number, y: number, w: number, h: number) =>
      x >= 2 && y >= 2 && x + w <= W - 2 && y + h <= H - 2 &&
      !taken.some((b) => x < b.x + b.w + 4 && x + w + 4 > b.x && y < b.y + b.h + 1 && y + h + 1 > b.y);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    for (const { k, x, y, lit, col } of labels.sort((a, b) => ORDER[a.k.kind] - ORDER[b.k.kind])) {
      const person = k.kind === "person";
      const text = person ? k.label.toUpperCase() : k.kind === "unknown" ? `?? ${k.label}` : k.label;
      const font = `${person ? "600 11.5px" : "10.5px"} ${MONO}`;
      ctx.font = font;
      const subText = person && k.since ? `HOME ${ago(k.since).replace(" ago", "").toUpperCase()}` : "";
      let w = ctx.measureText(text).width;
      if (subText) { ctx.font = `9.5px ${MONO}`; w = Math.max(w, ctx.measureText(subText).width); ctx.font = font; }
      const h = subText ? 25 : 13;
      const spots: [number, number][] = [[x + 12, y - 7], [x - 12 - w, y - 7], [x - w / 2, y - 14 - h], [x - w / 2, y + 12]];
      const spot = spots.find(([sx, sy]) => free(sx, sy, w, h))
        ?? (k.kind !== "device" ? [Math.min(Math.max(2, spots[0][0]), W - w - 2), spots[0][1]] as [number, number] : undefined);
      if (!spot) continue;
      taken.push({ x: spot[0], y: spot[1], w, h });
      ctx.font = font;
      ctx.fillStyle = rgba(col, Math.max(k.kind === "device" ? 0.62 : 0.75, lit));
      ctx.fillText(text, spot[0], spot[1]);
      if (subText) {
        ctx.font = `9.5px ${MONO}`;
        ctx.fillStyle = rgba(col, Math.max(0.55, lit * 0.8));
        ctx.fillText(subText, spot[0], spot[1] + 13);
      }
    }
  }
}

/** Scope options from the Settings page. */
export function scopeOptions(extra: Partial<ScopeOptions> = {}): ScopeOptions {
  const s = settings();
  return {
    color: RADAR_COLORS[s.radarColor],
    period: s.radarInterval,
    afterglow: s.radarAfterglow,
    labels: s.radarLabels,
    still: s.reduceMotion,
    ...extra,
  };
}
