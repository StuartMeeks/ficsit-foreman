# `sf-game-data-extractor` — single-producer game-data pipeline

**Status:** design agreed, not yet implemented.
**Supersedes:** the split pipeline (runtime `en-US.json` parse + offline `fg-extract`).

## Summary

Replace the two separate game-data pipelines with **one offline producer**, a C#
tool — `sf-game-data-extractor` — that reads a local Satisfactory install and
writes a single merged `sf-game-data.json` per channel. The raw `en-US.json` is
read from the install at extract time and is **never committed**. `meta.json` is
retired; its fields move into the output file.

This is the end state of a longer discussion. The original motivation was to stop
shipping raw game artefacts in the repo; the design grew from "parse uploads in
CI" into "one extractor produces everything offline".

## Goals

- **Ship no raw game artefacts.** The repo holds only the derived
  `sf-game-data.json` per channel — no `en-US.json`, no `meta.json`.
- **One producer, one artefact.** A single tool, a single output file, a single
  source of truth for both the docs-derived data (items/recipes/buildings) and the
  asset-extracted world data (collectibles, resource nodes).
- **No redundant runtime parse.** The `@foreman/sf-game-data` library loads
  pre-extracted JSON instead of parsing 11 MB of `en-US.json` on startup.
- **Maintainer-friendly.** Runs locally (over SSH on the Windows host where the
  game install lives), with an optional one-step "open the data PR" mode.

## Non-goals (explicitly closed)

- **No browser / web-page / hosted solution.** The Blazor + WASM + CUE4Parse
  in-browser spike (running the extractor client-side against local game files) is
  **closed as failed** — blocked on native Oodle decompression having no usable
  WASM build, plus Chromium-only file access and the WASM32 memory ceiling. Do not
  reopen without a working Oodle-in-WASM proof first.
- **No upload tool.** Superseded by the offline extractor.

## Current state (what this replaces)

| input | parser | output | when |
|---|---|---|---|
| `en-US.json` (docs file) | hand-written TS parser (`parseGameData`, `@foreman/sf-game-data`) | `GameData` (items/recipes/buildings) | **at runtime**, every startup |
| cooked assets (`.pak`/umaps) | `fg-extract` (C#, CUE4Parse + `FactoryGame.usmap`) | `sf-game-data.json` (collectibles, resource nodes) | offline |

Both `en-US.json` (~11 MB × 2 channels) and `sf-game-data.json` are committed,
alongside a `meta.json` that **duplicates** the `gameVersion`/`build` already
present in `sf-game-data.json`. CI's `check-game-data.mjs` enforces a three-file
bundle and a meta↔world lockstep — both become unnecessary here.

## Target design

### The tool

A new C# project, `sf-game-data-extractor`. It absorbs `fg-extract`'s extraction
logic (refactored into a reusable library rather than forked from `Program.cs`)
and adds the docs parse and the merge.

**Input:** a path to a Satisfactory install. Both sources live there —
`en-US.json` under `CommunityResources/Docs/` and the cooked assets +
`FactoryGame.usmap` under `CommunityResources/`. One input, one run.

**Steps:**
1. **Parse `en-US.json`** → items / recipes / buildings. *(parser choice below)*
2. **Extract assets** via CUE4Parse → collectibles, resource nodes (the existing
   `fg-extract` work, reused).
3. **Merge** both into a single `sf-game-data.json`, with version/build/channel at
   the top.

### Parser choice: port, with a golden-diff gate

The hand-written TS parser is **ported to C#** and becomes the only parser; the TS
parser is then retired (no dual maintenance, since `GameData`'s runtime parse is
being deprecated anyway).

**Hard prerequisite:** the existing TS parser + a real `en-US.json` is the *golden
oracle*. Run both, diff outputs to byte-identical (modulo key ordering), and do
**not** retire the TS parser until the C# port matches. The TS parser's existing
test suite is ported alongside, or kept running against shared fixtures.

> Alternative considered — *orchestrate, not port*: the C# tool shells out to the
> existing JS parser as a subprocess. Zero port risk, but keeps a Node dependency
> on the extraction host and a cross-language boundary. Rejected in favour of a
> clean single-language tool, **contingent on the golden-diff gate** holding.

### Output shape

A single file per channel, e.g.:

```json
{
  "gameVersion": "1.2.3.0",
  "build": 493833,
  "channel": "stable",
  "gameData": { "items": {}, "recipes": {}, "buildings": {} },
  "world":    { "collectibles": [], "resourceNodes": [] }
}
```

- `gameVersion` / `build` / `channel` replace `meta.json` entirely (today's
  `sf-game-data.json` already carries `gameVersion`/`build`; `meta.json` was a
  duplicate).
- `collectibles` / `resourceNodes` move under `world` (the loader changes anyway).
- `gameData` carries what the TS parser produced.

### Run modes

- **(a) Write only** — produce `sf-game-data.json` to a target folder (default: its
  place in the local repo checkout). The safe default.
- **(b) Write + open PR** — do (a), then open the data PR. Must follow repo
  conventions: Conventional Commit with body, `feature/`-style branch, **one
  channel per PR**, and the `🤖 AI-generated PR` line. Requires `gh` auth on the
  host.

### Channel handling

The tool produces `stable` or `experimental` depending on which install it is
pointed at; that determines the output file path and, in mode (b), which single
channel the PR touches.

## Consumer-side change (separate workstream)

Producing the file is only half the work. Today `@foreman/sf-game-data`
**live-parses `en-US.json`** at runtime. After this change it must **load the
pre-extracted merged file** instead:

- Collapse the two runtime loaders — `config.ts`/parser (docs) and
  `world/index.ts` (world dataset) — into a single merged-file read.
- `sf-mcp` and other consumers keep using item/recipe/world data as before; only
  the *source* changes from "parse on startup" to "load JSON". ("`GameData` is
  deprecated" = the runtime parse path is deprecated, **not** the data itself.)
- The TS parser is removed once the C# port passes the golden-diff gate.

## CI / repo changes

- **`check-game-data.mjs` simplifies** from a three-file bundle to **one file per
  channel**: no `en-US.json` (no longer committed), no `meta.json` (folded in).
  Keep the strictly-monotonic `build` check and the `KNOWN_COLLECTIBLE_TOTALS`
  oracle (re-pointed at `world.collectibles`); extend the oracle with sanity
  checks on the `gameData` section (non-empty items/recipes/buildings).
- **`.gitignore`** — `en-US.json` need no longer be tracked anywhere; the only
  committed game data is `sf-game-data.json` per channel.
- The "one channel per PR" rule and forward-only `build` rule are retained.

## Suggested sequencing

1. Refactor `fg-extract` extraction into a reusable library; stand up the
   `sf-game-data-extractor` skeleton that calls it and writes today's world-only
   `sf-game-data.json` (no behaviour change yet).
2. Port the TS parser to C#; add the golden-diff harness against a real
   `en-US.json`. Gate: byte-identical output.
3. Merge the parsed `gameData` into the output file (new shape); update the CI
   gate and the `KNOWN_COLLECTIBLE_TOTALS` paths.
4. Switch `@foreman/sf-game-data` to load the merged file; collapse the loaders.
5. Retire the TS parser and stop committing `en-US.json`.
6. Add run mode (b) — open-PR automation.

## Open questions

- Exact `gameData` sub-shape (mirror the current `GameData` type, or reshape while
  we have the chance?).
- Does the merged file stay one-per-channel under
  `packages/sf-game-data/data/<channel>/`, keeping the current layout minus the two
  dropped files?
- Where the C# tool lives (`packages/sf-game-data/extract/` alongside the reused
  extractor, vs. a top-level `tools/`).
