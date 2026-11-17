// Home Assistant over its WebSocket API (no CORS setup needed, unlike REST).
// Keeps a live copy of every entity: get_states once, then state_changed
// events. Reconnects every 5 s if the connection drops.
//
// The address and a long-lived access token are entered on the Home page and
// kept in this app's localStorage only. They never leave this computer except
// to your own Home Assistant.

import type { Entity } from "./home-model";

export interface HaConfig {
  url: string;
  token: string;
}

export type HaStatus = "off" | "connecting" | "online" | "error";

const KEY = "am_ha";

export function haConfig(): HaConfig | null {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}

export function saveHaConfig(cfg: HaConfig | null) {
  if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg));
  else localStorage.removeItem(KEY);
}

/** "192.168.1.5:8123" -> "http://192.168.1.5:8123" (no trailing slash). */
export function normalizeUrl(input: string): string {
  const u = input.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(u) ? u : `http://${u}`;
}

class HomeAssistant {
  status: HaStatus = "off";
  error = "";
  private states = new Map<string, Entity>();
  private ws?: WebSocket;
  private nextId = 1;
  private pending = new Map<number, (msg: any) => void>();
  private listeners = new Set<() => void>();
  private retry?: number;
  private cfg?: HaConfig;

  entities(): Entity[] {
    return [...this.states.values()];
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Connects; resolves once the token is accepted, rejects if it is not. */
  connect(cfg: HaConfig): Promise<void> {
    this.disconnect();
    this.cfg = cfg;
    this.setStatus("connecting");
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err?: string) => {
        if (settled) return;
        settled = true;
        err ? reject(new Error(err)) : resolve();
      };
      const ws = new WebSocket(normalizeUrl(cfg.url).replace(/^http/i, "ws") + "/api/websocket");
      this.ws = ws;
      const timeout = window.setTimeout(() => {
        done(`No answer from ${cfg.url}. Is the address right?`);
        ws.close();
      }, 8000);

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === "auth_required") {
          ws.send(JSON.stringify({ type: "auth", access_token: cfg.token }));
        } else if (msg.type === "auth_ok") {
          window.clearTimeout(timeout);
          this.setStatus("online");
          void this.send({ type: "get_states" }).then((r) => {
            this.states = new Map((r.result as Entity[]).map((e) => [e.entity_id, e]));
            this.changed();
          });
          void this.send({ type: "subscribe_events", event_type: "state_changed" });
          done();
        } else if (msg.type === "auth_invalid") {
          window.clearTimeout(timeout);
          this.cfg = undefined; // a wrong token will not get better by retrying
          this.setStatus("error", "Home Assistant rejected the token.");
          done(this.error);
          ws.close();
        } else if (msg.type === "result") {
          this.pending.get(msg.id)?.(msg);
          this.pending.delete(msg.id);
        } else if (msg.type === "event" && msg.event?.event_type === "state_changed") {
          const { entity_id, new_state } = msg.event.data;
          if (new_state) this.states.set(entity_id, new_state);
          else this.states.delete(entity_id);
          this.changed();
        }
      };
      ws.onerror = () => {
        window.clearTimeout(timeout);
        done(`Cannot reach Home Assistant at ${cfg.url}.`);
      };
      ws.onclose = () => {
        if (this.ws !== ws) return; // replaced by a newer connection
        this.pending.clear();
        if (this.cfg) {
          this.setStatus("connecting", "Connection lost, retrying…");
          this.retry = window.setTimeout(() => this.cfg && this.connect(this.cfg).catch(() => {}), 5000);
        }
      };
    });
  }

  disconnect() {
    window.clearTimeout(this.retry);
    this.cfg = undefined;
    const ws = this.ws;
    this.ws = undefined;
    ws?.close();
    this.states.clear();
    this.setStatus("off");
  }

  /** Calls a service, e.g. call("lock", "lock", { entity_id: "lock.front" }). Pass target null for none. */
  async call(domain: string, service: string, target: Record<string, unknown> | null, data: Record<string, unknown> = {}) {
    const r = await this.send({ type: "call_service", domain, service, ...(target ? { target } : {}), service_data: data });
    if (!r.success) throw new Error(r.error?.message ?? "Service call failed");
  }

  /** Numeric history of `entityId` over the last `hours`, oldest first. */
  async history(entityId: string, hours = 24): Promise<{ t: number; v: number }[]> {
    const r = await this.send({
      type: "history/history_during_period",
      start_time: new Date(Date.now() - hours * 3_600_000).toISOString(),
      entity_ids: [entityId],
      minimal_response: true,
      no_attributes: true,
    });
    const rows: any[] = r.result?.[entityId] ?? [];
    // Minimal responses use "s" (state) and "lu" (seconds) after the first row.
    return rows
      .map((x) => ({ t: (x.lu ?? Date.parse(x.last_updated ?? x.last_changed) / 1000) * 1000, v: parseFloat(x.s ?? x.state) }))
      .filter((p) => Number.isFinite(p.v) && Number.isFinite(p.t));
  }

  private send(msg: Record<string, unknown>): Promise<any> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Not connected"));
    const id = this.nextId++;
    ws.send(JSON.stringify({ ...msg, id }));
    return new Promise((resolve) => this.pending.set(id, resolve));
  }

  private setStatus(status: HaStatus, error = "") {
    this.status = status;
    this.error = error;
    this.changed();
  }

  private changed() {
    this.listeners.forEach((fn) => fn());
  }
}

export const ha = new HomeAssistant();
