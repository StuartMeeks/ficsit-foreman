# FICSIT Foreman — Save-Game MCP Server Technical Spec

This document is the technical design for `packages/mcp-save-game`: a standalone
MCP server that reads a Satisfactory **save file** and exposes the pioneer's live
progress as computed MCP tools.

It is the save-state counterpart to `packages/mcp-game-data` (which serves the
static, version-tagged game data). This server answers *"what has this pioneer
actually built, unlocked, and collected?"*. The two run independently and are
consumed together by the foreman.

> **Status:** v1 implemented. Parser → normalise → store → tools are in place and
> validated against real saves; see the README for usage and `npm run inspect`.

---

## Architecture

```
save file (.sav)  ──▶  parser  ──▶  normalised JSON  ──▶  MCP tools
   custom binary        decode        clean typed model      computed answers
```

1. **Parser** — decode the custom binary save format (see *Save File Format* below)
   into raw, structured objects.
2. **Normalise** — resolve Unreal class names to clean item/recipe identifiers
   (reusing the conventions established in `PARSER.md`), convert coordinates and
   quantities into typed records, and discard save noise. The output is a clean,
   serialisable `SaveState` model.
3. **MCP tools** — expose computed, distilled answers over the normalised model.
   The save file is large; the value is extracting the handful of facts the
   foreman needs, not returning raw save dumps.

**Cross-referencing game data.** Item/recipe class names in a save match the class
names parsed by `mcp-game-data`. The save-game server reports those identifiers (and
resolves display names where it can); richer lookups — recipe ingredients, build
costs — remain the game-data server's job. This server does **not** duplicate the
game-data graph.

**Design principles (shared with `mcp-game-data`):**
- Tools return computed answers, not raw rows.
- Never throw on a bad entry — collect warnings, surface a partial parse.
- All responses are tagged with the save's detected game version (and save name).
- Read-only: the server never writes to the save file.

### Configuration

| Variable | Meaning |
|---|---|
| `SAVE_FILE_PATH` | Full path to the `.sav` to read. A leading `~` is expanded. If unset, the server starts with no save loaded and warns (never crashes). |
| `MCP_TRANSPORT` | `stdio` (default) or `http`. |
| `MCP_HTTP_HOST` / `MCP_HTTP_PORT` | Bind host/port for http mode (default `0.0.0.0:8726`). |

The server should watch `SAVE_FILE_PATH` (or re-parse on demand) so the foreman
sees progress as the pioneer plays, without a restart. Exact reload strategy is a
v1 implementation detail (re-parse on file mtime change is the simplest).

---

## v1 — Pioneer Progress

### Data extracted

- **Player location** — x, y, z world coordinates.
- **Hub location** — coordinates of the HUB / first build.
- **Player inventory** — item, quantity (the pioneer's personal inventory).
- **Storage container inventories** — item, quantity, and the container's location,
  for every storage container.
- **Dimensional depot contents** — item, quantity (the central storage upload).
- **Unlocked recipes** — standard and alternate, distinguished.
- **MAM research unlocks** — completed MAM nodes.
- **Milestone unlocks** — by tier.
- **Current part assembly phase** — Project Assembly / Space Elevator phase.
- **Harvested Mercer Spheres** — locations of collected spheres.
- **Harvested Somersloops** — locations of collected sloops.
- **Visited / looted crash sites** — which crash sites (hard-drive sites) have been
  opened, and (where known) unlocked.

### MCP tools

| Tool | Returns |
|---|---|
| `get_player_state()` | Player location, hub location, and personal inventory. |
| `get_unlocked_recipes()` | All unlocked recipes, including alternates, flagged standard vs alternate. |
| `get_milestones()` | Unlocked milestones grouped by tier, tutorial schematics, MAM research unlocks, and the current Project Assembly phase. |
| `get_storage(location?)` | Storage container inventories and dimensional depot contents; with `location`, sorted by proximity to that coordinate. |
| `get_collectibles()` | Collected-collectible summary: reliable alien-artifact and power-slug totals, an approximate per-type split, and world totals for reference. |

> **Collectibles — what the save actually records (confirmed against real saves).**
> The save stores collected collectibles only as a per-level "collected" (destroyed-
> actor) registry of bare instance references — there is no central counter, and the
> references carry no type, colour, or location. Calibrated against ground truth: the
> alien-artifact (`BP_WAT`) and power-slug (`BP_Crystal`) **totals** are reliable; the
> Mercer/Somersloop split, slug colour, and drop-pod/hard-drive counts are
> **approximate**. Exact per-type counts and locations — and the *un*harvested
> complement — require the full world collectible-location set, which is **world
> data** owned by `mcp-game-data` v3 (*World Locations*), not save data. v1 therefore
> reports the reliable totals + an approximate split + known world totals as
> reference, and states the limitation in the response. (Drop-pod actor bodies do not
> fully decode on current builds, so hard-drive loot-state is likewise deferred.)

---

## v2 — Power

### Data extracted
- **Generators** — type, fuel in use, MW output, location.
- **Power grids** — total capacity, total consumption, and a coverage map of which
  buildings/areas a grid serves.

### MCP tools (planned)
- `get_power()` — per-grid capacity vs consumption, headroom, and tripped/over-draw
  status.
- `get_generators(location?)` — generators with output and fuel, optionally by
  proximity.

---

## v3 — Production

### Data extracted
- **Active production lines** — building, recipe, clock speed (overclock), location.
- **Per-line production rates** — actual (given clock + uptime) vs theoretical.

### MCP tools (planned)
- `get_production(item?)` — active lines, optionally filtered to those producing a
  given item, with actual-vs-theoretical throughput.
- `find_bottlenecks()` — lines starved of input or backed up on output.

---

## Save File Format

Satisfactory save files (`.sav`) are a **custom binary format** authored by Coffee
Stain Studios. Key characteristics (to be confirmed against the target game version
during v1):

- A header (save version, build version, session name, play time, etc.) followed by
  a body of **chunked, zlib-compressed** data.
- The decompressed body is a serialised object graph of actors and components
  (buildings, the player, inventories, the research/schematic manager, etc.), using
  Unreal Engine property serialisation.
- Object and class references use the same `…/Path.ClassName_C` convention handled
  by the game-data parser, so class-name normalisation can be shared.
- The format **changes between game versions** — any parser must be version-aware and
  degrade gracefully (warn-and-skip) on unknown structures, like the game-data parser.

### Parser: build vs adopt

There are two routes to a working parser. This decision should be made at the start
of v1.

**Option A — adopt a community parser** (e.g.
[`@etothepii/satisfactory-file-parser`](https://www.npmjs.com/package/@etothepii/satisfactory-file-parser),
repo `etothepii4/satisfactory-file-parser`).

- ✅ Fastest path to a working v1; the hard binary/zlib/property decoding is done.
- ✅ Community-maintained against new game versions (when active).
- ⚠️ **Evaluate maintenance status before adopting:** recent commits, issue/PR
  responsiveness, support for the current game version, release cadence, typings
  quality, and licence compatibility (we ship Apache-2.0). A parser that lags game
  updates becomes a liability the moment players patch.
- ⚠️ External dependency surface and API churn; we would wrap it behind our own
  `normalise` layer so a future swap doesn't ripple into the tools.

**Option B — build our own parser** (in the spirit of the hand-written game-data
parser).

- ✅ No third-party dependency; full control over version handling and error
  philosophy; consistent with the "no third-party parsing libraries" stance in the
  root spec.
- ✅ We only need to decode the slices we use (player, inventories, schematic
  manager, collectibles) — not the entire save.
- ⚠️ Substantial up-front effort: binary framing, zlib chunk decompression, and
  Unreal property serialisation are non-trivial and must track game-version changes
  ourselves.

**Decision (v1, 2026-06):** we **adopted** `@etothepii/satisfactory-file-parser`
(`^4.1.0`, MIT — actively maintained, supports save versions 1.0–1.2), wrapped behind
our own `normalise` layer (`src/parser/index.ts` is the sole importer, so a future
swap or in-house parser is contained there). Two other implementations were consulted
to confirm the format —
[`SatisfactorySaveNet`](https://github.com/R3dByt3/SatisfactorySaveNet) (C#) and
[`GreyHak/sat_sav_parse`](https://github.com/GreyHak/sat_sav_parse) (Python); all three
agree on the structures we read. Re-evaluate building in-house if the chosen library
becomes unmaintained or blocks a game-version update.

---

## Testing

Mirror the game-data package: Vitest against **hand-crafted fixtures**, never a real
player save in the repo. Cover normalisation (class-name resolution, coordinate and
quantity decoding, standard-vs-alternate recipes, collectible classification), and
each tool's computed output against known values. Keep any real `.sav` used for local
testing out of version control (gitignored); `npm run inspect <save>` is the
regression check against real saves.
