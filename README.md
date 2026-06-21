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

> Phase 1 runs bare-metal via Node.js (below) or as a Docker image (see
> [Run with Docker](#run-with-docker)). A multi-service `docker compose` setup arrives
> with the Phase 2 backend.

## Prerequisites

- **Node.js 22+** and **npm 10+** — all platforms (Windows / macOS / Linux).
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

## Run with Docker

The MCP server is published as a container image with the bundled **stable** game data
baked in, so it serves data with no setup. It defaults to the HTTP transport on port
**8723**.

```bash
# Pull and run (serves stable game data over HTTP):
docker run --rm -p 8723:8723 ghcr.io/stuartmeeks/foreman-mcp:latest
# → http://localhost:8723/mcp   (health check: http://localhost:8723/health)

# Pick the experimental channel, or map to a different host port:
docker run --rm -p 9000:8723 -e SATISFACTORY_GAME_CHANNEL=experimental \
  ghcr.io/stuartmeeks/foreman-mcp:latest

# Use your own game install instead of the bundled data:
docker run --rm -p 8723:8723 \
  -v "/path/to/Satisfactory:/game:ro" -e SATISFACTORY_GAME_DIR=/game \
  ghcr.io/stuartmeeks/foreman-mcp:latest
```

> The HTTP transport has **no authentication** — keep it on localhost/your LAN (or behind
> the Phase 2 backend), not exposed to the internet. To build locally instead of pulling:
> `docker build -t foreman-mcp .`

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
| `SATISFACTORY_GAME_CHANNEL` | No | Which bundled channel to load when no local install is set: `stable` (default) or `experimental`. |
| `MCP_TRANSPORT` | No | `stdio` (default, for Claude Desktop) or `http` to listen on a network port. |
| `MCP_HTTP_HOST` | No | HTTP bind host when `MCP_TRANSPORT=http` (default `0.0.0.0`). |
| `MCP_HTTP_PORT` | No | HTTP port when `MCP_TRANSPORT=http` (default `8723`). |
| `ANTHROPIC_API_KEY` | Phase 2+ | For the foreman chat backend. Not used by the Phase 1 MCP server. |

> The HTTP transport has **no authentication** in Phase 1 — only run it on a trusted
> localhost/LAN.

If neither game-data variable is set, the MCP server falls back to bundled channel data
under `packages/mcp/data/<channel>/` (selected by `SATISFACTORY_GAME_CHANNEL`), and
otherwise starts with an empty dataset and a warning rather than failing.

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the workflow
and conventions, including how to supply bundled `en-US.json` game-data updates. The open
design questions live at the bottom of [`SPEC.md`](./SPEC.md), and the parser and graph
design are documented in [`PARSER.md`](./PARSER.md).

## Licence

[Apache 2.0](./LICENSE). Use it, fork it, build on it.

## Attribution

Built by Stu · [GitHub](https://github.com/StuartMeeks) · [Reddit](https://www.reddit.com/user/sherman384)
