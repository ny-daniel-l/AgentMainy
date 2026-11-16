---
name: agentpet
description: Check on, wait for, and message the other AI agents the user is watching in AgentPet (CLI `agentpet`). Use when the user asks what another agent is doing, whether an agent finished, to wait for an agent, or to send/type a message into another agent (Claude, Codex, Gemini, Copilot, OpenCode, Antigravity, Cursor, etc.). AgentPet watches agents via their hooks , it does not launch or kill them. Not for your own built-in subagents.
user-invocable: true
argument-hint: "[ls | peek <agent> | wait <agent> | send <agent> <message>]"
---

# AgentPet: the agents the user is watching

AgentPet is a desktop pet overlay that watches every AI agent running on this
machine through their hooks and shows each one's state and activity. The
`agentpet` CLI reads that same live view from any shell, so you can check on and
message the other agents the user has open.

It talks to the running AgentPet app over localhost. If the pet isn't running,
the commands say so.

| Command | Does |
|---|---|
| `agentpet ls` | every agent the pet sees: kind, state (working/waiting/done/registered), project, current activity |
| `agentpet peek <agent>` | one agent's state, project, conversation title and activity |
| `agentpet wait <agent> [-t SECS]` | block until it stops working (default 600s); prints its final state (`done` / `waiting` / `ended` / `timeout`) |
| `agentpet send <agent> <text>` | focus that agent's terminal and type the text in, then Enter |

`<agent>` is a selector: an agent kind (`claude`, `codex`…), a session-id
prefix, or a piece of the project path or conversation title. It must match
exactly one agent for `peek` / `wait` / `send`; if it matches several, the CLI
lists them so you can be more specific.

## What this is not

- **AgentPet does not start or stop agents.** There is no `new` or `kill`: it
  only watches agents the user already has running. If the user wants a new
  agent, that's a normal new terminal/session, not this tool.
- `wait` reports `working` → not-working transitions from the hooks. It returns
  as soon as the agent reaches `done` (finished a turn) or `waiting` (asked the
  user something). `waiting` means it needs a human , surface that, don't assume
  it's done.

## Following up on another agent

1. `agentpet ls` to see what's running and pick the right selector (prefer the
   project name or title over a bare kind when several of one kind are open).
2. `agentpet wait <agent> -t 900` to wait for a long task (run it in the
   background), then `agentpet peek <agent>` to read where it landed.
3. Report back in your own words: what the agent is doing / did and what's left.

## Sending a message (`send`)

`agentpet send <agent> "text"` focuses that agent's terminal window and types
the text as keystrokes, then presses Enter. Caveats, because AgentPet doesn't
own the agent's session, it only focuses its window:

- It types into **whatever window ends up focused** , it's best-effort. Don't
  use it for anything destructive, and tell the user you're doing it.
- It needs a known terminal for that agent (an agent running in a desktop app,
  or one the pet has never seen focused, may report "no terminal known").
- Only ask another agent a question or give an instruction the user has
  authorized , it's the user's agent, on the user's plan.
