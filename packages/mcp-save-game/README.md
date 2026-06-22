# @foreman/mcp-save-game

The FICSIT Foreman **save-game** MCP server. It parses a Satisfactory save file
into normalised JSON and exposes the pioneer's **actual** progress — location,
inventories, unlocks, and collectibles — as [Model Context
Protocol](https://modelcontextprotocol.io) tools.

Where [`@foreman/mcp-game-data`](../mcp-game-data) answers *"how is anything in
the game made?"* from the static game data, this server answers *"what has this
pioneer actually built, unlocked, and collected?"* from their live save. Together
they let the foreman issue orders grounded in reality rather than assumption.

> **Status: scaffold.** The package layout, spec, and Docker/compose wiring are in
> place; the parser and tools are the v1 deliverable. See [`SPEC.md`](./SPEC.md)
> for the full technical design and the save-file-format tradeoffs. The current
> entry point is a stub that exits immediately.

---

## Prerequisites

- Node.js 22+
- A Satisfactory save file (`.sav`). On a default install these live at:
  - **Windows:** `%LOCALAPPDATA%\FactoryGame\Saved\SaveGames\<steam-id>\`
  - **Linux (Steam/Proton):** `…/steamapps/compatdata/<id>/pfx/drive_c/users/steamuser/AppData/Local/FactoryGame/Saved/SaveGames/`

## Pointing it at a save

Set `SAVE_FILE_PATH` to the full path of the `.sav` to read:

```bash
SAVE_FILE_PATH=/path/to/MySave.sav npm run dev -w @foreman/mcp-save-game
```

A leading `~` is expanded to your home directory. If `SAVE_FILE_PATH` is unset
the server starts with no save loaded (once v1 lands, it will log a warning and
expose empty results rather than crashing — mirroring the game-data server).

## Install & build

From the repository root (npm workspaces):

```bash
npm install
npm run build -w @foreman/mcp-save-game
```

## Running

```bash
# Development (watch mode, runs TypeScript directly):
SAVE_FILE_PATH=/path/to/MySave.sav npm run dev -w @foreman/mcp-save-game

# Production (after build):
SAVE_FILE_PATH=/path/to/MySave.sav npm run start -w @foreman/mcp-save-game
```

Like the game-data server, v1 will default to MCP over **stdio** and offer an
opt-in HTTP transport (`MCP_TRANSPORT=http`, `MCP_HTTP_PORT` default `8726`) for
running as a Docker Compose service.

### Docker / Compose

A `mcp-save-game` service is defined in the repo [`compose.yaml`](../../compose.yaml)
but **disabled by default**. It only starts under the `save-game` profile, and you
must point `SAVE_FILE_PATH` at a save (mount the save directory read-only):

```bash
SAVE_FILE_PATH=/saves/MySave.sav docker compose --profile save-game up -d
```

---

## Tools (v1 — planned)

All tools are read-only and report the parsed save's game version.

| Tool | Description |
|---|---|
| `get_player_state()` | Player location (x, y, z), hub location, and the player's personal inventory (item, quantity). |
| `get_unlocked_recipes()` | All unlocked recipes, **including alternates**, distinguishing standard from alternate. |
| `get_milestones()` | Unlocked milestones grouped by tier, plus the current part-assembly phase. |
| `get_storage(location?)` | Storage container inventories (item, quantity, container location) and dimensional depot contents; optionally filtered by proximity to a coordinate. |
| `get_collectibles()` | Harvested vs available Mercer Spheres and Somersloops (with locations), and visited/looted crash sites. |

Later versions add power (`v2`) and production-line (`v3`) tools — see
[`SPEC.md`](./SPEC.md) and the repo [`ROADMAP.md`](../../ROADMAP.md).

## Architecture (planned)

```
save file (.sav, custom binary)
   → parser            decode binary → raw objects
   → normalise         raw objects → clean, typed PlayerState / Inventory / Unlocks / Collectibles
   → MCP tools         computed, version-tagged answers (zod schemas)
```

The same principle as the game-data server applies: **tools return computed,
distilled answers — not raw save dumps.** A save file is large; the value is in
extracting the few facts the foreman needs.
