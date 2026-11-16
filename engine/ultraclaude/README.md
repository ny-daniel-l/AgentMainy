# Team engine (UltraClaude)

A vendored copy of [ZH-NICO/ultraclaude](https://github.com/ZH-NICO/ultraclaude)
(MIT, see `LICENSE`), at upstream commit `2809836`. It runs a team of Claude
Code agents for one project folder: roles, shared Obsidian memory, a task
board, agent-to-agent messages and real terminals.

AgentMainy starts it through its own CLI (`src-tauri/src/team.rs`) and shows
its window inside the dashboard's **Team** page. The code here is **unchanged**
from upstream, so updating is a copy:

```bash
git clone https://github.com/ZH-NICO/ultraclaude /tmp/uc
cp -r /tmp/uc/{bin,src,public,test,package.json,package-lock.json,LICENSE} engine/ultraclaude/
npm --prefix engine/ultraclaude install && npm --prefix engine/ultraclaude test
```

| Path | What it does |
|---|---|
| `bin/ultraclaude.js` | CLI: `--no-open`, `stop`, `status`, `vault` |
| `src/server.js` | HTTP, WebSocket, MCP and hook endpoints (127.0.0.1 only, token protected) |
| `src/project.js` | Agents, messages, tasks, hook logic |
| `src/mcp.js` | The team tools every agent gets |
| `src/vault.js` | The Obsidian vault and its files |
| `src/history.js` | Earlier Claude Code sessions and the chat map |
| `src/roles.js` | Roles and the agent prompt |
| `public/` | The team window (no build step) |
