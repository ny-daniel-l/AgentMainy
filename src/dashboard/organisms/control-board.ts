// The Pi control page: everything you can DO to the Raspberry Pi, in big
// buttons. Fan (modes, boost), power (restart / reboot / shut down) and
// maintenance (backup, updates). Status lives on the Server page.
import { invoke } from "@tauri-apps/api/core";
import { h } from "../atoms/h";
import { pill } from "../atoms/badge";
import { button, confirmButton } from "../atoms/button";
import { icon } from "../atoms/icon";
import { segmented } from "../atoms/segmented";
import { card } from "../molecules/card";
import { actionTile } from "../molecules/action-tile";
import { empty } from "../molecules/empty";
import { levelBars } from "../molecules/fan-bars";
import { meter } from "../molecules/meter";
import { row } from "../molecules/row";
import { toast } from "../molecules/toast";
import { ha, isAway } from "../services/home-assistant";
import { act } from "./ha-ui";
import * as model from "../services/home-model";
import type { Entity } from "../services/home-model";
import { formatTemp } from "../services/settings";

const MODE_HINT: Record<string, string> = {
  Auto: "Follows the Pi's own curve: on at 50 °C, max at 75 °C.",
  Off: "Silent. Forced back on above 70 °C.",
  Low: "Quiet airflow. Forced up above 70 °C.",
  Medium: "Half speed. Forced up above 70 °C.",
  High: "Strong cooling.",
  Max: "Full speed, loud.",
};


export function fanControl(list: Entity[]): HTMLElement {
  const s = model.server(list);
  if (!s.fanModes.length) {
    return card({ title: "Fan", icon: "fan", wide: true },
      empty("Set up the fan control from home-assistant/ (Raspberry Pi 5 with the official Active Cooler).", { icon: "fan" }));
  }
  const boost = list.find((e) => e.entity_id === "script.pi_fan_boost");
  const boosting = s.fanBoost;
  const level = s.fanLevel ?? 0;
  const setMode = async (m: string) => {
    const calls = model.fanModeCalls(m, boosting);
    for (const [i, c] of calls.entries()) await act(...c, i === calls.length - 1 ? `Fan: ${m}` : undefined);
  };
  return card({ title: "Fan", icon: "fan", wide: true, cls: "card-hero",
      aside: boosting ? pill("boost running", "info") : pill(s.fanRpm ? `${s.fanRpm} rpm` : s.fanMode === "Auto" ? "idle (Auto, starts at 50 °C)" : s.fanMode === "Off" ? "off" : "stopped", s.fanRpm ? "info" : "off") },
    h("div", { class: "fan-panel" },
      h("div", { class: "fan-readout" },
        h("div", { class: `fan-spin${s.fanRpm ? " spinning" : ""}`, style: `--spin:${Math.max(0.25, 2.2 - level * 0.45)}s`, "aria-hidden": "true",
          html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 1-7 4-7 2 0 3 2 2 4-1 1.6-3 2.6-6 3zM14 12c4 0 7 1 7 4 0 2-2 3-4 2-1.6-1-2.6-3-3-6zM12 14c0 4-1 7-4 7-2 0-3-2-2-4 1-1.6 3-2.6 6-3zM10 12c-4 0-7-1-7-4 0-2 2-3 4-2 1.6 1 2.6 3 3 6z"/></svg>' }),
        h("div", { class: "fan-numbers" },
          h("div", { class: "fan-big" }, s.fanRpm ? `${s.fanRpm}` : "0", h("small", null, " rpm")),
          levelBars(level),
          h("div", { class: "muted small" }, `level ${level}/4 · CPU ${s.temp === undefined ? "–" : formatTemp(s.temp)}`),
        ),
      ),
      h("div", { class: "fan-modes" },
        segmented(s.fanModes.map((m) => ({ value: m, label: m })), s.fanMode, setMode, "Fan mode"),
        h("p", { class: "muted small fan-hint" }, boosting ? "Boost: full speed, then back to Auto by itself." : MODE_HINT[s.fanMode ?? ""] ?? ""),
        h("div", { class: "tile-row" },
          boost
            ? actionTile({ icon: "fan", title: "Boost 10 min", hint: "Max, then back to Auto", active: boosting },
                () => act("script", "pi_fan_boost", null, { minutes: 10 }, "Fan boost: 10 minutes"))
            : null,
          boost
            ? actionTile({ icon: "fan", title: "Boost 30 min", hint: "For a long build or update" },
                () => act("script", "pi_fan_boost", null, { minutes: 30 }, "Fan boost: 30 minutes"))
            : null,
          boosting
            ? actionTile({ icon: "stop", title: "Stop boost", hint: "Back to Auto now" },
                () => setMode("Auto"))
            : null,
        ),
      ),
    ),
  );
}

export function powerControl(): HTMLElement {
  // away (over Tailscale) nobody can replug the Pi after a shutdown: hold 3 s instead of click twice
  const away = isAway(ha.address);
  const shutdown = () => act("hassio", "host_shutdown", null, {}, "The Pi is shutting down. Unplug and replug it to start it again.");
  return card({ title: "Power", icon: "plug", aside: away ? pill("away from home", "warn") : undefined },
    h("div", { class: "tile-grid power-grid" },
      actionTile({ icon: "restart", title: "Restart Home Assistant", hint: "About 1 minute, the Pi stays on", confirm: "Click again to restart" },
        () => act("homeassistant", "restart", null, {}, "Home Assistant is restarting (about 1 min)")),
      actionTile({ icon: "power", title: "Reboot the Pi", hint: "About 2 minutes offline", confirm: "Click again: reboot now", danger: true },
        () => act("hassio", "host_reboot", null, {}, "The Pi is rebooting (about 2 min)")),
      away
        ? actionTile({ icon: "stop", title: "Shut down the Pi", hint: "You're away: it stays off until someone at home replugs it. Hold 3 s.", hold: "Keep holding… powering off", danger: true }, shutdown)
        : actionTile({ icon: "stop", title: "Shut down the Pi", hint: "Unplug and replug it to start again", confirm: "Click again: power off", danger: true }, shutdown),
    ),
  );
}

// installs started or seen, by update id; kept while the app runs, so "Done" survives an HA restart
const started = new Map<string, model.Started>();

/** True while an update installs (the page keeps the card up through an HA restart then). */
export function installing(list: Entity[]): boolean {
  return model.updateRows(list, started).some((u) => u.phase === "installing");
}

function updateRow(u: model.UpdateRow, restarting: boolean, install: (u: model.UpdateRow) => void): HTMLElement {
  const notes = u.releaseUrl
    ? button("Notes", () => { void invoke("open_url", { url: u.releaseUrl }); }, { icon: "external", title: "Release notes" })
    : null;
  const trail = u.phase === "waiting"
    ? confirmButton("Install", "Click again", () => install(u), { variant: "primary" })
    : u.phase === "done" ? pill("done", "ok") : pill(restarting ? "restarting" : "installing", "info");
  const caption = restarting
    ? "Home Assistant is restarting to finish this. Back in about a minute."
    : u.percent !== undefined ? `Installing… ${u.percent} %` : "Installing… this can take a few minutes. You can leave this page.";
  return h("div", { class: `upd upd-${u.phase}${u.failed ? " upd-failed" : ""}`, "data-id": u.id },
    row({ lead: icon("server"), title: u.name,
      sub: u.phase === "done" ? `Done: ${u.installed} → ${u.latest}` : u.failed ? `Did not finish, still ${u.installed}. Try again?` : `${u.installed} → ${u.latest}`,
      trail: h("span", { class: "upd-actions" }, notes, trail) }),
    u.phase === "installing" ? meter(restarting || u.percent === undefined ? null : u.percent / 100, caption) : null,
  );
}

export function maintenanceControl(list: Entity[], refresh: () => void, restarting = false): HTMLElement {
  const rows = model.updateRows(list, started);
  const busy = rows.filter((u) => u.phase === "installing").length;
  const waiting = rows.filter((u) => u.phase === "waiting").length;
  const updateIds = list.filter((e) => e.entity_id.startsWith("update.")).map((e) => e.entity_id);
  const install = async (u: model.UpdateRow) => {
    started.set(u.id, { from: u.installed });
    refresh();
    try {
      await ha.call("update", "install", { entity_id: u.id }, {}); // returns when done; never, if HA restarts on the way
    } catch (e) {
      started.delete(u.id);
      refresh();
      toast(`Installing ${u.name} failed: ${(e as Error).message}`, "bad");
    }
  };
  const aside = restarting ? pill("HA restarting…", "info")
    : busy ? pill(`installing ${busy}`, "info")
    : waiting ? pill(`${waiting} update${waiting > 1 ? "s" : ""}`, "warn")
    : pill("up to date", "ok");
  return card({ title: "Maintenance", icon: "spark", aside, wide: restarting },
    restarting ? null : h("div", { class: "tile-grid" },
      actionTile({ icon: "spark", title: "Back up now", hint: "Encrypted, like the nightly backup", confirm: "Click again to back up" },
        () => act("backup", "create_automatic", null, {}, "Backup started")),
      actionTile({ icon: "speed", title: "Check for updates", hint: "Ask for the newest versions now" },
        () => act("homeassistant", "update_entity", { entity_id: updateIds }, {}, "Checking for updates…")),
    ),
    rows.length
      ? h("div", { class: "upd-list" }, ...rows.map((u) => updateRow(u, restarting, install)))
      : h("p", { class: "muted small upd-none" }, "Everything is up to date."),
  );
}
