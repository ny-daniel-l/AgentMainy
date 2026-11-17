// Overview: the whole picture on one screen. Stats on top, then your agents,
// the radar, your pet, your home, the Pi and your agent team.
import { h, mount } from "../atoms/h";
import { pill } from "../atoms/badge";
import { button } from "../atoms/button";
import { card } from "../molecules/card";
import { stat } from "../molecules/stat";
import { empty } from "../molecules/empty";
import { agentsPanel } from "../organisms/agents-panel";
import { petPanel } from "../organisms/pet-panel";
import { homeSummary } from "../organisms/home-summary";
import { RadarScope, scopeOptions } from "../organisms/radar-scope";
import { counts, onSessions } from "../services/sessions";
import { ha, haConfig } from "../services/home-assistant";
import { currentFolder, folderName } from "../services/team";
import { peopleHome, server } from "../services/home-model";
import { onScan, radarState } from "../services/radar";
import { formatTemp, onSettings, RADAR_COLORS, settings } from "../services/settings";
import * as care from "../../pet/care";
import { savedSlug } from "../../pet/catalog";
import { goTo, scheduler, type DashPage } from "./page";

// The mini radar keeps its canvas across re-renders (re-appending a node keeps it alive).
const miniCanvas = h("canvas", { class: "scope", "aria-hidden": "true" });
let mini: RadarScope;

function radarCard(): HTMLElement {
  const c = radarState().contacts;
  const n = (k: string) => c.filter((x) => x.kind === k).length;
  return card({ title: "Radar", icon: "radar", aside: button("Open", () => goTo("radar"), { icon: "radar" }) },
    h("div", { class: "mini-scope", style: `--radar:${RADAR_COLORS[settings().radarColor]}` }, miniCanvas),
    h("div", { class: "mini-legend" }, `◆ ${n("person")} people   ■ ${n("device")} devices${n("unknown") ? `   ▲ ${n("unknown")} unknown` : ""}`),
  );
}

function serverCard(): HTMLElement | null {
  if (!haConfig() || ha.status !== "online") return null;
  const s = server(ha.entities());
  if (s.temp === undefined) return null;
  const hot = s.temp >= settings().tempWarn;
  return card({ title: "Raspberry Pi", icon: "server", aside: button("Open", () => goTo("server"), { icon: "server" }) },
    h("div", { class: "summary-lines" },
      h("div", null, h("span", { class: "muted" }, "Temperature "), pill(formatTemp(s.temp), hot ? "warn" : "ok")),
      h("div", null, h("span", { class: "muted" }, "Fan "), h("b", null, s.fanRpm ? `${s.fanRpm} rpm` : "off"), h("span", { class: "muted" }, ` · ${s.fanMode ?? "–"}`)),
      s.cpu !== undefined ? h("div", null, h("span", { class: "muted" }, "CPU "), h("b", null, `${Math.round(s.cpu)}%`),
        s.memory !== undefined ? h("span", { class: "muted" }, ` · memory ${Math.round(s.memory)}%`) : null) : null,
    ),
  );
}

function teamCard(): HTMLElement {
  const folder = currentFolder();
  return card({ title: "Agent team", icon: "team" },
    folder
      ? h("div", { class: "summary-lines" },
          h("div", null, h("span", { class: "muted" }, "Project "), h("b", { title: folder }, folderName(folder))),
          h("div", null, button("Open team", () => goTo("team"), { variant: "primary", icon: "team" })))
      : empty("Run a whole team of Claude Code agents on one project, with roles and shared memory.", {
          icon: "team",
          action: button("Start a team", () => goTo("team"), { variant: "primary", icon: "play" }),
        }),
  );
}

let root: HTMLElement;
let visible = true;
let ticker: number | undefined;

function render() {
  const c = counts();
  const slug = savedSlug();
  const tokens = slug ? care.stateFor(slug).tokensToday : 0;
  const homeOnline = !!haConfig() && ha.status === "online";
  const temp = homeOnline ? server(ha.entities()).temp : undefined;
  mount(root,
    h("div", { class: "stats" },
      stat("working", c.working, { icon: "agents", tone: c.working ? "ok" : "off" }),
      stat("need you", c.waiting, { icon: "spark", tone: c.waiting ? "warn" : "off" }),
      stat("at home", homeOnline ? peopleHome(ha.entities()).length : "–", { icon: "home", tone: "info" }),
      stat("Pi temperature", temp === undefined ? "–" : formatTemp(temp), { icon: "thermo", tone: temp !== undefined && temp >= settings().tempWarn ? "warn" : "info" }),
      stat("tokens today", tokens.toLocaleString(), { icon: "pet", tone: "info" }),
    ),
    h("div", { class: "grid" },
      agentsPanel({ wide: true, max: 6 }),
      radarCard(),
      homeSummary(goTo),
      petPanel(goTo),
      serverCard(),
      teamCard(),
    ),
  );
}

const queue = scheduler(render, () => visible);

export const overviewPage: DashPage = {
  id: "overview",
  mount(el) {
    root = el;
    mini = new RadarScope(miniCanvas, scopeOptions({ mini: true, labels: false }));
    mini.setContacts(radarState().contacts);
    onScan(() => { mini.setContacts(radarState().contacts); mini.pingNow(); queue(); });
    onSettings(() => { mini.setOptions(scopeOptions({ mini: true, labels: false })); queue(); });
    onSessions(queue);
    ha.onChange(queue);
    render();
    this.show!();
  },
  show() {
    visible = true;
    render();
    mini.start();
    window.clearInterval(ticker);
    ticker = window.setInterval(queue, 5000); // elapsed times, hunger clock
  },
  hide() {
    visible = false;
    mini.stop();
    window.clearInterval(ticker);
  },
};
