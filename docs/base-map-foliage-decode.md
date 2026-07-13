# FGFoliage decode — rendering the missing world foliage (#246 slice: "other trees")

> **Status:** spec / agreed design, pre-implementation.
> **Parent:** [#246 base-map renderer](./base-map-renderer.md) — this is the "other tree species"
> follow-up called out in §6 (Flora). **Host-build only** (CUE4Parse + a game install; see the
> renderer doc for the winbuild workflow).

## 1. Problem

The renderer's flora pass (§6 of [base-map-renderer.md](./base-map-renderer.md)) only sees foliage
placed as stock `FoliageInstancedStaticMeshComponent` (~19 k instances) plus individual
`StaticMeshComponent`s. It renders coral and Titan-Forest trees from that set.

But the **bulk of Satisfactory's world foliage — ~71 k components holding ~3.3 M instances —
lives in a custom component, `FGFoliageInstancedSMC`**, which the collector never reads. Ferns,
grass, bushes, coral, dead trunks and most tree species (DypsisPalm, DesertBush, …) are all in
this set. They are entirely invisible on the map today. This is the root cause of "missing trees".

Confirmed empirically: a coordinate the player reported as having a tree within 2–3 m
(`109300, −129300`) had **zero** readable foliage within 400 m before the fix; after the fix it
resolves ground-cover at 0.8 m and `SM_Fern_01` at 3.0 m, plus dense surrounding foliage.

## 2. Root cause & decode (the hard-won part)

`FGFoliageInstancedSMC` is a `UHierarchicalInstancedStaticMeshComponent` subclass (its tagged
properties — `NumBuiltInstances`, `SortedInstances`, `InstanceReorderTable`, `ClusterTree` — are the
HISM set), but **CUE4Parse does not know that**, so it builds a generic `UObject` and never
deserialises the instance transform buffer. Two things are needed to read it correctly:

### 2a. Register the class

```csharp
// GameAssetProvider ctor, before Initialize()
ObjectTypeRegistry.RegisterClass("FGFoliageInstancedSMC",
    typeof(UHierarchicalInstancedStaticMeshComponent));
```

`ObjectTypeRegistry` is in namespace `CUE4Parse.UE4.Assets` (not `.Exports`). With this, CUE4Parse
runs the ISM/HISM `Deserialize` path and `PerInstanceSMData` is populated. `export is
UInstancedStaticMeshComponent` then also returns true (HISM ⊂ ISM), so the collector's existing
instanced branch catches it.

### 2b. The world-position formula is *different* from stock foliage

This is the trap. For **stock** `FoliageInstancedStaticMeshComponent`, world pos =
`TranslatedInstanceSpaceOrigin + instance.Translation` (see §6). For **`FGFoliageInstancedSMC`
that formula is wrong** and produces a collapsed, doubled mess. The correct decode:

- `TranslatedInstanceSpaceOrigin` is **a red herring** — it equals `instance[0].Translation`, a
  small local value (±~30 m), *not* a cell offset. Adding it double-counts.
- Per-instance `.Translation` values are **local to the owning cell** (±~30 m spread within a
  component — a realistic bush/tree cluster).
- The **km-scale cell offset lives on the owning actor.** Each `FGFoliageInstancedSMC` is owned by
  an `InstancedFoliageActor_<...>` whose `RootComponent0` (a `SceneComponent`, reached via the
  component's `AttachParent`) carries the cell world position in its `RelativeLocation`
  (e.g. `(−252800, −67200, 3200)`).

**Correct world position:**

```
world = AttachParent(RootComponent).RelativeLocation  +  instance.Translation
```

Rotation = `instance.Rotation.Rotator()`, scale = `instance.Scale3D` (both read correctly).

Evidence trail (probe `treeat`): with this formula, foliage spreads correctly across the whole
map, instance[0]==origin per component, scales are sane (0.3–2.9), and the reported coordinate
resolves the expected dense foliage patch. CUE4Parse version is irrelevant — no upstream commit
adds Satisfactory foliage support (a `UInstancedStaticMeshComponent` fix at `fbae35b5` is
Lord-of-Mysteries-specific); this decode must live in our code.

## 3. Rendering plan — trees & large foliage only

Rendering all 3.3 M instances is heavy and would visually swamp the terrain with grass. **Scope:
draw only trees and large foliage** (the visually meaningful canopy); drop grass / ground-cover /
small plants. Delivery = "more trees".

- **Integration point:** `SceneCollector.TryAddMesh`. The existing instanced branch already loops
  `PerInstanceSMData` and emits `PlacedMesh` with `kind` (coral/tree). Extend it to:
  1. Recognise `FGFoliageInstancedSMC` (post-registration it is a `UInstancedStaticMeshComponent`,
     so `export is UInstancedStaticMeshComponent` already fires — but its position formula differs).
  2. Compute the cell offset from `AttachParent.RelativeLocation` **when the export type is
     `FGFoliageInstancedSMC`**, and use `cellOffset + translation` instead of
     `TranslatedInstanceSpaceOrigin + translation`. Keep the stock formula for stock foliage.
- **Classification / include-filter:** reuse the `--flora` include-filter mechanism. Add the tree
  and large-foliage paths under `/Environment/Foliage/Trees/*` (DypsisPalm, Kapok, DioTree,
  GreenTree, BluePalm, Bamboo, …) and large `/Bush/*` / large `/Coral/*` that appear in FGFoliage.
  Everything under `/Foliage/Grass/`, `/Foliage/SmallFoliage/`, `DeadVegetation` ground-cover is
  **excluded** by default. Filtering happens *before* rasterising, so the 3.3 M never all raster.
- **Rasterisation:** unchanged — flora tops z-buffered into the height grid, `kind` tree=2 /
  coral=1, `FLORAH` low cut, trunk/foliage split, trunk cross-section fill (§6). New tree species
  get the same treatment; `--tree-part` still applies.
- **Colours:** placeholder tree foliage/trunk colours for now (per-mesh textures are a later step,
  as with existing flora).

## 4. Slices

1. **Decode + probe (this investigation, mostly done).** `ObjectTypeRegistry` registration in
   `GameAssetProvider`; `treeat` probe proving the formula. Land the registration + a tidied probe.
2. **Collector read.** `SceneCollector.TryAddMesh` reads `FGFoliageInstancedSMC` with the
   cell-offset formula; include-filter defaults to trees + large only. Instance count logged; log
   what was dropped (no silent truncation).
3. **Render + tune.** Render, eyeball via the map-editor artifact, tune the include-filter and any
   density/perf cap. Update [base-map-renderer.md](./base-map-renderer.md) §6 to document the
   FGFoliage formula alongside the stock one.

## 5. Risks / open questions

- **Performance:** even trees-only may be a large instance count. If raster time balloons, add a
  per-species density cap or a min-scale cut; `log()` whatever is dropped.
- **Double-render:** confirm species aren't present in *both* stock foliage and FGFoliage (would
  double-plant). Likely disjoint (stock = coral + TitanTree; FGFoliage = everything else) but
  verify during slice 2.
- **What counts as "large".** The trees-vs-grass line is a filter tuning question settled visually
  in slice 3, not a hard spec.
