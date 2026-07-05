# Explore orders (#207) + collectible re-upload reconciliation (#209-B)

> **Status:** Agreed design — the design of record for #207 and #209-B. Landed before code
> per the spec-doc-per-feature convention. Where this conflicts with older notes, this wins.

## Problem

A work order is a **build contract** (steps → buildables → cost). Directing *exploration* —
"go grab those 8 power slugs / sweep the northern forest for hard drives" — is a fundamentally
different shape: a **collection route** of waypoints, each with collectibles to pick up, no
build cost, done when the chosen collectibles are collected. Forcing that into `buildSteps` is a
poor fit, so #207 introduces a second order type, the **explore order**.

#209-B then closes the loop: when the pioneer **re-uploads a save**, an active explore order's
collectibles are **auto-reconciled** to what the save shows collected — progress tracks the game
without manual ticking. (#209-A, the same for *buildables*, is **cancelled**: matching an
abstract buildable line to concrete save instances is heuristic; collectibles are identity-keyed,
so their match is exact — the deterministic case is the one worth automating.)

## Decisions

| Question | Decision | Why |
|---|---|---|
| Entity model | **Variant of `WorkOrder`** (`orderType` discriminator + `waypoints`), not a separate entity | Reuses the state machine, revisions, audit, sequence counter, single-active invariant, and — critically — **cross-type parent/child auto-unblock** (a build order can be `blocked` on an explore child). A separate table breaks auto-unblock + single-active and duplicates the lifecycle machinery. |
| Numbering | **Shared per-playthrough counter, `EO-NNN` display label** by type | One monotonic counter (one table); the pioneer still tells a route from a build at a glance. |
| Reconciliation | **Auto-apply + `System` audit + "Save synced" banner**, monotonic | Collectible matching is exact (guid/schematic identity) and one-way (un-collected→collected), so there's no false-positive risk that would justify a confirm step. |
| Mark-collected | **REST execution mutation** (mirrors `setBuildableBuiltCount`), not a chat tool | Execution truth is Pioneer/REST-owned today; the foreman proposes, the pioneer records. |

## Model

`WorkOrder` gains a discriminator and an explore-only field; all existing fields stay (explore
orders simply leave `buildSteps`/`recipes`/`expectedOutputs` empty).

```ts
orderType: 'build' | 'explore';   // discriminator, defaults to 'build'
waypoints?: ExploreWaypoint[];    // explore only (JSON column)

type ExploreWaypoint = {
  id: string;
  order: number;                  // suggested visit order along the route
  label?: string;
  coordinates: Coordinates;       // Unreal units (cm)
  relativeToPlayer?: string;
  collectibles: ExploreCollectible[];
  notes?: string;
};

type ExploreCollectible = {
  id: string;
  kind: CollectibleKind;          // mercerSphere | somersloop | powerSlug* | hardDrive | helmet | mtape
  guid?: string;                  // GUID-keyed kinds — the identity the save records on collection
  schematic?: string;             // customizer helmet/mtape (#67) — no pickup GUID; keyed by unlocked schematic
  collected: boolean;             // execution state (Pioneer-owned; #209-B may raise false→true)
  coordinates?: Coordinates;
  reason?: string;
};
```

Reuses `CollectibleKind` / `Coordinates` from the existing model — **no parallel collectible
enum**. Every collectible carries the identity key (`guid` else `schematic`) so #209-B matches
exactly.

## Lifecycle & reuse

Explore orders reuse, unchanged: the full **state machine** (`workOrderTransitions.ts`),
**revisions/snapshots**, **audit trail**, the per-playthrough **sequence counter**, the
**single-active** invariant, **parent/child** linkage, and **auto-unblock** (`onChildCompleted`
keys only on `parentWorkOrderId` + state). `WorkOrderRelationshipType` already has `exploration`
/ `hard_drive_hunt`, so a build order may sit `blocked` on an explore child that resolves its
blocker. Completion is Pioneer-driven (foreman may propose); force-complete leaves some
uncollected with a summary. Progress metric: "5 / 8 collected".

New audit event: **`collectible_collected`** (actor `Pioneer` on a manual tick, `System` on
re-upload reconciliation).

## Data sourcing (cross-MCP, mirrors work-order opportunities)

The foreman populates waypoints at issue time by joining MCP facts:
- **Where collectibles are** → `nearest_collectibles` / `list_collectibles` (game-data world
  tools) — extended to emit each collectible's stable **identity** (`guid` / `schematic` / `id`)
  so it can be stored on the waypoint.
- **Which remain** → save-game reconciliation subtracts already-collected items, so the route
  never sends the pioneer to a collectible they already grabbed. Degrade gracefully with no save.

## #209-B — reconciliation on re-upload

Predicate (already implemented): `isCollected(c, collectedGuidSet(state),
unlockedSchematicSet(state))` — GUID-keyed match against destroyed-pickups ∪ looted-pods, else
schematic-keyed match against unlocked schematics.

Flow: on `SaveService.addVersion` (after the new save becomes current), fetch the save's
collected-identity set via a savePath-gated MCP tool (**`get_collected_identities`** →
`{ guids, schematics }`); for each active/non-terminal **explore** order, flip
`ExploreCollectible.collected` **false→true** where its `guid`/`schematic` is in the set
(monotonic — never auto-uncollect, since a collectible can't return); write a `System`
`collectible_collected` audit per change; return a reconcile summary that surfaces as a
"Save synced: N collectibles collected" banner.

## Out of scope
- Buildables reconciliation (#209-A) — cancelled (heuristic matching).
- Map / route-geometry view — a plain ordered waypoint list for now.
- Loose crash-site parts collection; explore-specific revision semantics beyond the reuse above.

## Implementation slices
1. **MCP identity plumbing** — `nearest_collectibles`/`list_collectibles` emit guid/schematic;
   new `get_collected_identities`; add `helmet`/`mtape` to the kind enums.
2. **Explore-order variant (#207)** — model + migration, `create_explore_order` tool, REST
   mark-collected, `WaypointsSection` client view, `EO-` label, prompt.
3. **Reconciliation (#209-B)** — hook `addVersion`, monotonic apply + audit + banner.
