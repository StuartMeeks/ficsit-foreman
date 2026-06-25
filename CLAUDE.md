# FICSIT Foreman — orientation for Claude Code

**FICSIT Foreman** is an AI companion web app for *Satisfactory*: a configurable
"foreman" that issues structured work orders, answers game questions from real
game data, and adapts to the factory floor. It runs locally via Docker Compose.

This file is a **map**, not a spec — it points at the canonical docs and states
the conventions' home. Read the relevant doc before working in an area.

## Monorepo layout (npm workspaces)

```
packages/
  game-data-core/   parser + shared types + bundled game data (lib; PARSER.md here)
  mcp-game-data/    game-data MCP server (Kùzu graph + tools + world locations)
  mcp-save-game/    save-game MCP server (live pioneer state from a .sav)
  server/           Express backend: LLM proxy (SSE), sessions, work orders, MCP gateway
                    (the foreman system prompt lives here: SYSTEM_PROMPT.md)
  client/           React + Vite web UI (chat + work-order cockpit)
docs/               product.md · architecture.md · work-orders.md · playthroughs.md
```

## Where to find what

| You want… | Read |
|---|---|
| The product — problem, vision, features | [`docs/product.md`](./docs/product.md) |
| How it fits together — services, MCP boundary, graph, deployment | [`docs/architecture.md`](./docs/architecture.md) |
| The work-order design (states, revisions, audit, plan/execution split) | [`docs/work-orders.md`](./docs/work-orders.md) |
| The session/playthrough & foreman model (design) | [`docs/playthroughs.md`](./docs/playthroughs.md) |
| The save subsystem (identity, re-upload history, same-game) — design & roadmap | [`docs/save-subsystem.md`](./docs/save-subsystem.md) |
| The game-data parser & class-map design | [`packages/game-data-core/PARSER.md`](./packages/game-data-core/PARSER.md) |
| The foreman persona (runtime prompt) | [`packages/server/SYSTEM_PROMPT.md`](./packages/server/SYSTEM_PROMPT.md) |
| A package's usage, tools, and setup | that package's `README.md` |
| Conventions (commit/PR/branch/code standards) and game-data updates | [`CONTRIBUTING.md`](./CONTRIBUTING.md) |

## Status

Phases 1 (game-data MCP) and 2 (backend & foreman chat) are complete and merged;
Work Orders v2 shipped. The web client (Phase 3) is in progress. The save-game MCP
shipped v1. Live, per-component work is tracked in the
[issue tracker](https://github.com/StuartMeeks/ficsit-foreman/issues).

## Conventions

All commit / branch / PR / issue / code-standard conventions live in
[`CONTRIBUTING.md`](./CONTRIBUTING.md) — follow them exactly. In brief: Conventional
Commits with a required body; `feature/`-style branches; never commit to `main`;
squash-merge; British English in comments and docs; AI-generated PRs open with the
`🤖 AI-generated PR` line. When filing an issue, give it a type label, an `area:`
label and a milestone.

## Dev environment note

Development happens on a Proxmox VM over SSH. The Satisfactory game files are **not**
accessible from the VM. The game data file (`en-US.json`) is copied manually from the
Windows host and placed at `game-data/en-US.json` (gitignored); point
`SATISFACTORY_DOCS_PATH` at it. Do not assume a game directory is mounted at runtime.
