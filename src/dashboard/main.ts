// Dashboard entry (dashboard.html). The sidebar switches pages; the original
// AgentPet pages (General, Pet, Care, Dock, History, About) are wired by
// pages/settings.ts exactly as before, the new ones by the DashPage modules.

import "./pages/settings"; // original pages: runs their setup on import
import { h, mount } from "./atoms/h";
import { pill } from "./atoms/badge";
import { overviewPage } from "./pages/overview";
import { teamPage } from "./pages/team";
import { homePage } from "./pages/home";
import type { DashPage } from "./pages/page";
import { counts, onSessions } from "./services/sessions";
import { ha, haConfig } from "./services/home-assistant";
import { peopleHome } from "./services/home-model";

const PAGES: DashPage[] = [overviewPage, teamPage, homePage];

const HEADINGS: Record<string, [string, string]> = {
  overview: ["Overview", "Your agents, your pet, your home and your team at a glance"],
  team: ["Team", "A whole team of Claude Code agents on one project, powered by UltraClaude"],
  home: ["Home", "Your Home Assistant, live"],
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

// The original tab handler (settings.ts) toggles .page.sel; this runs after it.
document.querySelector(".tabbar")!.addEventListener("click", (e) => {
  const tab = (e.target as HTMLElement).closest<HTMLButtonElement>(".tab");
  if (!tab?.dataset.tab || tab.dataset.tab === current) return;
  PAGES.find((p) => p.id === current)?.hide?.();
  current = tab.dataset.tab;
  setHeading(current);
  document.body.dataset.page = current;
  PAGES.find((p) => p.id === current)?.show?.();
});

for (const page of PAGES) {
  page.mount(document.getElementById(`page-${page.id}`)!);
}
setHeading(current);
document.body.dataset.page = current;
onSessions(renderStatus);
ha.onChange(renderStatus);
renderStatus();
