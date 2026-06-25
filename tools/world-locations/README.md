# World-location extractor (`fg-extract`)

The one-off tool that generates
[`packages/game-data-core/data/<channel>/world-locations.json`](../../packages/game-data-core/data/stable/world-locations.json)
— the static dataset of every fixed collectible and resource node in the
Satisfactory world (coordinates, resource type, purity).

It reads coordinates straight out of the **packaged game level files** with
[CUE4Parse](https://github.com/FabianFG/CUE4Parse), using the `FactoryGame.usmap`
mappings Coffee Stain ships in the game's `CommunityResources/`. Only factual
coordinates are written out — no game assets are redistributed.

> **This is a host-only, run-by-hand tool.** It is C#, needs a local Satisfactory
> install, and a C++ toolchain to build CUE4Parse's native library. It is
> deliberately **not** part of the npm workspaces, the TypeScript build, lint, or
> CI — it only runs when the game updates and the dataset needs regenerating.

## Why CUE4Parse isn't vendored

CUE4Parse is ~36 MB / 4,000+ files with its own native git submodule and licence.
We changed exactly **one thing** in it, captured in
[`cue4parse-optional-property.patch`](./cue4parse-optional-property.patch). So we
keep CUE4Parse external (clone + patch) and vendor only our extractor + the patch.

### The patch, in one sentence

Coffee Stain's shipped `FactoryGame.usmap` serialises `OptionalProperty` **without**
an inner-type byte. CUE4Parse's `UsmapProperties.ParsePropertyType` assumes one and
reads it, which misaligns and derails the parse of every property after the first
`OptionalProperty` (~byte 1.27 M of the decompressed mappings). The patch makes
`OptionalProperty` a terminal type — no inner read. (Array/Set/Map/Enum genuinely
do carry inner types and are left untouched.) Verified by hex-dumping the
decompressed mappings: with the fix, the bytes decode as a clean run of
`OptionalProperty` properties followed by a well-formed struct header.

This is a **local workaround for this specific usmap**, not a proven general fix —
see "Upstreaming" below.

## Prerequisites (Windows host with the game installed)

- **Satisfactory** installed (the dataset is read from its `Paks` + the shipped
  `CommunityResources/FactoryGame.usmap`).
- **.NET 10 SDK**.
- **Visual Studio** with the **"Desktop development with C++"** workload — CUE4Parse
  builds its native `CUE4Parse-Natives` library via CMake/MSVC at build time.
- Oodle: downloaded automatically at runtime by `OodleHelper.DownloadOodleDll()`.

## Regenerating the dataset

1. **Clone CUE4Parse** as a sibling of `fg-extract`, at the pinned commit, with
   submodules:

   ```powershell
   cd tools/world-locations
   git clone --recursive https://github.com/FabianFG/CUE4Parse.git
   cd CUE4Parse
   git checkout 024b005c4d15e8082ecebfb202700d59bb6113c0
   git submodule update --init --recursive
   ```

   (`fg-extract.csproj` references `..\CUE4Parse\CUE4Parse\CUE4Parse.csproj`.)

2. **Apply the patch** from the CUE4Parse repo root:

   ```powershell
   git apply ..\cue4parse-optional-property.patch
   ```

   If a newer CUE4Parse has drifted and the patch won't apply, make the change by
   hand — it's the one edit described under "The patch" above.

3. **Build & run** from a Visual Studio Developer PowerShell (so MSVC/CMake are on
   PATH for the native build). The game engine is **UE 5.6** (`EGame.GAME_UE5_6` in
   `Program.cs`) — bump this if a future Satisfactory moves to a new engine version.

   ```powershell
   # Stamp the build you are extracting (must match the channel's meta.json):
   $env:GAME_VERSION = "1.2.3.1"
   $env:BUILD        = "495413"
   # Optional overrides (defaults point at a default Steam install):
   #   $env:SF_PAKS  = "D:\...\Satisfactory\FactoryGame\Content\Paks"
   #   $env:SF_USMAP = "D:\...\Satisfactory\CommunityResources\FactoryGame.usmap"
   #   $env:OUT      = "world-locations.json"
   cd tools/world-locations/fg-extract
   dotnet run -c Release
   ```

   `GAME_VERSION`/`BUILD` are stamped into the dataset header (defaulting to the
   build it was first extracted from) — **set them**, never hand-edit the resulting
   file's version. Output is deterministically ordered (counts alphabetical;
   `collectibles`/`resourceNodes` by `kind` then `id`) so a regenerated dataset
   diffs only on genuine world changes.

   It prints per-kind counts and writes `world-locations.json`. **Sanity check**: the
   collectible counts must read mercerSphere 298, somersloop 106, powerSlugBlue 596,
   powerSlugYellow 389, powerSlugPurple 257, hardDrive 118 — if any differs, the
   extraction is incomplete or the game changed.

4. **Install** the result into the channel you're updating, then commit it (the
   value of `gameVersion` must match that channel's `meta.json`):

   ```
   cp world-locations.json ../../../packages/game-data-core/data/stable/world-locations.json
   ```

   `.github/scripts/check-game-data.mjs` re-validates counts and version on the PR.

## How the world is laid out (notes for future spelunking)

- **Collectibles** (`BP_WAT2_C` = Mercer Sphere, `BP_WAT1_C` = Somersloop,
  `BP_Crystal_C/_mk2_C/_mk3_C` = blue/yellow/purple slug, `BP_DropPod_C` = hard-drive
  pod) live in the World-Partition cells under
  `.../GameLevel01/Persistent_Level/_Generated_/*.umap`. Drop pods are split between
  the cells and the persistent level, so both are scanned and unioned by id.
- **Resource nodes** (`BP_ResourceNode_C`, `BP_FrackingSatellite_C`,
  `BP_FrackingCore_C`, `BP_ResourceNodeGeyser_C`) live in the base
  `Persistent_Level.umap`. The cells only hold the merged HLOD meshes
  (`NodeMeshActor_C`), whose `mNodeActor` points back to the real actor.
- Location = `RootComponent.RelativeLocation` (Unreal units / cm). Resource =
  `mResourceClass` → trailing `Desc_*_C`. Purity = `mPurity` (`RP_Inpure`/`RP_Pure`;
  **absent means Normal** — the unversioned default is omitted; the game misspells
  impure as "Inpure").

## Upstreaming the fix

Worth considering, but **not a blind PR**: our patch removes the inner-type read for
`OptionalProperty` entirely, which would regress any usmap that *does* encode one.
The right contribution is the **diagnosis** — open a CUE4Parse issue with the hex
evidence and ask whether `OptionalProperty` should carry an inner type at all (and if
so, why CSS's usmap omits it / whether it's usmap-version-gated). A safe PR can follow
once the maintainers confirm the correct, general behaviour.
