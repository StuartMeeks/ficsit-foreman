# @foreman/mcp-save-game

The FICSIT Foreman **save-game** MCP server. It parses a Satisfactory save file
into normalised JSON and exposes the pioneer's **actual** progress — location,
inventories, unlocks, and collectibles — as [Model Context
Protocol](https://modelcontextprotocol.io) tools.

Where [`@foreman/mcp-game-data`](../mcp-game-data) answers *"how is anything in
the game made?"* from the static game data, this server answers *"what has this
pioneer actually built, unlocked, and collected?"* from their live save. Together
they let the foreman issue orders grounded in reality rather than assumption.

> **Status: v1.** Parses a save and serves five read-only tools over stdio or
> HTTP. See [`SPEC.md`](./SPEC.md) for the technical design and the
> save-file-format decision. Use `npm run inspect <save>` to inspect a real save.

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
the server logs a warning and starts with no save loaded — tools return empty
results rather than crashing (mirroring the game-data server). The save is
re-parsed automatically when its mtime changes, so progress shows up as you play
without a restart.

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

Like the game-data server, it defaults to MCP over **stdio** and offers an opt-in
HTTP transport (`MCP_TRANSPORT=http`, `MCP_HTTP_PORT` default `8726`) for running
as a Docker Compose service.

### Docker / Compose

A `mcp-save-game` service is part of the project [`compose.yaml`](../../compose.yaml),
so `docker compose pull` / `up` include it. It runs even with no save configured
(serving empty results). To use a save, point `SAVE_FILE_PATH` at the in-container
`.sav` path and mount your save directory read-only (uncomment `volumes` in the
compose file):

```bash
SAVE_FILE_PATH=/saves/MySave.sav docker compose up -d
```

---

## Tools (v1)

All tools are read-only and tag every response with the detected game version and
save name. They return computed, distilled answers — not raw save dumps.

| Tool | Description |
|---|---|
| `get_player_state()` | Player location (x, y, z), HUB location, and the personal inventory (aggregated per item). |
| `get_unlocked_recipes()` | All unlocked recipes, split into standard and alternate, with counts. |
| `get_milestones()` | Unlocked milestones grouped by tier, tutorial schematics, MAM research unlocks, and the current Project Assembly (Space Elevator) phase. |
| `get_storage(location?)` | Storage container contents and the dimensional depot; pass a `{x,y,z}` location to sort containers nearest-first. |
| `get_collectibles()` | Collected-collectible summary: reliable alien-artifact and power-slug totals, an approximate per-type split, and world totals for reference. See the note below. |

> **Collectibles are approximate by design.** The save records collected
> collectibles as a per-level destroyed-actor registry of bare references — no
> central counter, no per-item type/location. Alien-artifact and power-slug
> *totals* are reliable; the Mercer/Somersloop split and drop-pod/hard-drive counts
> are best-effort. Exact per-type counts and locations need the world-location
> dataset (game-data v3). Every `get_collectibles` response carries a `note`
> explaining this.

Later versions add power (`v2`) and production-line (`v3`) tools — see
[`SPEC.md`](./SPEC.md) and the [issue tracker](https://github.com/StuartMeeks/ficsit-foreman/issues).

## Inspecting a real save

`npm run inspect` is a debug CLI (separate from the server) for confirming the
class names in `src/constants.ts` against a real save:

```bash
SAVE_FILE_PATH=~/saves/My.sav npm run inspect -w @foreman/mcp-save-game            # overview
npm run inspect -w @foreman/mcp-save-game -- typepaths ~/saves/My.sav              # typePath histogram
npm run inspect -w @foreman/mcp-save-game -- props RecipeManager ~/saves/My.sav    # property keys of matches
npm run inspect -w @foreman/mcp-save-game -- get_player_state ~/saves/My.sav       # run a tool
npm run inspect -w @foreman/mcp-save-game -- diff ~/saves/A.sav ~/saves/B.sav      # collectables delta
```

## Architecture

```
save file (.sav, custom binary)
   → parser       adapter over @etothepii/satisfactory-file-parser → RawSave (sole library boundary)
   → normalise    RawSave → clean, typed SaveState (player, storage, recipes, milestones, collectibles)
   → store        holds the SaveState; re-parses lazily when the file's mtime changes
   → selectors    pure, computed read functions (proximity sort, tier grouping, …)
   → MCP tools    version-tagged answers over stdio or HTTP
```

The same principle as the game-data server applies: **tools return computed,
distilled answers — not raw save dumps.** A save file is large; the value is in
extracting the few facts the foreman needs. Every Unreal class name and property
key we match on lives in one place, `src/constants.ts`.

## Attribution

This server **adopts** [`@etothepii/satisfactory-file-parser`](https://github.com/etothepii4/satisfactory-file-parser)
(MIT) to decode the binary `.sav` format — credit and thanks to *etothepii* for
maintaining it. The save-format understanding was cross-checked against two other
open-source parsers: [`SatisfactorySaveNet`](https://github.com/R3dByt3/SatisfactorySaveNet)
(C#, by *R3dByt3*) and [`GreyHak/sat_sav_parse`](https://github.com/GreyHak/sat_sav_parse)
(Python, by *GreyHak*). Thanks to all three projects and the Satisfactory modding
community whose format documentation made this possible.
