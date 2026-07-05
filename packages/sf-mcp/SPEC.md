# FICSIT Foreman — Save-Game Tools Technical Spec

This document is the technical design for the **save-game tools** now served by
`packages/sf-mcp`: reading a Satisfactory **save file** and exposing the pioneer's
live progress as computed MCP tools. (It originally described the standalone
`mcp-save-game` server, since consolidated into the unified `sf-mcp` server.)

It is the save-state counterpart to the **game-data tools** (which serve the
static, version-tagged game data). The save-game tools answer *"what has this
pioneer actually built, unlocked, and collected?"*. Both tool sets are served on
one endpoint and consumed together by the foreman.

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
   (reusing the conventions established in `../sf-game-data/PARSER.md`), convert coordinates and
   quantities into typed records, and discard save noise. The output is a clean,
   serialisable `SaveState` model.
3. **MCP tools** — expose computed, distilled answers over the normalised model.
   The save file is large; the value is extracting the handful of facts the
   foreman needs, not returning raw save dumps.

**Cross-referencing game data.** Item/recipe class names in a save match the class
names parsed by the game-data tools. The save-game tools report those identifiers (and
resolve display names where they can); richer lookups — recipe ingredients, build
costs — remain the game-data tools' job. The save-game tools do **not** duplicate the
game-data graph.

**Design principles (shared with the game-data tools):**
- Tools return computed answers, not raw rows.
- Never throw on a bad entry — collect warnings, surface a partial parse.
- All responses are tagged with the save's detected game version (and save name).
- Read-only: the server never writes to the save file.

### Configuration

| Variable | Meaning |
|---|---|
| `SAVE_FILE_PATH` | Full path to the `.sav` to read. A leading `~` is expanded. If unset, the server starts with no save loaded and warns (never crashes). |
| `MCP_TRANSPORT` | `stdio` (default) or `http`. |
| `MCP_HTTP_HOST` / `MCP_HTTP_PORT` | Bind host/port for http mode (default `0.0.0.0:8723`). |

The server re-parses on file **mtime change**, so the foreman sees progress as the
pioneer plays without a restart.

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
> data** owned by the game-data tools (*World Locations*), not save data. v1 therefore
> reports the reliable totals + an approximate split + known world totals as
> reference, and states the limitation in the response. (Drop-pod actor bodies do not
> fully decode on current builds, so hard-drive loot-state is likewise deferred.)

---

## v2 — Power

### Data extracted
- **Generators** — type, fuel in use, MW output, location.
- **Power grids** — total capacity, total consumption, and a coverage map of which
  buildings/areas a grid serves.

### MCP tools
- `get_power()` *(shipped)* — per-circuit capacity vs consumption, battery, headroom,
  and tripped/over-draw status.
- `find_bottlenecks(tolerance?)` *(shipped)* — steady-state flow analysis over the
  save's connection graph (throttled machines, starved links), via `@foreman/sf-flow`.
- `check_material_coverage(items)` *(shipped)* — whether on-hand + producible
  materials cover a set of item targets.

---

## v3 — Production *(theoretical capacity — shipped)*

Scope is the **theoretical** half: what the configured machines *can* produce. The
**actual** half — what they are really producing, and why a line is stalled — needs a
reconstructed factory graph (belts/splitters/pipes/power circuits) and is tracked
separately (see the actual-production graph issue).

### Data extracted
- **Production machines** — recipe-runners (Constructor → Manufacturer, Refinery,
  Blender, Particle Accelerator, …) read from `mCurrentRecipe`, `mCurrentPotential`
  (clock; absent ⇒ 100%), `mCurrentProductionBoost` (somersloop; absent ⇒ none), and
  location.
- **Resource extractors** — miners, oil + water extractors, fracking. Output resource
  and node purity are resolved by matching the extractor's location to the world
  resource-node dataset (the extractor snaps onto its node); water extractors draw
  from a volume, so they are special-cased to Water.
- **Rates** — `base` (recipe output at 100%) and `effective`
  (base × clock × somersloop boost, × node purity for extractors), aggregated per
  output item. Recipe rates and building power/extraction figures come from
  `@foreman/sf-game-data` (in-process — no MCP round-trip).

> **This is configured capacity, not measured output.** A static save has no runtime
> telemetry; it does not record live throughput, nor (here) whether a line is actually
> fed (belts/splitters/pipes) or powered. Estimated power is
> `powerConsumption × clock^1.321928 × boost²`.

### MCP tools
- `get_production(item?)` — theoretical output aggregated by item: total effective
  per-minute, machine count and a per-recipe/extractor breakdown, plus an estimated
  total power draw. With `item`, narrows to that item and additionally lists the
  individual machines (with locations).

---

## Save File Format

Satisfactory save files (`.sav`) are a **custom binary format** authored by Coffee
Stain Studios. Key characteristics (confirmed against real saves in v1):

- A header (save version, build version, session name, play time, etc.) followed by
  a body of **chunked, zlib-compressed** data.
- The decompressed body is a serialised object graph of actors and components
  (buildings, the player, inventories, the research/schematic manager, etc.), using
  Unreal Engine property serialisation.
- Object and class references use the same `…/Path.ClassName_C` convention handled
  by the game-data parser, so class-name normalisation can be shared.
- The format **changes between game versions** — any parser must be version-aware and
  degrade gracefully (warn-and-skip) on unknown structures, like the game-data parser.

### Parser

v1 **adopts** [`@etothepii/satisfactory-file-parser`](https://www.npmjs.com/package/@etothepii/satisfactory-file-parser)
(`^4.1.0`, MIT — actively maintained, supports save versions 1.0–1.2) to decode the
binary format, wrapped behind our own `normalise` layer (`src/parser/index.ts` is the
sole importer, so a future swap or in-house parser stays contained there). The format
was cross-checked against two other implementations —
[`SatisfactorySaveNet`](https://github.com/R3dByt3/SatisfactorySaveNet) (C#) and
[`GreyHak/sat_sav_parse`](https://github.com/GreyHak/sat_sav_parse) (Python) — which
agree on the structures we read.

**Why adopt** rather than hand-write (as the game-data parser is): the binary framing,
zlib chunk decompression, and Unreal property serialisation are substantial to build
and must track game-version changes, so a maintained library was the fastest path to a
working v1. The trade-off is an external dependency that becomes a liability the moment
it stops tracking game updates — hence the `normalise` wrapper and this trigger:
**re-evaluate building in-house if the library becomes unmaintained or blocks a
game-version update.**

---

## Testing

Mirror the game-data package: Vitest against **hand-crafted fixtures**, never a real
player save in the repo. Cover normalisation (class-name resolution, coordinate and
quantity decoding, standard-vs-alternate recipes, collectible classification), and
each tool's computed output against known values. Keep any real `.sav` used for local
testing out of version control (gitignored); `npm run inspect <save>` is the
regression check against real saves.
