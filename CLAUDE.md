# FICSIT Foreman — orientation for Claude Code

**FICSIT Foreman** is an AI companion web app for *Satisfactory*: a configurable
"foreman" that issues structured work orders, answers game questions from real
game data, and adapts to the factory floor. It runs locally via Docker Compose.

This file is a **map**, not a spec — it points at the canonical docs and states
the conventions' home. Read the relevant doc before working in an area.

## Monorepo layout (npm workspaces)

```
packages/
  sf-core/            structural/identity kernel — class-name helpers (zero-dep lib)
  sf-present/         reusable presentation helpers — humaniseClassName + unit/bearing (zero-dep lib)
  sf-game-data/       GameData types + merged-dataset loaders + bundled data (lib).
                      The offline C# extractor (en-US.json + cooked assets → one
                      sf-game-data.json per channel) lives in extract/ (PARSER.md here)
  sf-game-data-graph/ Kùzu production graph as a library (carries the kuzu addon)
  sf-save-data/       .sav → SaveState parser + normalise (lib)
  sf-mcp/             unified MCP server: game-data graph tools + live save-game tools
  ff-server/          Express backend: LLM proxy (SSE), sessions, work orders, MCP gateway
                      (the foreman system prompt lives here: SYSTEM_PROMPT.md)
  ff-client/          React + Vite web UI (chat + work-order cockpit)
docs/                 product.md · architecture.md · work-orders.md · playthroughs.md
```

## Where to find what

| You want… | Read |
|---|---|
| The product — problem, vision, features | [`docs/product.md`](./docs/product.md) |
| How it fits together — services, MCP boundary, graph, deployment | [`docs/architecture.md`](./docs/architecture.md) |
| The **target** component architecture — `sf-*`/`ff-*` packaging, reuse, community split | [`docs/component-architecture.md`](./docs/component-architecture.md) |
| The work-order design (states, revisions, audit, plan/execution split) | [`docs/work-orders.md`](./docs/work-orders.md) |
| Ingest-time verification of work-order quantities (#223) — power reject + manufacturing advisory | [`docs/work-order-quantity-verification.md`](./docs/work-order-quantity-verification.md) |
| The session/playthrough & foreman model (design) | [`docs/playthroughs.md`](./docs/playthroughs.md) |
| The save subsystem (identity, re-upload history, same-game) — design & roadmap | [`docs/save-subsystem.md`](./docs/save-subsystem.md) |
| Crash-site loot & drop-pod unlock costs (#107) — design | [`docs/crash-site-loot.md`](./docs/crash-site-loot.md) |
| The game-data parsing logic & class-map (implemented by the C# parser) | [`packages/sf-game-data/PARSER.md`](./packages/sf-game-data/PARSER.md) |
| The single-producer game-data pipeline (`sf-game-data-extractor`) — design | [`docs/sf-game-data-extractor.md`](./docs/sf-game-data-extractor.md) |
| The foreman persona (runtime prompt) | [`packages/ff-server/SYSTEM_PROMPT.md`](./packages/ff-server/SYSTEM_PROMPT.md) |
| A package's usage, tools, and setup | that package's `README.md` |
| Conventions (commit/PR/branch/code standards) and game-data updates | [`CONTRIBUTING.md`](./CONTRIBUTING.md) |

## Status

Phases 1 (game-data MCP) and 2 (backend & foreman chat) are complete and merged;
Work Orders v2 shipped. The web client (Phase 3) is in progress. The save-game MCP
shipped v1. The **single-producer game-data pipeline** shipped (epic #164): an
offline C# extractor parses `en-US.json` and extracts the cooked assets into one
merged `sf-game-data.json` per channel, which the runtime loads directly — the raw
`en-US.json` is no longer committed. Live, per-component work is tracked in the
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
accessible from the VM. A copy of `en-US.json` may be placed at `game-data/en-US.json`
(gitignored) for the **offline extractor** to parse (`--enus`); it is **not** read at
runtime and is never committed. The VM and the running server load the bundled merged
`sf-game-data.json` (or `SF_GAME_DATA_PATH`). The C# extractor itself only builds/runs
on the Windows host (CUE4Parse + a game install) — do not assume a game directory is
mounted at runtime.
