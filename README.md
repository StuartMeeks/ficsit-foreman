# Foreman

Foreman is an AI companion for the game **Satisfactory**. It acts as your on-site
foreman: it knows the game, tracks where you are in it, and hands you a human-scaled
next step instead of an overwhelming blueprint — keeping the maths off your plate so
you can stay in the game. The foreman's personality is chosen by you during
onboarding; there is no hardcoded character.

This repository is a monorepo. **Phase 1 (this release) delivers the game-data
backbone** — a locally-run MCP server that parses your Satisfactory install and
answers production questions accurately. The chat backend and web UI are later
phases (see [`SPEC.md`](./SPEC.md)).

---

## What's in this release

| Package | Status | Purpose |
|---|---|---|
| [`packages/mcp`](./packages/mcp) | **Built** | Parses `en-US.json`, loads it into an embedded Kùzu graph, exposes computed MCP tools. Works standalone with Claude Desktop. |
| `packages/server` | Phase 2 | Express backend: Anthropic proxy, foreman persona, work-order persistence. |
| `packages/client` | Phase 3 | React UI: foreman chat, active work order, history. |

> Docker Compose packaging is planned for a later phase. Phase 1 runs bare-metal via
> Node.js, as described below.

## Prerequisites

- **Node.js 20+** and **npm 10+** — all platforms (Windows / macOS / Linux).
- A copy of Satisfactory's `en-US.json`, found in your install at
  `CommunityResources/Docs/en-US.json`. It is UTF-16 LE encoded; Foreman handles that.

## Quick start

```bash
git clone https://github.com/StuartMeeks/ficsit-foreman
cd ficsit-foreman
npm install
cp .env.example .env
# Edit .env: set SATISFACTORY_DOCS_PATH (or SATISFACTORY_GAME_DIR)

npm run build      # builds packages/mcp
npm test           # runs the test suite

# Try it without an MCP client:
npm run inspect -- total_raw_inputs '{"item":"Reinforced Iron Plate","targetPerMinute":5}'
```

To use it from Claude Desktop, see the wiring instructions in
[`packages/mcp/README.md`](./packages/mcp/README.md).

## Pointing at your game install

Set **one** of these (in `.env`, or in the MCP client's `env` block):

- `SATISFACTORY_DOCS_PATH` — full path straight to `en-US.json`. Best when the game
  files aren't mounted locally (e.g. a headless VM where the file was copied across).
- `SATISFACTORY_GAME_DIR` — your Satisfactory install root; Foreman appends
  `CommunityResources/Docs/en-US.json`.

Example install roots:

| Platform / store | Path |
|---|---|
| Steam (Windows) | `C:/Program Files (x86)/Steam/steamapps/common/Satisfactory` |
| Epic (Windows) | `C:/Program Files/Epic Games/SatisfactoryExperimental` |
| Steam (Linux) | `~/.steam/steam/steamapps/common/Satisfactory` |

A leading `~` is expanded to your home directory.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `SATISFACTORY_DOCS_PATH` | One of these | Full path to `en-US.json`. Takes priority. |
| `SATISFACTORY_GAME_DIR` | One of these | Game install root; docs path is derived from it. |
| `ANTHROPIC_API_KEY` | Phase 2+ | For the foreman chat backend. Not used by the Phase 1 MCP server. |

If neither game-data variable is set, the MCP server starts with an empty dataset and
logs a warning rather than failing.

## Contributing

Contributions are welcome. The open design questions live at the bottom of
[`SPEC.md`](./SPEC.md) — that's the best place to start. The parser and graph design
are documented in [`PARSER.md`](./PARSER.md).

## Licence

[Apache 2.0](./LICENSE). Use it, fork it, build on it.

## Attribution

Built by Stu · [GitHub](https://github.com/StuartMeeks) · [Reddit](https://www.reddit.com/user/stu-globe)
