// A running team: the UltraClaude window (overview graph, terminals, tasks,
// memory, chat map) embedded full-size, with a slim toolbar above it.
import { invoke } from "@tauri-apps/api/core";
import { h } from "../atoms/h";
import { icon } from "../atoms/icon";
import { button, confirmButton } from "../atoms/button";
import { folderName } from "../services/team";

export interface TeamFrameActions {
  onSwitch: () => void;
  onStop: () => void;
}

export function teamFrame(folder: string, url: string, actions: TeamFrameActions): HTMLElement {
  return h("div", { class: "team-wrap" },
    h("div", { class: "team-bar" },
      icon("folder"),
      h("b", null, folderName(folder)),
      h("span", { class: "muted ellipsis", title: folder }, folder),
      h("span", { class: "spacer" }),
      button("Own window", () => { void invoke("open_url", { url }); }, { icon: "external", title: "Open this team in its own window" }),
      button("Other project", actions.onSwitch, { icon: "folder", title: "The team keeps running" }),
      confirmButton("Stop team", "Click again: stops all its agents", actions.onStop, { icon: "stop", variant: "danger" }),
    ),
    h("iframe", { class: "team-frame", src: url, title: `Agent team for ${folderName(folder)}`, allow: "clipboard-read; clipboard-write" }),
  );
}
