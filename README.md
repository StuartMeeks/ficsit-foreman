# FICSIT Foreman

FICSIT Foreman is an AI companion for the game **Satisfactory**. It acts as your on-site
foreman: it knows the game, tracks where you are in it, and hands you a human-scaled
next step instead of an overwhelming blueprint — keeping the maths off your plate so
you can stay in the game. The foreman's personality is chosen by you during
onboarding; there is no hardcoded character.

This repository is a monorepo. It delivers the **game-data backbone** (an MCP server that
answers production questions accurately from real game data), the **foreman chat backend**
(a chat proxy — Anthropic or any OpenAI-compatible provider — with the foreman persona and
work-order persistence), and a **web UI** to talk to the foreman. All three run as services
in one Docker Compose project.

---

## What's in this release

| Package | Status | Purpose |
|---|---|---|
| [`packages/mcp-game-data`](./packages/mcp-game-data) | **Built** | Parses `en-US.json`, loads it into an embedded Kùzu graph, exposes computed MCP tools. Works standalone with Claude Desktop. |
| [`packages/mcp-save-game`](./packages/mcp-save-game) | **Built (v1)** | Save-file parser → MCP tools exposing live pioneer state (location, inventory, unlocks, milestones, remaining collectibles). The backend merges it in when `SAVE_MCP_URL` is set. See its [SPEC.md](./packages/mcp-save-game/SPEC.md). |
| [`packages/server`](./packages/server) | **Built** | Express backend: LLM chat proxy (Anthropic or OpenAI-compatible) with the foreman persona, MCP tool use, and stateful work-order persistence (see [`docs/work-orders.md`](./docs/work-orders.md)). |
| [`packages/client`](./packages/client) | **In progress** | React UI (Phase 3): foreman chat (streaming), active work-order panel, history, and onboarding/settings. Served on port `8725`. |

> FICSIT Foreman runs as a **Docker Compose project** named `foreman`: the MCP server and
> backend are separate services in the one project (the web UI joins later), so Docker
> Desktop keeps them grouped together under one start/stop.

---

## Quick start (Docker — recommended)

FICSIT Foreman ships as a Docker image with the latest **stable** game data baked in, so it runs
with **zero setup — you don't even need to find your game files**.

### Windows (Docker Desktop)

Most Satisfactory players are on Windows, so here's the full path:

1. Install **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** and start
   it. (It sets up the WSL 2 backend for you — just accept the prompts and let it finish.)
2. Save the [`compose.yaml`](./compose.yaml) from this repo into a folder (or copy this):

   ```yaml
   name: foreman
   services:
     mcp-game-data:
       image: ghcr.io/stuartmeeks/foreman-mcp-game-data:latest
       container_name: foreman-mcp-game-data
       ports:
         - "8723:8723"
       restart: unless-stopped
   ```

   *(The snippet above is the MCP server on its own — all you need to use FICSIT Foreman
   from Claude Desktop. The full [`compose.yaml`](./compose.yaml) in this repo runs the
   whole stack: the MCP server, the `server` backend (`:8724`), and the `web` UI (`:8725`).
   To run it all and chat with the foreman in your browser, set `ANTHROPIC_API_KEY` (or
   enter a key in the UI's settings) and run `docker compose up -d --build`, then open
   **<http://localhost:8725>**.)*
3. Open a terminal in that folder and run:

   ```powershell
   docker compose up -d
   ```

   *(GUI alternative: in Docker Desktop's **Images** tab, search
   `ghcr.io/stuartmeeks/foreman-mcp-game-data`, click **Run**, expand **Optional settings**, set the
   name to `foreman-mcp-game-data` and the host port to `8723`.)*
4. Confirm it's running: open **<http://localhost:8723/health>** — you should see
   `{"status":"ok","version":"1.2.3.0"}`.

**Start and stop it** any time from Docker Desktop's **Containers** tab (the `foreman`
project), or with `docker compose stop` and `docker compose start` — this keeps the
containers in place (they stay listed in Docker Desktop, just stopped). Use
`docker compose down` only when you want to **remove** the containers; your data
survives in the `foreman-db` volume either way. **Update** to a newer build with
`docker compose pull` then `docker compose up -d`.

### macOS / Linux

Use the same `compose.yaml` (`docker compose up -d`), or a one-off container:

```bash
docker run -d --name foreman-mcp-game-data -p 8723:8723 ghcr.io/stuartmeeks/foreman-mcp-game-data:latest
```

> **Note:** the server speaks the MCP **Streamable-HTTP** protocol at
> `http://localhost:8723/mcp` — that endpoint is for MCP clients, not a web browser (a
> browser GET returns `405`). Use `/health` to check it's alive. It has **no
> authentication**, so keep it on your own machine or LAN, never the public internet.

---

## Using a specific game version (optional)

The image bundles the latest **stable** data. To use something else, set these in
`compose.yaml` (`environment:` / `volumes:`) or via `docker run -e` / `-v`:

- **Experimental channel:** `SATISFACTORY_GAME_CHANNEL=experimental`.
- **Your exact install:** mount it read-only and point the server at it —
  `-v "C:/Program Files (x86)/Steam/steamapps/common/Satisfactory:/game:ro"` plus
  `-e SATISFACTORY_GAME_DIR=/game`.

Common install roots:

| Platform / store | Path |
|---|---|
| Steam (Windows) | `C:/Program Files (x86)/Steam/steamapps/common/Satisfactory` |
| Epic (Windows) | `C:/Program Files/Epic Games/SatisfactoryExperimental` |
| Steam (Linux) | `~/.steam/steam/steamapps/common/Satisfactory` |

---

## Run from source (Node.js)

Prefer not to use Docker, or want to develop on FICSIT Foreman? You'll need **Node.js 22+** and
**npm 10+** (Windows / macOS / Linux).

```bash
git clone https://github.com/StuartMeeks/ficsit-foreman
cd ficsit-foreman
npm install
npm run build
npm test

# Try a tool against the bundled stable data (no game install needed):
npm run inspect -- total_raw_inputs '{"item":"Reinforced Iron Plate","targetPerMinute":5}'

# Run the server over HTTP (defaults to port 8723):
MCP_TRANSPORT=http npm run start
```

To wire the server into Claude Desktop over stdio, see
[`packages/mcp-game-data/README.md`](./packages/mcp-game-data/README.md).

---

## Configuration

All optional — by default the server serves the bundled **stable** game data.

**MCP server** (`packages/mcp-game-data`):

| Variable | Description |
|---|---|
| `SATISFACTORY_GAME_CHANNEL` | Which bundled channel to use: `stable` (default) or `experimental`. |
| `SATISFACTORY_DOCS_PATH` | Full path to your own `en-US.json`. Highest priority. |
| `SATISFACTORY_GAME_DIR` | Your Satisfactory install root; the docs path is derived from it. |
| `MCP_TRANSPORT` | `stdio` (default, for Claude Desktop) or `http` to listen on a network port. |
| `MCP_HTTP_HOST` | HTTP bind host when `MCP_TRANSPORT=http` (default `0.0.0.0`). |
| `MCP_HTTP_PORT` | HTTP port when `MCP_TRANSPORT=http` (default `8723`). |

**Backend** (`packages/server`):

| Variable | Description |
|---|---|
| `LLM_PROVIDER` | `anthropic` (native Claude, default) or `openai` (OpenAI-compatible). |
| `LLM_API_KEY` | Hosted-tier key for the chosen provider. If unset, clients pass their own via the `x-anthropic-api-key` header. |
| `LLM_MODEL` | Model (default `claude-sonnet-4-6` / `gpt-4.1`). |
| `LLM_BASE_URL` | OpenAI-compatible base URL (OpenAI, OpenRouter, Gemini-compat, Azure). |
| `MCP_URL` | Where the backend reaches the game-data MCP server (Compose: `http://mcp-game-data:8723/mcp`; bare metal default `http://127.0.0.1:8723/mcp`). |
| `SAVE_MCP_URL` | Optional save-game MCP endpoint. When set, its tools (player location, remaining collectibles, unlocks, inventory) are merged into the foreman's tool surface for location-aware opportunities. Unset = game-data tools only. |
| `PORT` | Backend HTTP port (default `8724`). |
| `DATABASE_URL` | Database connection (default `file:./dev.db`; Docker `file:/data/foreman.db`). For Postgres, use a `postgresql://` URL and switch the schema's datasource provider. |
| `BETTER_AUTH_SECRET` | Signs account session cookies. If unset, the server generates one on first start and persists it in the data volume (single-node deployments work out of the box). Set it explicitly (`openssl rand -base64 32`) for multi-instance or Postgres deployments. |
| `BETTER_AUTH_URL` | Public origin the app is served from (for correct cookies behind a proxy). Optional; derived from the request if unset. |
| `HISTORY_WINDOW` | Most-recent messages sent per chat request (default `20`). |

> The legacy `ANTHROPIC_*` variables still work when `LLM_PROVIDER` is `anthropic`.

### Using a different LLM provider

The foreman runs on Anthropic by default but works with any OpenAI-compatible
frontier provider. Set the provider on the server (covers everyone), or pick one
per player in the web UI's **Settings** (provider + model + your own key). For
example, to run the whole server on OpenRouter:

```bash
LLM_PROVIDER=openai
LLM_API_KEY=sk-or-...
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=anthropic/claude-sonnet-4.5   # or any model OpenRouter offers
```

Tool-calling quality varies by model — the foreman leans on tools heavily, so a
strong frontier model gives the best results.

Resolution order for game data: `SATISFACTORY_DOCS_PATH` → `SATISFACTORY_GAME_DIR` →
bundled channel (`SATISFACTORY_GAME_CHANNEL`) → empty dataset with a warning. See
[`.env.example`](./.env.example) for the complete list.

---

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the workflow
and conventions, including how to supply bundled `en-US.json` game-data updates. Planned
work and open design questions live in the [issue tracker](https://github.com/StuartMeeks/ficsit-foreman/issues);
the parser and graph design are documented in [`PARSER.md`](./packages/sf-game-data/PARSER.md).

## Licence

[Apache 2.0](./LICENSE). Use it, fork it, build on it.

## Disclaimer

FICSIT Foreman is an unofficial, community-made companion tool. It is **not affiliated
with, endorsed by, or sponsored by Coffee Stain Studios**. *Satisfactory*, *FICSIT*, and
all related names, logos, and game content are trademarks or property of Coffee Stain
Studios. Game data is read from files that ship with the game and remains their property.

## Attribution

Built by Stu · [GitHub](https://github.com/StuartMeeks) · [Reddit](https://www.reddit.com/user/sherman384)
