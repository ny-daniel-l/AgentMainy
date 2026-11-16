// Overview: the whole picture on one screen. Stats on top, then your agents,
// your pet, your home and your agent team.
import { h, mount } from "../atoms/h";
import { button } from "../atoms/button";
import { card } from "../molecules/card";
import { stat } from "../molecules/stat";
import { empty } from "../molecules/empty";
import { agentsPanel } from "../organisms/agents-panel";
import { petPanel } from "../organisms/pet-panel";
import { homeSummary } from "../organisms/home-summary";
import { counts, onSessions } from "../services/sessions";
import { ha, haConfig } from "../services/home-assistant";
import { currentFolder, folderName } from "../services/team";
import { peopleHome } from "../services/home-model";
import * as care from "../../pet/care";
import { savedSlug } from "../../pet/catalog";
import { goTo, scheduler, type DashPage } from "./page";

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
  mount(root,
    h("div", { class: "stats" },
      stat("working", c.working, { icon: "agents", tone: c.working ? "ok" : "off" }),
      stat("need you", c.waiting, { icon: "spark", tone: c.waiting ? "warn" : "off" }),
      stat("at home", homeOnline ? peopleHome(ha.entities()).length : "–", { icon: "home", tone: "info" }),
      stat("tokens today", tokens.toLocaleString(), { icon: "pet", tone: "info" }),
    ),
    h("div", { class: "grid" },
      agentsPanel({ wide: true, max: 6 }),
      petPanel(goTo),
      homeSummary(goTo),
      teamCard(),
    ),
  );
}

const queue = scheduler(render, () => visible);

export const overviewPage: DashPage = {
  id: "overview",
  mount(el) {
    root = el;
    onSessions(queue);
    ha.onChange(queue);
    render();
    this.show!();
  },
  show() {
    visible = true;
    render();
    window.clearInterval(ticker);
    ticker = window.setInterval(queue, 5000); // elapsed times, hunger clock
  },
  hide() {
    visible = false;
    window.clearInterval(ticker);
  },
};
