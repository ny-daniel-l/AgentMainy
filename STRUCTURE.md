# Where everything is

A map of the AgentMainy code: what each folder and file does, how the parts
talk to each other, and where your data is kept. Start at the
[top-level tree](#top-level), then jump to the part you need.

- [Top level](#top-level)
- [Frontend (`src/`)](#frontend-src)
  - [Dashboard: atomic design](#dashboard-atomic-design)
- [Rust backend (`src-tauri/`)](#rust-backend-src-tauri)
- [Team engine (`engine/ultraclaude/`)](#team-engine-engineultraclaude)
- [Home Assistant kit (`home-assistant/`)](#home-assistant-kit-home-assistant)
- [How the parts talk](#how-the-parts-talk)
- [Where your data lives](#where-your-data-lives)
- [Recipes](#recipes)
- [Names kept from AgentPet, on purpose](#names-kept-from-agentpet-on-purpose)

## Top level

```
AgentMainy/
├── index.html            the pet overlay window (transparent, always on top)
├── dashboard.html        the dashboard window: sidebar + every page
├── popover.html          the pet's right-click menu
├── src/                  all TypeScript + CSS for the three windows
├── src-tauri/            the Rust app: windows, tray, hooks, local server, CLI
├── engine/ultraclaude/   the team engine (Node.js, vendored UltraClaude)
├── home-assistant/       optional Home Assistant scripts + example config
├── tests/                TypeScript unit tests (node --test)
├── public/               static files served as-is (app icon)
├── art/                  source art for the pet's dock peek
├── skill/                Claude Code skill for the `agentpet` CLI
├── docs/screenshots/     the pictures in README.md (demo data)
├── vite.config.ts        bundles the three HTML entry points
├── package.json          scripts: dev, build, tauri, test, engine:install
└── STRUCTURE.md          this file
```

## Frontend (`src/`)

Sorted **by feature**. Each folder only reaches "down" into `shared/` or
"across" into a sibling it really needs.

```
src/
├── overlay/      the pet window and what floats around the pet
├── pet/          the pet itself: sprite, care, catalog, chatter
├── agents/       live agent sessions, history, token usage
├── shared/       translations + icons used everywhere
├── dashboard/    the dashboard window (atomic design, below)
└── styles/       app.css (overlay, popover, original pages) + dashboard.css
```

| File | What it does |
|---|---|
| `overlay/main.ts` | Entry of `index.html`. Draws the pet, listens to agent events, drives mood, bubble, notifications, sounds, split pets, the dock. |
| `overlay/bubble.ts` | The speech bubble: layout tokens, list / carousel / compact modes, click-to-focus rows. |
| `overlay/dock.ts` | Docks the pet on the taskbar: peeking, the chip per agent, the hover panel (agents, usage, limits, GitHub year). |
| `overlay/popover.ts` | Entry of `popover.html`: agent count, show pet, size, Dashboard, Quit. |
| `pet/pet.ts` | Spritesheet pet: slicing the 8×9 sheet, frames per mood, hit-testing. |
| `pet/care.ts` | Tamagotchi engine: tokens → XP → levels → five stages, hunger, streaks, achievements. |
| `pet/catalog.ts` | Pet catalog from the CDN, your library, renaming. |
| `pet/activity.ts` | Whimsical activity lines ("Baking…", "Editing x…"). |
| `pet/reactive.ts` | The pet comments on live numbers (tokens, sessions, hunger). |
| `pet/kanye.ts` | Idle chatter quotes with an offline fallback. |
| `pet/projectpets.ts` | One pet window per project (split mode). |
| `pet/sync.ts` | Optional web profile / leaderboard sync. |
| `agents/state.ts` | `SessionStore`: every agent session, its state, mood, pruning. |
| `agents/history.ts` | Finished sessions (90 days) for the History page. |
| `agents/usage.ts` | Tokens and estimated cost per project and agent. |
| `shared/i18n.ts` | English, Tiếng Việt, 简体中文, 繁體中文. |
| `shared/icons.ts` | Agent brand logos and UI icons. |

### Dashboard: atomic design

The new dashboard is built in layers. A layer only uses the layers above it
in this list, never the other way round.

```
src/dashboard/
├── atoms/        smallest pieces, no app knowledge
│   ├── h.ts          h("div", props, ...children): the only DOM helper (text is never parsed as HTML)
│   ├── icon.ts       line icons
│   ├── badge.ts      dot(), pill(), stateTone()
│   ├── button.ts     button(), confirmButton() (click twice for risky actions)
│   ├── segmented.ts  a row of exclusive buttons (Auto | Off | Low …)
│   └── toggle.ts     an on/off switch (a real checkbox underneath)
├── molecules/    atoms combined into a reusable piece
│   ├── card.ts       titled panel: every block on the new pages
│   ├── stat.ts       big number + label
│   ├── row.ts        list row (lead, title, sub, trail) + rows() with "+N more"
│   ├── gauge.ts      ring gauge (the Pi's temperature, CPU, memory…)
│   ├── sparkline.ts  24 h line chart with min / max / now
│   ├── meter.ts      progress bar
│   ├── setting-row.ts one line of the Settings page
│   ├── empty.ts      empty state with an optional action
│   └── toast.ts      short message at the bottom
├── organisms/    complete panels, know about one feature
│   ├── radar-scope.ts    the radar: canvas PPI scope, sweep, afterglow, label placement
│   ├── radar-panels.ts   contact list + event log beside the scope
│   ├── house-board.ts    door & security, appliances
│   ├── clock-board.ts    timers (live countdown) and alarm clocks
│   ├── network-board.ts  internet + 24 h history, devices table, new devices
│   ├── server-board.ts   the Pi: gauges, fan control, history, system, updates, power
│   ├── ha-ui.ts          haGate() (not connected yet) and act() (service call + toast)
│   ├── agents-panel.ts   live agents, click → focus its terminal
│   ├── pet-panel.ts      level, stage, XP, hunger (read-only)
│   ├── home-summary.ts   Home card on the Overview
│   ├── team-launcher.ts  pick a folder, start a team
│   ├── team-frame.ts     the running team, embedded
│   └── demo.ts           live preview of the bubble (from AgentPet)
├── pages/        one file per sidebar entry, each answers one question
│   ├── page.ts           the DashPage contract, goTo(), scheduler(), onlyWhenChanged()
│   ├── overview.ts       everything at a glance (+ mini radar, Pi summary)
│   ├── team.ts           launcher or running team
│   ├── radar.ts          who and what is home
│   ├── house.ts          is the door locked, what is running
│   ├── clock.ts          timers and alarm clocks
│   ├── network.ts        is the internet up, what is connected
│   ├── server.ts         is the Raspberry Pi healthy
│   ├── settings.ts       Home Assistant, radar, server and appearance options
│   └── original.ts       the original AgentPet pages: General, Pet, Care, Dock, History, About
├── services/     talk to the outside world, no DOM
│   ├── sessions.ts       live sessions from the pet window's events
│   ├── team.ts           start / find / stop the team engine (Rust commands)
│   ├── home-assistant.ts WebSocket client, live entity cache, service calls, history
│   ├── home-model.ts     pure: who is home, locks, internet, Pi, alarms, devices (unit tested)
│   ├── radar-model.ts    pure: contact placement, scan diff (unit tested)
│   ├── radar.ts          the scan loop: every N s snapshot, diff, log, active ping
│   ├── history-cache.ts  24 h history for the charts, cached 5 min
│   ├── settings.ts       AgentMainy's own settings (am_settings)
│   └── sound.ts          the sonar ping, synthesised with Web Audio
└── main.ts       entry of dashboard.html: mounts pages, headings, status, accent, start page
```

The original pages keep their markup in `dashboard.html` (same element ids)
and their logic in `pages/original.ts`, so every pet setting works exactly as
before. They take on the new look through `styles/dashboard.css`, which is
scoped to `body.dashboard` and loaded after `app.css`.

## Rust backend (`src-tauri/`)

```
src-tauri/src/
├── main.rs            the `agentpet` binary: CLI subcommands, otherwise starts the app
├── lib.rs             app setup: windows, tray, the dashboard window, Tauri commands
├── team.rs            team engine launcher (team_open / team_status / team_stop)
├── agents/
│   ├── cli.rs         `agentpet hook --agent x` (reads hook JSON on stdin) and `agentpet run -- cmd`
│   ├── hooks.rs       installs hooks into Claude Code, Codex, Gemini, Cursor, Copilot…;
│   │                  on start the installed app re-points them at itself (refresh_paths)
│   ├── server.rs      localhost:47628: receives hook events, emits them to the windows
│   ├── statemap.rs    hook event → working / waiting / done
│   ├── transcript.rs  conversation titles, questions, token usage from transcripts
│   ├── limits.rs      subscription limits (Claude, Codex, Copilot, DeepSeek)
│   └── orch.rs        `agentpet ls | peek | wait | send`
└── platform/
    └── winfocus.rs    Windows: click an agent → focus its terminal tab
```

`lib.rs` re-exports the `agents::*` modules at the crate root, so paths like
`crate::hooks` and `agentpet_lib::cli` keep working.

## Team engine (`engine/ultraclaude/`)

[UltraClaude](https://github.com/ZH-NICO/ultraclaude), vendored **unchanged**
(see its [README](engine/ultraclaude/README.md) for the file list and how to
update it). It needs its own `npm install` (`npm run engine:install`) and is
bundled into the installer as a resource.

## Home Assistant kit (`home-assistant/`)

Optional. The Home pages work with any Home Assistant as is. This folder adds
presence from a Swisscom router, a new-device alert, Raspberry Pi 5 fan control, Nuki MQTT extras and a
V-ZUG example. See [its README](home-assistant/README.md).

## How the parts talk

```mermaid
flowchart LR
  subgraph agents[Your AI agents]
    CC[Claude Code] & CX[Codex] & GM[Gemini / Cursor / …]
  end
  agents -- hook: agentpet hook --agent x --> SRV[Rust event server<br/>127.0.0.1:47628]
  SRV -- agent-event --> PET[Pet overlay]
  SRV -- agent-event --> DASH[Dashboard]
  PET -- session-snapshot --> DASH
  DASH -- invoke team_open --> TEAM[team.rs]
  TEAM -- node ultraclaude.js --no-open --> UC[UltraClaude server<br/>127.0.0.1:random + token]
  UC -- runs --> TA[Claude Code team agents]
  TA -- hooks too --> SRV
  DASH -- iframe --> UC
  DASH -- WebSocket --> HA[Home Assistant]
  HA -- sensors + fan --> PI[Raspberry Pi]
```

- **Agents → pet**: every agent's hook runs `agentpet hook`, which POSTs to
  the app. The app emits `agent-event` to all windows. The dashboard asks the
  pet window for its current list on start (`sessions-request`).
- **Team**: the dashboard calls `team_open(folder)`; `team.rs` runs
  UltraClaude's CLI in that folder and returns its private URL, shown in a
  frame. Team agents are normal Claude Code sessions, so the pet sees them too.
- **Home** (Radar, House, Clock, Network, Server): the dashboard opens Home
  Assistant's WebSocket API with your token, loads every entity once, then
  follows `state_changed` events. The radar scans every N seconds
  (`services/radar.ts`) and, with active ping, asks the router for a fresh
  device list for the next scan.

## Where your data lives

| What | Where |
|---|---|
| Pet choice, care/XP, bubble + dock settings (`ap_*`, `agentpet.petSlug`) | the app's WebView storage (localStorage) |
| Home Assistant address + token (`am_ha`), team folders (`am_team_*`), settings (`am_settings`), radar log (`am_radar_log`) | the app's WebView storage (localStorage) |
| Pet position, language, visibility, first-run flag, `debug.log` | `%APPDATA%\AgentPet\` |
| Agent hooks | each agent's own config (e.g. `%USERPROFILE%\.claude\settings.json`) |
| Team state per project | `<project>\.ultraclaude\` (git-ignored) |
| Team settings, shared memory | `%USERPROFILE%\.ultraclaude\`, `%USERPROFILE%\UltraClaudeVault\` |

## Recipes

**Add a dashboard page**

1. Add a sidebar button and an empty page to `dashboard.html`:
   `<button class="tab" data-tab="x">…<span id="tab-x">X</span></button>` and
   `<div class="page" data-page="x" id="page-x"></div>`.
2. Create `src/dashboard/pages/x.ts` exporting a `DashPage` (`id`, `mount`,
   optional `show` / `hide`).
3. Add it to `PAGES` and `HEADINGS` in `src/dashboard/main.ts`.

**Add a component**: pick the lowest layer it fits (atom → molecule →
organism), build it with `h()`, and put state or I/O in a `services/` module
rather than in the component.

**Run the checks**: `npm test` runs the TypeScript unit tests, the team
engine's tests and the Rust tests. `npm run build` type-checks and bundles.

## Names kept from AgentPet, on purpose

Renaming these would break things you already have, so they stay:

| Kept | Why |
|---|---|
| App identifier `online.thenightwatcher.agentpet` | The WebView storage (your pet's XP and settings) is tied to it. |
| `%APPDATA%\AgentPet\` | Pet position, language and visibility survive the rename. |
| Crate name `agentpet`, its subcommands | `hook`, `run`, `ls`, `peek`, `wait`, `send` work the same; the skill and existing scripts keep working. |
| localStorage keys `ap_*` | Same reason as the identifier. |

The installed program itself is `AgentMainy.exe`. If you used AgentPet
before, open **Dashboard → General** once after installing and switch each
agent off and on: that rewrites its hook to the new program's path.
