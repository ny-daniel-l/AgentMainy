// Every AI agent the pet is watching right now, busiest first. Click a row to
// jump to that agent's terminal (same as clicking it in the dock).
import { invoke } from "@tauri-apps/api/core";
import { h } from "../atoms/h";
import { pill, stateTone } from "../atoms/badge";
import { card } from "../molecules/card";
import { row, rows } from "../molecules/row";
import { empty } from "../molecules/empty";
import { agentIconUrl } from "../../shared/icons";
import { agentLabel, basename, type Session } from "../../agents/state";
import { sessions } from "../services/sessions";

function elapsed(since: number): string {
  const s = Math.max(0, Math.round((Date.now() - since) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function agentRow(s: Session): HTMLElement {
  const iconUrl = agentIconUrl(s.agent);
  const project = basename(s.project || "");
  return row({
    lead: iconUrl ? h("img", { class: "agent-ic", src: iconUrl, alt: "" }) : h("span", { class: "agent-ic fallback" }, agentLabel(s.agent).slice(0, 1)),
    title: s.title || project || agentLabel(s.agent),
    sub: [agentLabel(s.agent), project, s.live].filter(Boolean).join(" · "),
    trail: h("span", { class: "trail-stack" }, pill(s.state === "registered" ? "open" : s.state, stateTone(s.state)), h("span", { class: "muted" }, elapsed(s.stateSince))),
    onClick: s.terminalFocusUrl
      ? () => { void invoke("focus_terminal", { program: s.terminalProgram, focusUrl: s.terminalFocusUrl }); }
      : undefined,
  });
}

export function agentsPanel(opts: { max?: number; wide?: boolean } = {}): HTMLElement {
  const list = sessions();
  return card(
    { title: "Agents", icon: "agents", wide: opts.wide, aside: h("span", { class: "count" }, String(list.length)) },
    list.length
      ? rows(list.map(agentRow), opts.max ?? 8)
      : empty("No agent is running. Start Claude Code, Codex, Cursor… and it shows up here.", { icon: "agents" }),
  );
}
