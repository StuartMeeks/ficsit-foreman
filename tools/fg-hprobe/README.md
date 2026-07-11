# fg-hprobe — offline base-map renderer (#246)

A single C# console tool that renders a first-party, top-down base map of the *Satisfactory*
world directly from the shipped game assets, via CUE4Parse. It decodes the landscape heightmap,
colours the terrain from the material weightmaps, rasterises the placed rock/cliff meshes, lays
the full water model, and classifies ocean/void from the FGWaterVolume geometry.

**The design, decode maths, water model, and every mechanism are documented in
[`docs/base-map-renderer.md`](../../docs/base-map-renderer.md).** This README is just how to
build and run it.

> Status: **in progress.** The approach is settled and the map renders correctly; packaging the
> output for the interactive map (#64) and the #239 coastline is still to do.

## Prerequisites

This tool only builds and runs on the **Windows host with a game install** (`ssh winbuild`) —
the VM has no game files (see the dev-environment note in the repo `CLAUDE.md`). It needs:

- **.NET 10 SDK.**
- **A CUE4Parse clone** at `packages/sf-game-data/extract/CUE4Parse/` — the same clone the
  game-data extractor uses (gitignored; clone it per
  [`packages/sf-game-data/extract/README.md`](../../packages/sf-game-data/extract/README.md)).
  `fg-hprobe.csproj` references it by relative path.
- **The Oodle native library** (`oo2core_*.dll` / `oodle-data-shared.dll`) next to the built
  exe, copied from the game install. Proprietary — never committed.
- A **Satisfactory install** (paks + `FactoryGame.usmap`), pointed to by `SF_PAKS` / `SF_USMAP`
  (defaults target a Steam install path).
- For the overlay: **Python 3 + Pillow**.

## Build & run

From `tools/fg-hprobe/` on the host (PowerShell):

```powershell
$env:DS = 2                    # full-res 3917x3409 (default 8 is a fast preview)
dotnet run -c Release          # writes map.ppm
```

Set any of the environment variables documented in
[`docs/base-map-renderer.md`](../../docs/base-map-renderer.md) (`ROCKEXCLUDEAT`, `OCEANZ`,
`BLUEBOX`, `VISHOLE`, the water tunables, …) to control the render, or a `MODE=…` / `PROBEXY` /
`ROCKAT` / `VA` probe to diagnose a cell instead of rendering.

## Overlay & review

`overlay.py` annotates a render with the coordinate grid (40×34, cols A–AN, rows 1–34) and biome
outlines, and refreshes the review image:

```bash
python overlay.py map.ppm -1755      # writes map_labeled.png (+ an embed for the artifact)
```

It expects `biomes_final.json` (the biome polygons, from the #239 dataset) beside it. The grid
labels are how map regions are called out during review (e.g. "AN9", "K33").

## Files

| File | What |
|---|---|
| `Program.cs` | the renderer + all diagnostic `MODE`s / probes |
| `fg-hprobe.csproj` | .NET 10 project; references the CUE4Parse clone |
| `overlay.py` | grid + biome overlay for review renders |

Build output (`bin/`, `obj/`), the Oodle DLL, renders (`*.ppm`/`*.png`), probe dumps, and any
community-derived masks are gitignored — regenerate them locally.
