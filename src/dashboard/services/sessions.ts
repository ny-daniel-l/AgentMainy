// Live agent sessions for the dashboard. The pet window owns the real list;
// like the popover, we keep our own SessionStore fed by the same events and
// ask the pet window for a snapshot on start ("sessions-request").

import { emit, listen } from "@tauri-apps/api/event";
import { SessionStore, type AgentEventPayload, type Session } from "../../agents/state";

const store = new SessionStore();
const subscribers = new Set<() => void>();
const changed = () => subscribers.forEach((fn) => fn());

listen<AgentEventPayload>("agent-event", (e) => { store.update(e.payload); changed(); });
listen<string>("agent-end", (e) => { store.remove(e.payload); changed(); });
listen<Session>("session-snapshot", (e) => { store.seed(e.payload); changed(); });
listen<string>("session-dismiss", (e) => { store.removeKey(e.payload); changed(); });
listen("sessions-clear", () => { store.clear(); changed(); });
emit("sessions-request", null);

/** Open agent chats, busiest first (working, waiting, done, registered). */
export function sessions(): Session[] {
  return store.active().filter((s) => s.state !== "idle");
}

export function counts() {
  const list = sessions();
  return {
    working: list.filter((s) => s.state === "working").length,
    waiting: list.filter((s) => s.state === "waiting").length,
    open: list.length,
  };
}

/** Folders the agents are working in, most recent first (Team suggestions). */
export function agentProjects(): string[] {
  const seen = new Set<string>();
  return store.active()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((s) => s.project)
    .filter((p) => p && !seen.has(p) && seen.add(p));
}

/** Call `fn` whenever the list changes; returns an unsubscribe function. */
export function onSessions(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
