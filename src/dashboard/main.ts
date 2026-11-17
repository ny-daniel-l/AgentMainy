// Dashboard entry (dashboard.html). The sidebar switches pages; the original
// AgentPet pages (General, Pet, Care, Dock, History, About) are wired by
// pages/original.ts exactly as before, the new ones by the DashPage modules.

import "./pages/original"; // the original AgentPet pages: run their setup on import
import { listen } from "@tauri-apps/api/event";
import { h, mount } from "./atoms/h";
import { pill } from "./atoms/badge";
import { overviewPage } from "./pages/overview";
import { teamPage } from "./pages/team";
import { radarPage } from "./pages/radar";
import { housePage } from "./pages/house";
import { clockPage } from "./pages/clock";
import { networkPage } from "./pages/network";
import { serverPage } from "./pages/server";
import { controlPage } from "./pages/control";
import { settingsPage } from "./pages/settings";
import { goTo, type DashPage } from "./pages/page";
import { counts, onSessions } from "./services/sessions";
import { ha, haConfig } from "./services/home-assistant";
import { peopleHome } from "./services/home-model";
import { startRadar } from "./services/radar";
import { ACCENTS, onSettings, settings, type Settings } from "./services/settings";

const PAGES: DashPage[] = [overviewPage, teamPage, radarPage, housePage, clockPage, networkPage, serverPage, controlPage, settingsPage];

// Each page answers one question.
const HEADINGS: Record<string, [string, string]> = {
  overview: ["Overview", "Your agents, your home and your pet at a glance"],
  team: ["Team", "A whole team of Claude Code agents on one project, powered by UltraClaude"],
  radar: ["Radar", "Who and what is home right now"],
  house: ["House", "Is the door locked, what is running"],
  clock: ["Clock", "Timers and alarm clocks"],
  network: ["Network", "Is the internet up, what is connected"],
  server: ["Server", "Is the Raspberry Pi healthy"],
  control: ["Pi control", "Fan, power and maintenance for the Raspberry Pi"],
  settings: ["Settings", "Home Assistant, radar, server and appearance"],
  pet: ["Pet", "Pick, import or create your pet"],
  care: ["Care", "Your pet eats the tokens your agents burn"],
  bubble: ["Dock & bubble", "How the pet, its dock and its speech bubble look"],
  history: ["History", "Finished sessions and token usage"],
  general: ["General", "Connect agents, notifications, startup and language"],
  about: ["About", "AgentMainy and the projects it is built on"],
};

let current = "overview";

function setHeading(page: string) {
  const [title, sub] = HEADINGS[page] ?? [page, ""];
  document.getElementById("page-title")!.textContent = title;
  document.getElementById("page-sub")!.textContent = sub;
}

/** The pills top right and the status under the sidebar, on every page. */
function renderStatus() {
  const c = counts();
  const home = haConfig() && ha.status === "online" ? peopleHome(ha.entities()).length : null;
  mount(document.getElementById("top-pills")!,
    c.working ? pill(`${c.working} working`, "ok") : null,
    c.waiting ? pill(`${c.waiting} need you`, "warn") : null,
    home !== null ? pill(`${home} home`, "info") : null,
  );
  mount(document.getElementById("side-status")!,
    h("div", null, pill(c.open ? `${c.open} agent${c.open === 1 ? "" : "s"} open` : "no agents", c.working ? "ok" : "off")),
    haConfig() ? h("div", null, pill(`home ${ha.status === "online" ? "live" : ha.status}`, ha.status === "online" ? "ok" : ha.status === "error" ? "bad" : "off")) : null,
  );
}

/** Accent colour and reduced motion from the Settings page. */
function applyLook(s: Settings) {
  const [a, b] = ACCENTS[s.accent] ?? ACCENTS.violet;
  document.body.style.setProperty("--am-accent", a);
  document.body.style.setProperty("--am-accent-2", b);
  document.body.classList.toggle("reduce-motion", s.reduceMotion);
}

// The original tab handler (pages/original.ts) toggles .page.sel; this runs after it.
document.querySelector(".tabbar")!.addEventListener("click", (e) => {
  const tab = (e.target as HTMLElement).closest<HTMLButtonElement>(".tab");
  if (!tab?.dataset.tab || tab.dataset.tab === current) return;
  PAGES.find((p) => p.id === current)?.hide?.();
  current = tab.dataset.tab;
  setHeading(current);
  document.body.dataset.page = current;
  PAGES.find((p) => p.id === current)?.show?.();
});

applyLook(settings());
onSettings(applyLook);
const cfg = haConfig();
if (cfg) ha.connect(cfg).catch(() => {}); // keeps retrying in the background
startRadar();
for (const page of PAGES) {
  page.mount(document.getElementById(`page-${page.id}`)!);
}
setHeading(current);
document.body.dataset.page = current;
onSessions(renderStatus);
ha.onChange(renderStatus);
renderStatus();
// The pet's panel can ask for a page: an open dashboard hears the event, a
// freshly opened one finds the page in am_goto. Otherwise: the start page
// (first-run onboarding opens Pet itself).
listen<string>("dashboard-goto", (e) => { localStorage.removeItem("am_goto"); goTo(e.payload); });
const asked = localStorage.getItem("am_goto");
localStorage.removeItem("am_goto");
if (asked) goTo(asked);
else if (settings().startPage !== "overview" && !location.search.includes("onboarding")) goTo(settings().startPage);
