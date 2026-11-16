// Pick a project folder and start an agent team for it. Suggests the folders
// your watched agents are already working in, plus recently used ones.
import { h } from "../atoms/h";
import { icon } from "../atoms/icon";
import { button } from "../atoms/button";
import { card } from "../molecules/card";
import { agentProjects } from "../services/sessions";
import { recentFolders, folderName } from "../services/team";

const FEATURES: [string, string][] = [
  ["Roles", "Bugfixer, Developer, PR Reviewer, Tester, Architect… or your own"],
  ["Shared memory", "One Obsidian vault the whole team reads and writes"],
  ["Task board", "Open, In progress, Done; assignees are told"],
  ["Real terminals", "Every agent is a real Claude Code session"],
];

function chipGroup(title: string, folders: string[], pick: (f: string) => void): HTMLElement | null {
  if (!folders.length) return null;
  return h("div", { class: "chip-group" },
    h("div", { class: "chip-title" }, title),
    h("div", { class: "chips" }, ...folders.map((f) =>
      h("button", { class: "chip click", type: "button", title: f, onclick: () => pick(f) }, icon("folder"), folderName(f)))),
  );
}

export function teamLauncher(onStart: (folder: string) => void, error = ""): HTMLElement {
  const input = h("input", { class: "field", type: "text", placeholder: "C:\\path\\to\\your\\project", spellcheck: "false", "aria-label": "Project folder" });
  const start = () => { const f = input.value.trim(); if (f) onStart(f); else input.focus(); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") start(); });
  const pick = (f: string) => { input.value = f; start(); };
  const fromAgents = agentProjects().slice(0, 6);
  const recent = recentFolders().filter((f) => !fromAgents.includes(f));

  return h("div", { class: "grid" },
    card({ title: "Start an agent team", icon: "team", wide: true, cls: "card-hero" },
      h("p", { class: "lead" }, "Open as many Claude Code agents as you want on one project. They get roles, share one memory, message each other and work off a task board."),
      h("div", { class: "launch" }, input, button("Start team", start, { variant: "primary", icon: "play" })),
      error ? h("div", { class: "form-error", role: "alert" }, error) : null,
      chipGroup("Where your agents work", fromAgents, pick),
      chipGroup("Recent", recent, pick),
      h("p", { class: "muted small" }, "Needs Node.js 20+ and Claude Code (signed in). The first agent asks in its terminal whether you trust the folder."),
    ),
    h("div", { class: "features" }, ...FEATURES.map(([title, text]) => h("div", { class: "feature" }, h("b", null, title), h("span", null, text)))),
  );
}
