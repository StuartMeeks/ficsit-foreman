# Foreman

Foreman is an AI companion for the game **Satisfactory**. It acts as your on-site
foreman: it knows the game, tracks where you are in it, and hands you a human-scaled
next step instead of an overwhelming blueprint — keeping the maths off your plate so
you can stay in the game. The foreman's personality is chosen by you during
onboarding; there is no hardcoded character.

This repository is a monorepo. **Phase 1 (this release) delivers the game-data
backbone** — a locally-run MCP server that answers production questions accurately from
real game data (bundled in, or parsed from your own install). The chat backend and web
UI are later phases (see [`SPEC.md`](./SPEC.md)) and will run alongside it as services in
the same Docker Compose project.

---

## What's in this release

| Package | Status | Purpose |
|---|---|---|
| [`packages/mcp`](./packages/mcp) | **Built** | Parses `en-US.json`, loads it into an embedded Kùzu graph, exposes computed MCP tools. Works standalone with Claude Desktop. |
| `packages/server` | Phase 2 | Express backend: Anthropic proxy, foreman persona, work-order persistence. |
| `packages/client` | Phase 3 | React UI: foreman chat, active work order, history. |

> Foreman runs as a **Docker Compose project**: the backend (Phase 2) and web UI (Phase 3)
> will be added as separate services in the same project, so Docker Desktop keeps them
> grouped together under one start/stop.

---

## Quick start (Docker — recommended)

Foreman ships as a Docker image with the latest **stable** game data baked in, so it runs
with **zero setup — you don't even need to find your game files**.

### Windows (Docker Desktop)

Most Satisfactory players are on Windows, so here's the full path:

1. Install **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** and start
   it. (It sets up the WSL 2 backend for you — just accept the prompts and let it finish.)
2. Save the [`compose.yaml`](./compose.yaml) from this repo into a folder (or copy this):

   ```yaml
   name: foreman
   services:
     mcp:
       image: ghcr.io/stuartmeeks/foreman-mcp:latest
       container_name: foreman-mcp
       ports:
         - "8723:8723"
       restart: unless-stopped
   ```
3. Open a terminal in that folder and run:

   ```powershell
   docker compose up -d
   ```

   *(GUI alternative: in Docker Desktop's **Images** tab, search
   `ghcr.io/stuartmeeks/foreman-mcp`, click **Run**, expand **Optional settings**, set the
   name to `foreman-mcp` and the host port to `8723`.)*
4. Confirm it's running: open **<http://localhost:8723/health>** — you should see
   `{"status":"ok","version":"1.2.3.0"}`.

**Start and stop it** any time from Docker Desktop's **Containers** tab (the `foreman`
project), or with `docker compose stop` / `docker compose start`. **Update** to a newer
build with `docker compose pull` then `docker compose up -d`.

### macOS / Linux

Use the same `compose.yaml` (`docker compose up -d`), or a one-off container:

```bash
docker run -d --name foreman-mcp -p 8723:8723 ghcr.io/stuartmeeks/foreman-mcp:latest
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

Prefer not to use Docker, or want to develop on Foreman? You'll need **Node.js 22+** and
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
[`packages/mcp/README.md`](./packages/mcp/README.md).

---

## Configuration

All optional — by default the server serves the bundled **stable** game data.

| Variable | Description |
|---|---|
| `SATISFACTORY_GAME_CHANNEL` | Which bundled channel to use: `stable` (default) or `experimental`. |
| `SATISFACTORY_DOCS_PATH` | Full path to your own `en-US.json`. Highest priority. |
| `SATISFACTORY_GAME_DIR` | Your Satisfactory install root; the docs path is derived from it. |
| `MCP_TRANSPORT` | `stdio` (default, for Claude Desktop) or `http` to listen on a network port. |
| `MCP_HTTP_HOST` | HTTP bind host when `MCP_TRANSPORT=http` (default `0.0.0.0`). |
| `MCP_HTTP_PORT` | HTTP port when `MCP_TRANSPORT=http` (default `8723`). |
| `ANTHROPIC_API_KEY` | For the foreman chat backend (Phase 2+). Not used by the Phase 1 MCP server. |

Resolution order for game data: `SATISFACTORY_DOCS_PATH` → `SATISFACTORY_GAME_DIR` →
bundled channel (`SATISFACTORY_GAME_CHANNEL`) → empty dataset with a warning.

---

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the workflow
and conventions, including how to supply bundled `en-US.json` game-data updates. The open
design questions live at the bottom of [`SPEC.md`](./SPEC.md), and the parser and graph
design are documented in [`PARSER.md`](./PARSER.md).

## Licence

[Apache 2.0](./LICENSE). Use it, fork it, build on it.

## Attribution

Built by Stu · [GitHub](https://github.com/StuartMeeks) · [Reddit](https://www.reddit.com/user/sherman384)
