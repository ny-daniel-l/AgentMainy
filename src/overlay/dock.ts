// The taskbar dock (main pet window only). Rust docks the window along its
// monitor's taskbar; the pet peeks over it with a chip per active agent, and now
// and then grabs the edge, pulls itself up and looks around. Hover or click
// brings the pet out beside a panel with live agents, recent sessions, pet
// stats, token usage, subscription limits and the GitHub contribution year.

import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type Session, basename, agentLabel } from "../agents/state";
import { agentIconUrl, uiIcon } from "../shared/icons";
import { elapsedString, readBubbleConfig } from "./bubble";
import { savedSlug, petDisplayName, getLibrary } from "../pet/catalog";
import { t } from "../shared/i18n";
import * as care from "../pet/care";
import * as usage from "../agents/usage";

interface Box { left: number; top: number; right: number; bottom: number }
interface DockPet {
  headroom: number;
  spriteRect: { x: number; y: number; w: number; h: number } | null;
  // 2D only: the current animation's tallest frame, backing px per sprite pixel,
  // the rows the sheet has, and holding one frame (the peek's glances).
  peakH?: number;
  pixelScale?: number;
  rowCount?: number;
  pose?(row: number | null, frame?: number): void;
  hitTest(cssX: number, cssY: number): boolean;
  fidget(row: number): void;
}
interface GhDay { date: string; contributionCount: number; contributionLevel: string }
interface Github {
  login: string;
  contributionsCollection: {
    totalCommitContributions: number;
    totalPullRequestContributions: number;
    totalPullRequestReviewContributions: number;
    totalIssueContributions: number;
    contributionCalendar: { totalContributions: number; weeks: { contributionDays: GhDay[] }[] };
    commitContributionsByRepository: { repository: { name: string }; contributions: { totalCount: number } }[];
  };
}

// Share of the sprite showing over the taskbar per mood; needing input pops it up most.
const PEEK: Record<string, number> = { idle: 0.55, registered: 0.55, working: 0.65, done: 0.72, waiting: 0.8, celebrate: 0.92 };
// Agents that need you first, then running, then finished.
const ORDER: Record<string, number> = { waiting: 0, working: 1, done: 2 };
const LEVEL: Record<string, number> = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat("en", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

let canvas: HTMLCanvasElement;
let pet: DockPet;
let petRoot: HTMLElement;
let onLayout: () => void;
const panel = document.createElement("div");
const peek = document.createElement("div");
let head: HTMLElement, glanceEl: HTMLElement, agentsEl: HTMLElement, tokensEl: HTMLElement, limitsH: HTMLElement, ghEl: HTMLElement;
let avaCanvas: HTMLCanvasElement; // the small pet shown in the panel's header
let avaCtx: CanvasRenderingContext2D | null = null;

let mood = "idle";
let sessions: Session[] = [];
let line = "";
let expanded = false; // panel showing at all (hover = compact, click = full)
let full = false;     // the full "big tab": tokens, limits, GitHub as well
let pinned = false;
let hovering = false;
let dragging = false;
let hoverTimer: number | undefined;
let petX = 0;
let gh: Github | null | undefined; // undefined = not fetched yet
const targets = new Map<string, Session>(); // data-key -> session, for click-to-focus
const shown = new WeakMap<HTMLElement, string>();

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/// Swap an element's markup only when it changed, so hovers and clicks stay put.
function put(el: HTMLElement, html: string) {
  if (shown.get(el) === html) return;
  shown.set(el, html);
  el.innerHTML = html;
}

const key = (s: Session) => `${s.agent}:${s.session}`;
const proj = (s: { project: string; agent: string }) => (s.project ? basename(s.project) : agentLabel(s.agent));
const dayLabel = (day: string) => new Date(`${day}T00:00`).toLocaleDateString("en", { month: "short", day: "numeric" });
const stateLabel = (s: Session) => t(s.state === "waiting" ? "Needs you" : s.state === "done" ? "Done" : "Working");

/// Agents that need you first, then running, then finished; kinds hidden in
/// Settings (Visible agents) left out. Used for the small peek chips.
function live(): Session[] {
  const hidden = readBubbleConfig().hidden;
  return sessions.filter((s) => s.state in ORDER && !hidden.includes(s.agent))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.updatedAt - a.updatedAt);
}

/// Every open chat (any state), most urgent first , for the panel list, so you
/// can see and click-to-focus them all, not only the actively-working ones.
function allOpen(): Session[] {
  const hidden = readBubbleConfig().hidden;
  const rank = (s: Session) => (s.state in ORDER ? ORDER[s.state] : s.state === "registered" ? 3 : 4);
  return sessions.filter((s) => !hidden.includes(s.agent))
    .sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
}

/// An agent's icon, honouring Settings → Agent icons (brand logo, symbol or emoji).
function icon(kind: string): string {
  const choice = localStorage.getItem(`ap_icon_${kind}`) ?? `brand:${kind}`;
  if (choice.startsWith("sym:")) return `<span class="dk-sym">${uiIcon(choice.slice(4))}</span>`;
  if (choice.startsWith("emoji:")) return `<span class="dk-sym">${esc(choice.slice(6))}</span>`;
  const url = agentIconUrl(choice.slice(6));
  return url ? `<img src="${url}" alt="">` : `<b class="dk-letter">${esc(kind.slice(0, 1).toUpperCase())}</b>`;
}

function saveX(fraction: number) {
  try { localStorage.setItem("ap_dock_x", String(Math.min(1, Math.max(0, fraction)))); } catch {}
}
const savedX = () => {
  const v = parseFloat(localStorage.getItem("ap_dock_x") ?? "");
  return Number.isFinite(v) ? v : 0.85;
};

// ---- markup -------------------------------------------------------------------

function peekHtml(): string {
  const all = live();
  const chips = all.slice(0, 3).map((s) =>
    `<span class="dk-chip" data-state="${s.state}" data-key="${esc(key(s))}" aria-label="${esc(`${proj(s)}: ${stateLabel(s)}`)}">` +
    `<i class="dk-st"></i>${icon(s.agent)}<span>${esc(proj(s))}</span></span>`);
  if (all.length > 3) chips.push(`<span class="dk-chip">+${all.length - 3}</span>`);
  return chips.join("");
}

function headHtml(): string {
  const slug = savedSlug();
  const s = care.stateFor(slug || "");
  const xp = Math.round(care.levelProgress(s.xp) * 100);
  return `<div class="dk-title"><b>${esc(slug ? petDisplayName(slug) : t("Your pet"))}</b>` +
    `<span class="dk-lv">${t("Lv")} ${care.displayLevel(s.xp)} · ${t(care.stageName(care.levelForXP(s.xp)))}</span></div>` +
    (line ? `<div class="dk-line">“${esc(line)}”</div>` : "") +
    `<div class="dk-xp" title="${xp}% ${t("to next level")}"><div style="width:${xp}%"></div></div>` +
    `<div class="dk-stats"><span class="cap">${t(care.hunger(s))}</span>` +
    `<span>${xp}% ${t("to next level")}</span>` +
    `<span>${compact.format(care.tokensToNextLevel(s))} ${t("tokens to go")}</span></div>`;
}

/// Today's numbers plus a couple of lifetime totals , the "more data" strip.
function glanceHtml(): string {
  const s = care.stateFor(savedSlug() || "");
  const todayCost = usage.todayCostUSD();
  const chip = (v: string, label: string) => `<div class="dk-kpi"><b>${v}</b><span>${esc(label)}</span></div>`;
  return `<h3>${t("Today")}</h3><div class="dk-kpis">` +
    chip(compact.format(s.tokensToday), t("tokens")) +
    chip(String(s.mealsToday), t("sessions")) +
    chip(todayCost > 0 ? usd.format(todayCost) : "—", t("cost")) +
    chip(`${s.streakDays}`, t("day streak")) +
    chip(compact.format(s.totalTokens), t("tokens all-time")) +
    chip(`${(s.unlockedAchievements || []).length}/${care.ACHIEVEMENTS.length}`, t("badges")) +
    `</div>`;
}

function agentsHtml(): string {
  const all = allOpen();
  const rows = all.map((s) => {
    const ap = s.pendingApproval;
    const sub = ap ? `${ap.tool}: ${ap.summary}`
      : s.state === "waiting" ? s.live || t("Needs you")
      : s.state === "done" ? s.title || t("Done")
      : s.state === "working" ? s.live || s.title || t("Working")
      : s.title || t("Idle");
    const end = ap
      ? `<span class="dk-ap"><button data-ap="allow" data-id="${esc(ap.id)}">${t("Allow")}</button>` +
        `<button data-ap="deny" data-id="${esc(ap.id)}">${t("Deny")}</button></span>`
      : s.state === "done"
        ? `<span class="tm">${new Date(s.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>`
        : `<span class="tm" data-since="${s.stateSince}"></span>`;
    return `<div class="dk-row${s.terminalFocusUrl ? " focus" : ""}" data-state="${s.state}" data-key="${esc(key(s))}">` +
      `<i class="dk-st"></i>${icon(s.agent)}<span class="tx"><b>${esc(proj(s))}</b><span>${esc(sub)}</span></span>${end}` +
      `<button class="dk-x" data-dismiss title="${t("Dismiss")}" aria-label="${t("Dismiss")}">✕</button></div>`;
  }).join("");
  return `<h3>${t("Agents")}${all.length ? ` <span>${all.length}</span><button class="dk-clear" data-clear>${t("Clear all")}</button>` : ""}</h3>` +
    (rows || `<div class="dk-empty">${t("No agents running")}</div>`);
}

/// 14 daily columns, one series: rounded data end, square baseline, the peak labelled.
function barsSvg(days: { day: string; tokens: number }[]): string {
  const W = 276, H = 74, base = 60, top = 12, step = W / days.length, bw = Math.min(14, step - 4);
  const max = Math.max(...days.map((d) => d.tokens));
  if (!max) return `<div class="dk-empty">${t("No tokens recorded yet")}</div>`;
  let cols = "";
  days.forEach((d, i) => {
    const h = d.tokens ? Math.max(2, Math.round((d.tokens / max) * (base - top))) : 0;
    const x = i * step + (step - bw) / 2, y = base - h, r = Math.min(4, h, bw / 2);
    cols += `<g><title>${dayLabel(d.day)}: ${d.tokens.toLocaleString("en")} ${t("tokens")}</title>` +
      `<rect class="hit" x="${i * step}" y="0" width="${step}" height="${base}"/>` +
      (h ? `<path class="bar" d="M${x} ${base}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + bw - r}Q${x + bw} ${y} ${x + bw} ${y + r}V${base}Z"/>` : "") +
      `</g>`;
  });
  const px = Math.min(W - 14, Math.max(14, days.findIndex((d) => d.tokens === max) * step + step / 2));
  return `<svg class="dk-bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t("Tokens per day, last 14 days")}">${cols}` +
    `<line class="base" x1="0" x2="${W}" y1="${base + 0.5}" y2="${base + 0.5}"/>` +
    `<text x="${px}" y="${top - 3}" text-anchor="middle">${compact.format(max)}</text>` +
    `<text x="0" y="${H - 2}">${dayLabel(days[0].day)}</text><text x="${W}" y="${H - 2}" text-anchor="end">${t("Today")}</text></svg>`;
}

function tokensHtml(): string {
  const sum = usage.summary();
  // Claude cost is priced from transcripts at API list rates, not what a plan bills.
  const money = (v: number) => (v > 0 ? ` · ≈${usd.format(v)} API` : "");
  const top = sum.byAgent.filter((a) => a.tokens > 0).slice(0, 4);
  const projs = sum.byProject.filter((p) => p.tokens > 0).slice(0, 4);
  const maxA = Math.max(1, ...top.map((a) => a.tokens));
  const maxP = Math.max(1, ...projs.map((p) => p.tokens));
  const bar = (lead: string, label: string, tokens: number, max: number) =>
    `<div class="dk-by">${lead}<span>${esc(label)}</span>` +
    `<span class="track"><span style="width:${(tokens / max) * 100}%"></span></span>` +
    `<span class="v">${compact.format(tokens)}</span></div>`;
  const d14 = usage.daily(14);
  const tot14 = d14.reduce((n, x) => n + x.tokens, 0);
  return `<h3>${t("Tokens")} <span>${t("last 14 days")}</span></h3>` +
    `<div class="dk-tiles" title="${t("Cost is estimated at API list prices")}">` +
    `<div><b>${compact.format(sum.todayTokens)}</b><span>${t("Today")}${money(usage.todayCostUSD())}</span></div>` +
    `<div><b>${compact.format(sum.monthTokens)}</b><span>${t("This month")}${money(usage.monthlyCostUSD())}</span></div></div>` +
    barsSvg(d14) +
    `<div class="dk-note">${compact.format(tot14)} ${t("in 14 days")} · ${compact.format(Math.round(tot14 / 14))}/${t("day avg")}</div>` +
    (top.length ? `<h3>${t("By agent")}</h3>` + top.map((a) => bar(icon(a.key), agentLabel(a.key), a.tokens, maxA)).join("") : "") +
    (projs.length ? `<h3>${t("By project")}</h3>` + projs.map((p) => bar(`<i class="dk-pdot"></i>`, p.key, p.tokens, maxP)).join("") : "");
}

/// The last year of contributions as GitHub draws it: a week per column, Sunday on top.
function githubHtml(): string {
  const h = `<h3>GitHub${gh ? ` <span>@${esc(gh.login)}</span>` : ""}</h3>`;
  if (gh === undefined) return `${h}<div class="dk-empty">${t("Loading…")}</div>`;
  if (!gh) return `${h}<div class="dk-empty">${t("Sign in to the GitHub CLI (gh auth login) to see your history.")}</div>`;
  const c = gh.contributionsCollection;
  const weeks = c.contributionCalendar.weeks;
  const S = 11;
  let cells = "", months = "", lastMonth = -1, lastLabel = -9;
  weeks.forEach((w, x) => {
    const first = new Date(`${w.contributionDays[0].date}T00:00`);
    if (first.getMonth() !== lastMonth) {
      lastMonth = first.getMonth();
      if (x - lastLabel >= 3 && x < weeks.length - 2) {
        months += `<text x="${x * S}" y="8">${first.toLocaleDateString("en", { month: "short" })}</text>`;
        lastLabel = x;
      }
    }
    for (const d of w.contributionDays) {
      cells += `<rect class="c${LEVEL[d.contributionLevel] ?? 0}" x="${x * S}" y="${12 + new Date(`${d.date}T00:00`).getDay() * S}" width="9" height="9" rx="2">` +
        `<title>${dayLabel(d.date)}: ${d.contributionCount} ${t("contributions")}</title></rect>`;
    }
  });
  const repos = c.commitContributionsByRepository
    .map((r) => `<b>${esc(r.repository.name)}</b> ${r.contributions.totalCount}`).join(" · ");
  return h +
    `<div class="dk-ghsum"><b>${c.contributionCalendar.totalContributions.toLocaleString("en")}</b> ${t("contributions in the last year")}` +
    ` · ${c.totalCommitContributions} ${t("commits")} · ${c.totalPullRequestContributions} PRs` +
    ` · ${c.totalPullRequestReviewContributions} ${t("reviews")} · ${c.totalIssueContributions} ${t("issues")}</div>` +
    `<svg class="dk-heat" viewBox="0 0 ${weeks.length * S} ${12 + 7 * S}" role="img" aria-label="${t("GitHub contributions, last year")}">${months}${cells}</svg>` +
    `<div class="dk-ghfoot"><span>${repos ? `${t("Top repos")}: ${repos}` : ""}</span>` +
    `<span class="dk-legend">${t("Less")}<i class="c0"></i><i class="c1"></i><i class="c2"></i><i class="c3"></i><i class="c4"></i>${t("More")}</span></div>`;
}

// ---- peek life: grab the taskbar edge, pull up, look around ---------------------
// A pet with its own peek art holds on to the taskbar the whole time and just
// glances around; others grab it with drawn gloves now and then.

// A cartoon glove gripping the taskbar's top edge (o outline, f fill, s crease):
// white gloves suit any pet, from people to cats to robots.
const PAW = [".ooooo.", "ofsfsfo", "ofsfsfo", "offfffo"];
const GLOVE: Record<string, string> = { o: "#1b1b22", f: "#f4f4f6", s: "#b9bcc8" };
const still = matchMedia("(prefers-reduced-motion: reduce)");
const hands = document.createElement("canvas");
let extra = 0; // extra share of the sprite shown: a pull-up (+) or a duck (-)
let lookDir = 0; // where the peek glances: -1 left, 0 at you, 1 right
let routine = 0; // bumped to cancel the routine in flight
let busy = false; // a routine has the pet posed, lifted or gripping

type Step = [after: number, act: () => void];
const ROUTINES: Step[][] = [
  // grab the edge, pull up, look at you, glance left and right, let go
  [[0, () => grip(true)], [200, () => lift(0.16)], [1200, () => look(-1)], [900, () => look(1)],
    [900, () => look(0)], [800, () => { lift(0); grip(false); }]],
  // a quick look around
  [[0, () => look(-1)], [1000, () => look(1)], [1000, () => look(0)], [700, () => grip(false)]],
  // peekaboo: duck out of sight, then pop back up
  [[0, () => lift(-0.24)], [900, () => lift(0.1)], [600, () => lift(0)]],
];
// Holding on with its peek art: just a look around now and then.
const GLANCES: Step[][] = [
  [[0, () => look(-1)], [1500, () => look(0)]],
  [[0, () => look(1)], [1500, () => look(0)]],
  [[0, () => look(-1)], [1100, () => look(1)], [1100, () => look(0)]],
];

const calm = () => !expanded && !dragging && !still.matches && ["idle", "registered", "working", "done"].includes(mood);

function lift(v: number) {
  busy = true;
  extra = v;
  update();
}

/// Glance left (-1), right (1) or back at you (0): with the pet's peek art when it
/// has some, else its own run-left / run-right frames.
function look(dir: number) {
  busy = true;
  lookDir = dir;
  if (peekArt()) { update(); return; } // the held art follows lookDir
  if (!pet.pose || (pet.rowCount ?? 0) < 3) return;
  pet.pose(dir < 0 ? 2 : dir > 0 ? 1 : null);
  canvas.dataset.look = dir < 0 ? "left" : dir > 0 ? "right" : ""; // CSS leans it that way
}

/// Grab the taskbar edge with drawn gloves, or let go.
function grip(on: boolean) {
  if (peekArt() || !pet.pose) return; // art pets always hold on; the 3D pet has no paws
  busy = true;
  if (on) drawPaws();
  document.body.classList.toggle("dk-grip", on);
}

// The current pet's peek art (library `peekUrl`), loaded once per pet.
const art = document.createElement("canvas");
let artImg: HTMLImageElement | null = null;
let artFor: string | null | undefined;
let artKey = ""; // frame + scale on the art canvas now, to skip redraws
function peekArt(): HTMLImageElement | null {
  const slug = savedSlug();
  if (slug !== artFor) {
    artFor = slug;
    artImg = null;
    artKey = "";
    const url = getLibrary().find((p) => p.slug === slug)?.peekUrl;
    if (url) {
      const img = new Image();
      img.onload = () => { if (artFor === slug) artImg = img; };
      img.src = url;
    }
  }
  return artImg;
}

/// Draw peek-art frame `i` (0 at you, 1 left, 2 right) at the sheet's pixel scale.
function drawArt(img: HTMLImageElement, i: number) {
  const fw = img.naturalWidth / 3, fh = img.naturalHeight;
  const k = (canvas.clientWidth / (canvas.width || 1)) * (pet.pixelScale || 1); // CSS px per sprite pixel
  if (artKey === `${i}|${k}`) return;
  artKey = `${i}|${k}`;
  art.width = fw;
  art.height = fh;
  art.getContext("2d")!.drawImage(img, i * fw, 0, fw, fh, 0, 0, fw, fh);
  art.style.width = `${fw * k}px`;
  art.style.height = `${fh * k}px`;
  art.style.left = `${(canvas.clientWidth - fw * k) / 2}px`;
}

/// Drop whatever a routine was doing (on opening, dragging, or an urgent mood).
function settle() {
  routine++;
  if (!busy) return;
  busy = false;
  extra = 0;
  lookDir = 0;
  pet.pose?.(null);
  canvas.dataset.look = "";
  document.body.classList.remove("dk-grip");
}

function behave() {
  window.setTimeout(() => {
    if (calm()) {
      const id = ++routine;
      let at = 0;
      const pool = peekArt() ? GLANCES : ROUTINES;
      for (const [after, act] of pool[Math.floor(Math.random() * pool.length)]) {
        at += after;
        window.setTimeout(() => { if (id === routine) act(); }, at);
      }
    }
    behave();
  }, 5000 + Math.random() * 6000);
}

/// Two gloves either side of the head, sized to the pet (sheets range from chunky
/// pixel art to fine art, so the pet's own pixel size can't be the unit).
function drawPaws() {
  const pw = PAW[0].length, gap = 10; // glove pixels: one glove's width, the head between
  const w = pw * 2 + gap;
  hands.width = w;
  hands.height = PAW.length;
  const ctx = hands.getContext("2d")!;
  for (const x0 of [0, pw + gap]) {
    PAW.forEach((row, y) => [...row].forEach((ch, x) => {
      if (!GLOVE[ch]) return;
      ctx.fillStyle = GLOVE[ch];
      ctx.fillRect(x0 + x, y, 1, 1);
    }));
  }
  const k = (canvas.clientWidth * 0.13) / pw; // CSS px per paw pixel
  hands.style.width = `${w * k}px`;
  hands.style.height = `${PAW.length * k}px`;
  hands.style.left = `${(canvas.clientWidth - w * k) / 2}px`; // sprites sit centred in the canvas
}

// ---- layout + state -----------------------------------------------------------

/// Copy the current sprite frame from the main pet canvas into the small header
/// avatar (bottom-aligned, aspect kept, crisp pixels).
function drawAva() {
  const sr = pet.spriteRect;
  if (!avaCtx || !sr || !sr.w || !sr.h) return;
  const S = 56;
  if (avaCanvas.width !== S) { avaCanvas.width = S; avaCanvas.height = S; }
  avaCtx.imageSmoothingEnabled = false;
  avaCtx.clearRect(0, 0, S, S);
  const scale = Math.min(S / sr.w, S / sr.h);
  const dw = sr.w * scale, dh = sr.h * scale;
  try { avaCtx.drawImage(canvas, sr.x, sr.y, sr.w, sr.h, (S - dw) / 2, S - dh, dw, dh); } catch {}
}

function refresh() {
  drawAva();
  put(head, headHtml());
  put(glanceEl, glanceHtml());
  put(agentsEl, agentsHtml());
  put(tokensEl, tokensHtml());
  limitsH.textContent = t("Limits");
  put(ghEl, githubHtml());
  panel.querySelectorAll<HTMLElement>("[data-since]").forEach((el) => {
    el.textContent = elapsedString(Number(el.dataset.since));
  });
}

function setExpanded(v: boolean, asFull = false) {
  clearTimeout(hoverTimer); // an explicit open/close beats a pending hover one
  const nextFull = v && asFull;
  if (v === expanded && nextFull === full) return;
  const wasOpen = expanded;
  expanded = v;
  full = nextFull;
  document.body.classList.toggle("dk-open", v);
  // Set the layout class only when opening; on close leave it so the panel fades
  // out in its current layout instead of flashing the other one.
  if (v) document.body.classList.toggle("dk-full", full);
  if (v) {
    if (!wasOpen) { settle(); pet.fidget(3); } // wave hello once on the way out
    refresh();
    // GitHub only shows in the full tab , fetch it then, not on every hover.
    if (full && gh === undefined) {
      void invoke<Github | null>("get_github")
        .then((g) => { gh = g ?? null; }, () => { gh = null; })
        .then(refresh);
    }
  }
  update();
}

function setPetX(x: number) {
  petX = Math.max(0, Math.min(innerWidth - canvas.clientWidth, x));
  petRoot.style.left = `${petX}px`;
}

/// Sink the pet to its peek height, put chips + panel beside it, report hit rects.
function update() {
  const kx = canvas.clientWidth / (canvas.width || 1);
  const ky = canvas.clientHeight / (canvas.height || 1);
  const sr = pet.spriteRect;
  // Steady per animation: a crouching frame ducks lower instead of re-sinking the pet.
  const refH = pet.peakH || sr?.h;
  const spriteH = refH ? refH * ky : canvas.clientHeight * (1 - pet.headroom);
  const show = expanded || dragging ? 1 : Math.min(1, Math.max(0.08, (PEEK[mood] ?? 0.4) + extra));
  canvas.style.setProperty("--sink", `${Math.round((1 - show) * spriteH)}px`);
  // A pet with peek art holds on to the taskbar the whole time; its sprite shows
  // only when it comes out (panel open) or is carried.
  const held = expanded || dragging ? null : peekArt();
  if (held) drawArt(held, lookDir < 0 ? 1 : lookDir > 0 ? 2 : 0);
  document.body.classList.toggle("dk-showart", !!held);
  // Chips and panel go on the side of the pet with more room.
  const sl = petX + (held ? art.offsetLeft : sr ? sr.x * kx : 0);
  const sw = held ? art.offsetWidth : sr ? sr.w * kx : canvas.clientWidth;
  const right = sl + sw / 2 < innerWidth / 2;
  peek.classList.toggle("rev", !right);
  peek.style.left = right ? `${sl + sw + 4}px` : "";
  peek.style.right = right ? "" : `${innerWidth - sl + 4}px`;
  const pw = panel.offsetWidth;
  panel.style.left = `${Math.max(8, Math.min(innerWidth - pw - 8, right ? sl + sw + 8 : sl - pw - 8))}px`;
  onLayout();
}

// ---- API for main.ts ----------------------------------------------------------

export function init(o: {
  canvas: HTMLCanvasElement; pet: DockPet; petRoot: HTMLElement; limitsWrap: HTMLElement; onLayout: () => void;
}) {
  ({ canvas, pet, petRoot, onLayout } = o);
  document.body.classList.add("dock");
  panel.className = "dk-panel";
  // A vertical dashboard: pet → today's KPIs → open chats → usage → limits →
  // GitHub, stacked in one tall column. The compact hover panel shows only the
  // pet + open-chats cards.
  panel.innerHTML =
    `<div class="dk-dash">` +
    `<section class="dk-card dk-pet"><div class="dk-head"></div></section>` +
    `<section class="dk-card dk-glance"></section>` +
    `<section class="dk-card dk-agents-c"><div class="dk-agents"></div></section>` +
    `<section class="dk-card dk-usage"><div class="dk-tokens"></div></section>` +
    `<section class="dk-card dk-sys"><div class="dk-limits"><h3></h3></div><div class="dk-gh"></div></section>` +
    `</div>`;
  const q = (sel: string) => panel.querySelector(sel) as HTMLElement;
  [head, glanceEl, agentsEl, tokensEl, limitsH, ghEl] =
    [q(".dk-head"), q(".dk-glance"), q(".dk-agents"), q(".dk-tokens"), q(".dk-limits h3"), q(".dk-gh")];
  q(".dk-limits").appendChild(o.limitsWrap);
  // A small live pet in the header (its own canvas, kept out of head's innerHTML
  // so refresh() doesn't wipe it). Drawn from the main sprite each refresh.
  avaCanvas = document.createElement("canvas");
  avaCanvas.className = "dk-ava";
  q(".dk-pet").insertBefore(avaCanvas, head);
  avaCtx = avaCanvas.getContext("2d");
  peek.className = "dk-peek";
  hands.className = "dk-hands";
  art.className = "dk-art";
  petRoot.append(hands, art);
  peekArt(); // start loading this pet's peek art, if it has some
  document.body.append(panel, peek);
  setPetX(savedX() * (innerWidth - canvas.clientWidth));

  // Allow/Deny a gated tool call, dismiss or clear agents, else jump to the agent's terminal.
  const click = (e: MouseEvent) => {
    const el = e.target as HTMLElement;
    const ap = el.closest<HTMLElement>("[data-ap]");
    if (ap) { void invoke("resolve_approval", { id: ap.dataset.id, decision: ap.dataset.ap }); return; }
    const row = el.closest<HTMLElement>("[data-key]");
    if (el.closest("[data-clear]")) { void emit("sessions-clear", null); return; }
    if (el.closest("[data-dismiss]")) { if (row) void emit("session-dismiss", row.dataset.key); return; }
    const s = targets.get(row?.dataset.key ?? "");
    if (s?.terminalFocusUrl) void invoke("focus_terminal", { program: s.terminalProgram, focusUrl: s.terminalFocusUrl });
  };
  panel.addEventListener("click", click);
  peek.addEventListener("click", click);

  // Click the pet to pin the panel open (or shut). Drag it along the taskbar, or
  // lift it off and let go over another screen to move it there.
  let drag: { x0: number; y0: number; px0: number; moved: boolean } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (pet.spriteRect && !pet.hitTest(e.offsetX, e.offsetY))) return;
    drag = { x0: e.clientX, y0: e.clientY, px0: petX, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag || (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5)) return;
    if (!drag.moved) {
      drag.moved = dragging = true;
      pinned = false;
      settle();
      setExpanded(false);
      document.body.classList.add("dk-drag");
    }
    setPetX(drag.px0 + e.clientX - drag.x0);
    petRoot.style.bottom = `${Math.max(0, Math.min(innerHeight - canvas.clientHeight, drag.y0 - e.clientY))}px`;
    update();
  });
  const end = (click: boolean) => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    dragging = false;
    document.body.classList.remove("dk-drag");
    petRoot.style.bottom = ""; // drops back onto the taskbar
    if (moved) {
      saveX(petX / Math.max(1, innerWidth - canvas.clientWidth));
      // Let go over another screen: Rust moves the dock onto that taskbar.
      void invoke<[number, number] | null>("dock_drop").then((at) => {
        if (!at) return;
        saveX((at[0] - canvas.clientWidth / 2) / Math.max(1, at[1] - canvas.clientWidth));
        setPetX(savedX() * (innerWidth - canvas.clientWidth));
        update();
      });
    } else if (click) {
      pinned = !pinned;
      if (pinned) {
        setExpanded(true, true); // click opens the full big tab
        // Focused, so clicking into another app blurs us and closes the pin.
        void getCurrentWindow().setFocus();
      } else {
        setExpanded(hovering, false); // back to the compact hover panel, or shut
      }
    }
    update();
  };
  canvas.addEventListener("pointerup", () => end(true));
  canvas.addEventListener("pointercancel", () => end(false));
  canvas.addEventListener("transitionend", () => onLayout());

  // A pinned panel closes on Escape or when you click into another app.
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { pinned = false; setExpanded(false); }
  });
  window.addEventListener("blur", () => {
    if (!pinned) return;
    pinned = false;
    setExpanded(hovering, false); // drop to compact if still hovered, else shut
  });
  window.addEventListener("resize", () => { setPetX(savedX() * (innerWidth - canvas.clientWidth)); update(); });
  behave();
}

/// Called on every main.ts render tick (500 ms) and agent event.
export function render(all: Session[], m: string, petLine: string) {
  sessions = all;
  mood = m;
  line = petLine;
  if (!calm()) settle();
  targets.clear();
  for (const s of all) targets.set(key(s), s);
  put(peek, peekHtml());
  if (expanded) refresh();
  update();
}

/// Cursor entered/left the pet, its chips or the open panel (from the Rust hit loop).
export function setHover(on: boolean) {
  hovering = on;
  clearTimeout(hoverTimer);
  if (dragging || pinned) return;
  // Hover intent: sweeping the mouse down to the taskbar mustn't pop the panel.
  // Hover opens the compact panel; a click (pin) is what opens the full tab.
  if (on !== expanded) hoverTimer = window.setTimeout(() => setExpanded(on, false), on ? 280 : 420);
}

/// Interactive regions (CSS px) for click-through: the visible sprite plus the
/// chips, or the panel while open; the whole window while dragging.
export function hitRects(): Box[] {
  if (dragging) return [{ left: 0, top: 0, right: innerWidth, bottom: innerHeight }];
  const cr = canvas.getBoundingClientRect();
  const sr = pet.spriteRect;
  const kx = cr.width / (canvas.width || 1), ky = cr.height / (canvas.height || 1);
  const out: Box[] = [document.body.classList.contains("dk-showart") ? art.getBoundingClientRect()
    : sr ? { left: cr.left + sr.x * kx, top: cr.top + sr.y * ky, right: cr.left + (sr.x + sr.w) * kx, bottom: Math.min(innerHeight, cr.top + (sr.y + sr.h) * ky) }
    : { left: cr.left, top: innerHeight - 50, right: cr.right, bottom: innerHeight }];
  const b = (expanded ? panel : peek).getBoundingClientRect();
  if (b.width) out.push(b);
  return out;
}
