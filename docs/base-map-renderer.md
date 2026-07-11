# Base-map renderer (#246)

> Status: **in progress — approach settled, not yet a committed tool.** A first-party,
> top-down base map of the *Satisfactory* world is rendering correctly end-to-end (landscape
> relief, terrain colour, rock formations, the full water model, and a geometrically-derived
> ocean/void boundary). It is produced **offline** by a spike tool (`fg-hprobe`) that runs on
> the Windows host against a real game install via CUE4Parse. The remaining work is packaging
> it as a committed repo tool and wiring its output into the interactive map (#64) and the
> #239 coastline. This document records the approach, the decode maths, every mechanism, and
> the diagnostic/override surface so the work can resume cold.

## Why this exists

The interactive map (#64) and the biome/coastline work (#239) need a base raster of the world:
a land/water/void mask plus relief and terrain colour. The obvious source — community maps
(SCIM and the "topological map") — is **licensing-encumbered** and is the very thing #246
exists to avoid. So we derive everything from the shipped game assets ourselves: the cooked
landscape, the placed rock meshes, and the water-volume geometry. The pipeline is
**deterministic and topo-free** — no community asset is baked into the output. (A community
topo map was used *briefly* as a build-time oracle while classifying rock; it has since been
fully removed in favour of pure game geometry — see *Off-map cliff exclusion*.)

## Pipeline overview

All stages run offline against a game install. Output is a single top-down raster (PPM),
optionally annotated with a coordinate/biome overlay for review.

1. **Decode the landscape heightmap** → a height grid in a world-cm frame.
2. **Colour the terrain** from the landscape material weightmaps.
3. **Raise "higher ground"** — rasterise placed rock/cliff meshes' tops into the height grid.
4. **Null visibility holes** — cells masked by the landscape visibility layer become void.
5. **Lay the water** — FGWaterVolume footprints (ocean + lakes) + BP_River ribbons +
   BP_Water ponds + a wet-sand-seeded shallow shelf.
6. **Classify ocean vs void** — a void cell is ocean iff it sits inside an ocean
   FGWaterVolume footprint (`volVoid`); everything else off-map is grey void.
7. **Exclude off-map junk** — a small, explicit list of enormous cliff meshes placed beyond
   the playable edge, removed by mesh-name + origin.
8. **Render** — hillshade the land, depth-shade the water, paint void, and blit rock on top.

## 1. Landscape decode (the crux)

The world's ground surface is a UE5.6 `Landscape`: **2289 `LandscapeComponent`s** across
**~125–149 `LandscapeStreamingProxy`** cells (plus a parent `Landscape` actor). Each component
is a **128×128** vertex tile (`ComponentSizeQuads = 127`, `NumSubsections = 1`) placed by its
`SectionBaseX/Y`. Stitching = lay each 128×128 tile on the section grid.

- Height data lives in `LandscapeComponent.HeightmapTexture` — a `PF_B8G8R8A8` `UTexture2D`,
  128×128, 65 536 bytes. `GetFirstMip()` resolves real bytes because CUE4Parse ships
  `ULandscapeTextureStorageProviderFactory`, which handles UE5.6's compressed landscape-texture
  storage. Height is encoded across two channels: `h16 = (R << 8) | G` (byte order for
  PF_B8G8R8A8 is `{B,G,R,A}` = indices `{0,1,2,3}`; the decode reads `hd[p+2] << 8 | hd[p+1]`).
- **Height in cm:** `Z = ACTOR_Z + (h16 − ZMID) · ZSCALE · SCALE` with `ACTOR_Z = 100`,
  `ZMID = 32768`, `ZSCALE = 1/128`, `SCALE = 100`. (An earlier `ZADJ` "+51" correction was a
  **mis-diagnosis** and is reverted to 0 — see *Water model → ocean unify*. All 125 proxies have
  a uniform `rootLoc.Z = 100`, `scale.Z = 100`, so there is no per-proxy Z variation.)
- **Collision heights are stripped** from the cooked build
  (`LandscapeHeightfieldCollisionComponent.CollisionHeightData` is absent) — the texture is the
  only source, hence the decode above is load-bearing.

## 2. World alignment (coordinate frames)

The landscape sits in the same world-cm frame as collectibles and biomes (#239), so alignment
is essentially free once the transform is right.

- **Proxy → world:** `worldX = ACTOR_X + SectionBaseX · SCALE`, `worldY = ACTOR_Y + SectionBaseY · SCALE`,
  with `ACTOR_X = ACTOR_Y = −50800`, `SCALE = 100` (1 quad = 1 m). Each proxy's root location =
  origin + its min `SectionBase` × 100. **The parent `Landscape` actor location
  `(−304800, 203200)` is a red herring — do not use it.**
- **Grid:** section X spans roughly `[−2540, 4445]`, Y `[−2540, 3429]`. A **`PADQ = 360`**-quad
  margin is added per side (`minSX = minSY = comps.Min − 360 = −2900`) so the map has an ocean
  frame and nothing clips. The output grid is downsampled by **`DS`** (default 8; standard
  render uses **`DS = 2`** → **3917 × 3409**).
- **Cell ↔ world (at DS = 2):** `worldX = −340800 + gx · 200`, `worldY = −340800 + gy · 200`
  (gx, gy are output-grid pixels). General form:
  `worldX = ACTOR_X + (minSX + gx · ds) · SCALE`.

## 3. Terrain colour (material weightmaps)

Each `LandscapeComponent` carries `WeightmapTextures` + `WeightmapLayerAllocations` (layer name
→ weightmap texture index + channel; channel byte order for PF_B8G8R8A8 maps `{R,G,B,A}` →
`{2,1,0,3}`). Per pixel we **weight-blend** the layers' palette colours (Sand/Dune → tan,
Grass → green, Forest/Jungle → dark green, Rock/Gravel → grey, Soil → brown) and multiply by a
NW hillshade. Weight-*blend* rather than dominant-pick avoids speckle. The result matches the
real map (sand dunes in Dune Desert, etc.). Weightmap failure loses colour only, never height.

## 4. Landscape visibility holes → void

Cells painted with **`LandscapeVisibilityLayerInfo`** are masked out in-game — invisible
landscape, i.e. holes down to the caves. Their heightmap still carries (deep) data, so without
handling they render as deep terrain. In pass B, any cell with
`LandscapeVisibilityLayerInfo` weight ≥ **`VISTHRESH`** (128) has its height **nulled to 0**,
turning it into void. This cleaned up **~113 k cells** map-wide (e.g. the AB24 pit, −253 m,
ringed by +100 m terrain). Toggle with `VISHOLE=0`.

## 5. Higher ground (rock meshes)

The landscape heightmap is the ground surface only; mesas, spires, cliffs and canyons are
separate placed `StaticMeshComponent`s. We rasterise their tops into the height grid.

- **Include filter:** mesh path contains **`/Environment/Rock/`** (subfolders Cliff, DesertRock,
  Boulder, Rubble, Arc, SmoothRock, DestructibleRock). Explicitly *excluded*: foliage
  (trees/coral/grass), DropPod, resource/fracking nodes, waterfalls, hot springs, caves,
  spaceship debris.
- Each instance is an individual (non-instanced) component with **absolute** `RelativeLocation`
  (world-cm) + `RelativeRotation` (FRotator) + `RelativeScale3D`. Mesh via
  `pi.ResolvedObject.Load()` → `UStaticMesh.RenderData.LODs[0]` (LOD0 = full detail, for smooth
  cliffs) `PositionVertexBuffer.Verts` + `IndexBuffer`. Each triangle is transformed
  (scale → UE `FRotationMatrix` → translate) and **z-buffered** into the grid via barycentric
  max-Z. Guards skip runaway triangles (grid-bbox span > 150 cells, or thin slivers). ~20.8 k
  instances, ~114 unique meshes.
- A cell is coloured rock-grey only where a formation rises **> ~3 m** above the landscape
  baseline (so scattered boulders add relief without greying everything).
- **Rocks draw *on top of* water.** Water is classified on `baseH` (a clone of the height grid
  taken *before* the rock pass = the seabed), so submerged spires don't punch holes in the
  water or block the shelf spread; in the render, `isRock` cells draw grey over the water
  (`if (isOcean && !isRock)` for the water branch). This is the Spire Coast archipelago.

## 6. Water model

The full water stack, in order (all off `baseH` = seabed, pre-rock):

- **FGWaterVolume BSP faces (ocean + lakes).** Each `FGWaterVolume` root is a `BrushComponent`
  whose `Brush` is a `UModel`; `.Points` (verts), `.Nodes` (convex BSP faces), `.Verts`
  (`pVertex` → Points index) are populated in the cooked build. Each face's verts transform by
  the component (loc + yaw + scale) → a world-XY polygon with `surfZ = maxZ`. Rasterise every
  face (bbox + point-in-poly); the union of a volume's convex faces = its exact concave
  footprint. A cell is water where the **seabed** (`baseH`) is at/below `surfZ`. 269 volumes →
  5342 faces. Captures ocean, lakes, and high-altitude crater/plateau lakes at true heights;
  below-sea *dry* land (held by a coastline) is never flooded because no volume sits over it.
- **Ocean unify.** The game ships the sea as ~32 deep FGWaterVolumes with `surfZ` staggered
  **−1635 … −1815** (invisible physics volumes; the *visible* water is one uniform mesh). Every
  sea-band volume (`surfZ` in −1850 … −1600, `oceanBand`) is snapped to a single
  **`OCEANZ = −1755`** so the shoreline has no authoring-noise steps. Lakes (`surfZ > −1600`) are
  untouched. −1755 is the game's modal ocean value; it was calibrated against Stu's in-game
  waterline measurements (gentle Spire Coast slopes are sensitive to the level; steep west coast
  barely moves).
- **BP_River ribbons.** Rivers are `BP_River_PROT_C` actors whose `RootComponent` is a
  `SplineComponent` carrying the world transform; `mSplineMeshComponents` each deform
  `SM_RiverPlane` along a segment with a `SplineParams` struct (Start/End Pos + Tangent in the
  local frame, Start/End Scale where `.X` = cross-stream width). We cubic-Hermite-sample each
  segment's centreline, transform to world, and stamp a disc ribbon of half-width
  `RIVERW (200) × scaleX` wherever terrain ≤ `surfZ + RIVERTOL (400)`. Toggle `RIVERS=0`.
- **BP_Water ponds.** Small shallow bodies with a visual `WaterSurface` plane but no
  FGWaterVolume — a footprint fill clipped to terrain ≤ surface, only where not already ocean.
- **Wet-sand shallow shelf.** The landscape mesh continues underwater past the shoreline, so
  meshed below-sea terrain reads as land up to the mesh edge. The game's own submerged signal is
  the **`WetSand`/`Puddles`** material. Seed = shallow WetSand/Puddles cells, then **BFS-spread
  through connected shallow below-sea terrain** (any material) within a depth cap. Coral/sand
  shelf fills only where a wet seed reaches it, so isolated inland coral and deep crater walls
  stay dry. Tunables: `WETSEA` (−1755), `WETRISE` (0), `WETDEEP` (500 cm cap), `WETTHRESH` (50).
  `WETWATER=0` disables; `SHELF=1` enables the (default-off) broad connectivity flood, for
  diagnostics only.

### Ocean vs void — the classifier that matters

Past the coast, "ocean-blue" vs "grey void" is **not** derivable from distance or from the
landscape mesh edge (the game authors no crisp boundary out there — the visible distant ocean
is just two enormous `SM_GEN_WaterPlane` meshes parked over the S/SE, plus skybox). An earlier
heuristic — `seaVoid`, blue for border-connected void within R=300 cells of a real ocean cell —
both over-reached and under-reached and was abandoned.

**The correct signal is FGWaterVolume membership.** A void cell (no seabed, `baseH == 0`) is
ocean **iff it falls inside an ocean-band FGWaterVolume footprint**. Implemented as the
**`volVoid`** mask: during the volume rasterise, void cells inside an ocean-band volume are
flagged (instead of skipped); the render paints `volVoid` blue and all other off-map void grey.
This is deterministic, topo-free game geometry, verified against ground-truth cells (cells
inside `FGWaterVolume107/32` render blue; cells inside no volume render grey). It also fixed the
long-standing north-edge-above-Spire-Coast blue bleed for free.

- **`BLUEBOX` override.** The far-west frame **margin** (grid cols A–B + C33/C34) is west ocean
  that the FGWaterVolume footprints don't quite reach. A small list of world-XY rectangles forces
  those void cells blue — the one honest exception layered on top of the geometric classifier
  (default covers ~599 k cells in the west margin).

## 7. Off-map cliff exclusion

Beyond the playable landscape edge the game places enormous decorative cliff meshes (the
"Abyss Cliffs" formations, north/east/SE cliff walls). Top-down they read as junk landmasses
floating in the void/ocean. **Every general rule to remove them failed**, because each fails on
a real case:

- *waterline* (keep only above-sea rock): real below-sea land south of Grass Fields breaks it;
- *outerVoid / fringe / connectivity*: either clip the coast or keep the Abyss masses;
- *kill-boxes* (drop rock in a world-XY region): too blunt, and by-origin they miss because a
  mega-cliff's **origin sits a grid-column away from its footprint**.

**Settled approach: exclude specific mesh *instances* individually.** Each off-map landmass is
only a handful of mega-meshes. The enabling tool is the **`ROCKAT`** footprint probe: point it
at a rendered cell and it reports exactly which instances rasterise there (mesh @ origin, z,
scale). Add those to **`ROCKEXCLUDEAT`** (`"MeshName@x,y;…"`, matched within ±100 m of the
origin), which drops just that placement — other placements of the same mesh are untouched
(critical: `CliffFormation_05` alone has 544 placements). The current default list holds ~15
instances (CliffFormation_05, CliffPillar_01, CaveSplitter_01) covering the east column, SE
corner, bottom strip, and north edge. `ROCKCLIPMODE` defaults to `none` (render all rock; junk
removed only per-instance); the older mask-based modes (`land`/`void`/`basezero`/`outervoid`/
`fringe`/`surface`/`island`) remain selectable for experiments but are not used.

## The offline tool (`fg-hprobe`)

A single C# console program (CUE4Parse + `EGame.GAME_UE5_6`). It is **not yet committed to the
repo** — it lives in the session scratchpad and is deployed to the Windows host
(`ssh winbuild`, `D:\Code\StuartMeeks\ficsit-foreman\tools\fg-hprobe`) which has a game install.
The VM cannot run it (no game files; see the dev-environment note in `CLAUDE.md`). Packaging it
as a committed tool (likely alongside the #164 `sf-game-data-extractor`) is the main open task.

- **Inputs:** `SF_PAKS` (paks dir), `SF_USMAP` (mappings). Run: `dotnet run -c Release` with env
  vars set (PowerShell: `$env:DS=2; dotnet run -c Release`).
- **Output:** `map.ppm` at the chosen `DS`. A companion Python script, `overlay.py`, draws the
  review overlay: a **40 × 34** coordinate grid (cols A–Z then AA–AN, rows 1–34; single label per
  cell, no sub-squares — half the earlier cell size for precise call-outs) plus biome outlines,
  and updates the hosted artifact.

### Environment-variable reference

| Var | Default | Purpose |
|---|---|---|
| `SF_PAKS`, `SF_USMAP` | game install paths | CUE4Parse inputs |
| `DS` | 8 | output downsample (use **2** for full-res 3917×3409) |
| `ZADJ` | 0 | landscape Z offset (leave 0 — the "+51" was a mis-diagnosis) |
| `ROCKS` | on | rasterise `/Environment/Rock/` meshes |
| `ROCKEXCLUDEAT` | ~15 instances | per-instance exclusion list `"Mesh@x,y;…"` |
| `ROCKCLIPMODE` | `none` | rock clip mode (none = render all; masks are legacy) |
| `OCEANZ` | −1755 | unified sea level for ocean-band volumes |
| `BLUEBOX` | west margin | force void cells ocean-blue in world-XY rectangles |
| `VISHOLE` / `VISTHRESH` | on / 128 | null landscape-visibility holes to void |
| `RIVERS` / `RIVERW` / `RIVERTOL` | on / 200 / 400 | BP_River ribbon stamping |
| `WETWATER` / `WETSEA` / `WETRISE` / `WETDEEP` / `WETTHRESH` | on / −1755 / 0 / 500 / 50 | wet-sand shallow shelf |
| `SHELF` / `SHELFZ` | off / −1699 | broad connectivity flood (diagnostics only) |

### Diagnostic probes (`MODE=…` and probe vars)

These early-return with a report instead of rendering (unless noted):

- **`PROBEXY="x,y;…"`** — per world-coord: rockTopZ, seabedZ, isRock, isOcean, isLake,
  waterZ(surf), oceanVoid, volVoid, and a `render=` prediction (OCEAN / land-rock /
  OCEAN(void) / VOID(grey)). The first-reach diagnostic for land/water/void disputes.
- **`ROCKAT="x,y,label;…"`** — during the rock pass, reports which instances rasterise onto each
  target cell (mesh @ origin, z, scale). Traces a rendered landmass to the exact meshes to
  exclude. (Runs as part of a normal render.)
- **`MODE=volat` + `VA="x,y;…"`** — which FGWaterVolume covers each coord + its authored surfZ.
  The tool that proved the ocean/void classifier.
- **`MODE=objectsat` + `OA`/`OAR`/`OAMESH`/`OALIST`** — placed actors near a coord (histogram, or
  per-instance list with `OALIST=1`).
- **`LAYERAT="x,y;…"`** — per-cell weightmap dump (which material layers + weights). Confirmed the
  visibility-hole holes.
- Others: `MODE=meshes` (mesh-path histogram), `oceandump`/`voldist`/`voldump` (water-volume
  surveys), `oceanmesh` (SM_GEN_WaterPlane footprints), `proxy` (proxy Z/scale histogram),
  `riverdump`, `pickupdump`, `nearwater`, `sealevel`, `ztest`.

## Open items / next steps

- **Package as a committed repo tool** (the main task): move `fg-hprobe` into the repo (likely
  as part of / beside the #164 `sf-game-data-extractor` producer), decide the output format
  (raw 16-bit height + bounds sidecar, and/or finished rasters + a land/water/void mask), and
  wire it into the #64 interactive map and the #239 coastline. Write British-English, follow the
  standard commit/PR conventions.
- **AA30** — a "missing land" cell Stu is aware of (root cause known to him); parked, not yet
  addressed.
- Any remaining off-map landmasses are handled the same way: name the cells → `ROCKAT` →
  add to `ROCKEXCLUDEAT`.
- Consider whether the `seaVoid`/`SHELF` legacy code and unused `ROCKCLIPMODE` masks should be
  pruned before the tool is committed.

## Related

- Decode/alignment share the world-cm frame with the **biome overlay (#239)** and collectibles.
- The offline-extractor host mechanics mirror the **single-producer pipeline
  (`sf-game-data-extractor`, #164)** — same `ssh winbuild` CUE4Parse setup.
