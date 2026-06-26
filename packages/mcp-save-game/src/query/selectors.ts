import {
  cmToMetres,
  compassBearing,
  humaniseClassName,
  type Collectible,
  type CollectibleKind as WorldCollectibleKind,
  type LootPickup,
  type UnlockCost,
  type WorldLocations,
} from '@foreman/game-data-core';

import type {
  AssemblyPhase,
  Inventory,
  Milestone,
  SaveState,
  StorageContainer,
  UnlockedRecipe,
  Vec3,
} from '../normalise/types.js';

/** Convert a centimetre position to the metres the pioneer sees in-game (2dp). */
function vecToMetres(v: Vec3): Vec3 {
  return { x: cmToMetres(v.x), y: cmToMetres(v.y), z: cmToMetres(v.z) };
}

/**
 * Pure, tool-facing read functions over a `SaveState`. These shape the computed
 * answers the MCP tools return; keeping them here keeps `tools/index.ts` thin and
 * makes the logic directly unit-testable.
 */

export interface PlayerSummary {
  location?: Vec3;
  hubLocation?: Vec3;
  /** Total in-game play time in seconds, if the save header carries it. */
  playDurationSeconds?: number;
  /** The same play time formatted as "Xh Ym", for convenience. */
  playTime?: string;
  itemCount: number;
  inventory: Inventory;
}

export function playerSummary(state: SaveState): PlayerSummary {
  return {
    location: state.player.location === undefined ? undefined : vecToMetres(state.player.location),
    hubLocation:
      state.player.hubLocation === undefined ? undefined : vecToMetres(state.player.hubLocation),
    playDurationSeconds: state.playDurationSeconds,
    playTime: formatDuration(state.playDurationSeconds),
    itemCount: state.player.inventory.length,
    inventory: state.player.inventory,
  };
}

/** Formats a duration in seconds as "Xh Ym" (e.g. 45296 → "12h 34m"). */
function formatDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return undefined;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export interface RecipeSummary {
  total: number;
  standardCount: number;
  alternateCount: number;
  standard: UnlockedRecipe[];
  alternates: UnlockedRecipe[];
}

export function unlockedRecipes(state: SaveState): RecipeSummary {
  const standard = state.recipes.filter((r) => !r.isAlternate);
  const alternates = state.recipes.filter((r) => r.isAlternate);
  return {
    total: state.recipes.length,
    standardCount: standard.length,
    alternateCount: alternates.length,
    standard,
    alternates,
  };
}

export interface MilestoneSummary {
  assemblyPhase?: AssemblyPhase;
  milestonesByTier: { tier: number; milestones: Milestone[] }[];
  tutorials: Milestone[];
  other: Milestone[];
  mamResearch: string[];
}

export function milestones(state: SaveState): MilestoneSummary {
  const byTier = new Map<number, Milestone[]>();
  const tutorials: Milestone[] = [];
  const other: Milestone[] = [];
  for (const milestone of state.milestones) {
    if (milestone.kind === 'tutorial') {
      tutorials.push(milestone);
    } else if (milestone.kind === 'milestone' && milestone.tier !== undefined) {
      const bucket = byTier.get(milestone.tier) ?? [];
      bucket.push(milestone);
      byTier.set(milestone.tier, bucket);
    } else {
      other.push(milestone);
    }
  }
  return {
    assemblyPhase: state.assemblyPhase,
    milestonesByTier: [...byTier.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([tier, list]) => ({ tier, milestones: list })),
    tutorials,
    other,
    mamResearch: state.mamResearch,
  };
}

export interface StorageView {
  containerCount: number;
  containers: (StorageContainer & { distance?: number })[];
  dimensionalDepot: Inventory;
}

/**
 * Storage containers and the dimensional depot, with container locations in
 * metres. When a `location` (in metres, e.g. from get_player_state) is given,
 * containers are annotated with distance to it and sorted nearest-first.
 */
export function storageView(state: SaveState, location?: Vec3): StorageView {
  const containers: (StorageContainer & { distance?: number })[] = state.storage.containers.map(
    (container) => {
      const locM = container.location === undefined ? undefined : vecToMetres(container.location);
      return {
        ...container,
        location: locM,
        distance:
          location !== undefined && locM !== undefined ? distance(location, locM) : undefined,
      };
    },
  );
  if (location !== undefined) {
    containers.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }
  return {
    containerCount: state.storage.containers.length,
    containers,
    dimensionalDepot: state.storage.dimensionalDepot,
  };
}

const COLLECTIBLE_KINDS: WorldCollectibleKind[] = [
  'mercerSphere',
  'somersloop',
  'powerSlugBlue',
  'powerSlugYellow',
  'powerSlugPurple',
  'hardDrive',
  'helmet',
  'mtape',
];

const COVERAGE_NOTE =
  "Exact per-kind counts. collected is read from the save's own collected record " +
  "(FGScannableSubsystem), matched to the world dataset by each collectible's GUID, so it is " +
  'accurate at any exploration level — never an estimate. remaining = worldTotal − collected ' +
  '(still out there); use get_nearby for the locations of those remaining ones.';

export interface CollectibleProgress {
  kind: WorldCollectibleKind;
  label: string;
  /** Fixed map-wide total for this kind. */
  worldTotal: number;
  /** Exactly how many the pioneer has collected (from the save's GUID record). */
  collected: number;
  /** Still out there to grab (worldTotal − collected). */
  remaining: number;
}

export interface CollectibleProgressView {
  perType: CollectibleProgress[];
  note: string;
}

/**
 * Exact per-kind collectible progress. The save's `FGScannableSubsystem` records
 * the GUID of every collected pickup (spheres/sloops/slugs) and looted hard-drive
 * pod; matching those against each world-dataset collectible's GUID gives an exact
 * collected count at any progression — no exploration-based estimation.
 */
export function collectibleProgressView(
  state: SaveState,
  world: WorldLocations,
): CollectibleProgressView {
  const collectedSet = collectedGuidSet(state);
  const unlockedSchematics = unlockedSchematicSet(state);
  const totals = new Map<string, number>();
  const collected = new Map<string, number>();
  for (const c of world.collectibles) {
    totals.set(c.kind, (totals.get(c.kind) ?? 0) + 1);
    if (isCollected(c, collectedSet, unlockedSchematics)) {
      collected.set(c.kind, (collected.get(c.kind) ?? 0) + 1);
    }
  }
  const perType: CollectibleProgress[] = COLLECTIBLE_KINDS.map((kind) => {
    const worldTotal = totals.get(kind) ?? 0;
    const got = collected.get(kind) ?? 0;
    return {
      kind,
      label: KIND_LABELS[kind] ?? kind,
      worldTotal,
      collected: got,
      remaining: worldTotal - got,
    };
  });
  return { perType, note: COVERAGE_NOTE };
}

/** Every collected-collectible GUID (pickups + looted pods) as one lookup set. */
export function collectedGuidSet(state: SaveState): Set<string> {
  return new Set([...state.collectedPickupGuids, ...state.lootedDropPodGuids]);
}

/**
 * The classes of every schematic the pioneer has unlocked. Customizer pickups
 * (helmet/tapes) carry no pickup GUID — picking one up unlocks a cosmetic
 * schematic, so this is how their collected status is determined.
 */
export function unlockedSchematicSet(state: SaveState): Set<string> {
  return new Set(state.milestones.map((m) => m.schematicClass));
}

/**
 * Whether a collectible has been collected: GUID-keyed kinds match the save's
 * destroyed-pickup record; schematic-keyed customizer kinds match the unlocked
 * schematics.
 */
export function isCollected(
  c: Collectible,
  collectedGuids: Set<string>,
  unlockedSchematics: Set<string>,
): boolean {
  if (c.guid !== undefined) {
    return collectedGuids.has(c.guid);
  }
  if (c.schematic !== undefined) {
    return unlockedSchematics.has(c.schematic);
  }
  return false;
}

/** A drop-pod unlock cost with the item descriptor resolved to a display name. */
export interface ResolvedUnlock {
  item?: { itemClass: string; name: string; amount: number };
  powerMW?: number;
}

/** Resolve a dataset unlock cost, upgrading the item class to a display name. */
function resolveUnlock(u: UnlockCost, itemName?: (className: string) => string): ResolvedUnlock {
  const out: ResolvedUnlock = {};
  if (u.item !== undefined) {
    out.item = {
      itemClass: u.item.itemClass,
      name: itemName?.(u.item.itemClass) ?? humaniseClassName(u.item.itemClass),
      amount: u.item.amount,
    };
  }
  if (u.powerMW !== undefined) {
    out.powerMW = u.powerMW;
  }
  return out;
}

export interface NearbyItem {
  kind: WorldCollectibleKind;
  label: string;
  /** World position in metres. */
  location: Vec3;
  /** Straight-line distance from the origin, in metres. */
  distance: number;
  /** 8-point compass direction from the origin (N, NE, E, …). */
  bearing: string;
  /** For hard-drive crash sites: what the pod requires to open (item and/or power). */
  unlock?: ResolvedUnlock;
}

export interface NearbyOptions {
  kinds?: WorldCollectibleKind[];
  radius?: number;
  limit?: number;
}

export interface NearbyResult {
  origin: Vec3;
  radius?: number;
  /** Total matches (before the limit was applied). */
  matchCount: number;
  items: NearbyItem[];
  /** Honest caveat: positions are from the static world dataset. */
  note: string;
}

const DEFAULT_NEARBY_LIMIT = 20;

const KIND_LABELS: Record<WorldCollectibleKind, string> = {
  mercerSphere: 'Mercer Sphere',
  somersloop: 'Somersloop',
  powerSlugBlue: 'Blue Power Slug',
  powerSlugYellow: 'Yellow Power Slug',
  powerSlugPurple: 'Purple Power Slug',
  hardDrive: 'Hard Drive (crash site)',
  helmet: 'Customizer Helmet',
  mtape: 'Tape',
};

const NEARBY_NOTE =
  'Un-collected collectibles only: positions are from the static world dataset, with the ' +
  'ones the save records as already collected (by GUID) removed — so these are genuinely ' +
  'still out there to grab. Locations + distances are in metres; bearing is the compass ' +
  'direction from you (N/NE/E/…).';

/**
 * Un-collected collectibles near a world location, nearest-first, in metres.
 * `origin` is in metres (e.g. from get_player_state) and `radius` in metres.
 * Positions come from the static world-location dataset (complete and accurate);
 * collectibles the save records as collected (by GUID, via `excludeGuids`) are
 * removed, so the result is exactly what is still grabbable. Each item carries a
 * compass bearing from the origin. Capped by `limit` (default 20).
 */
export function nearbyFromWorld(
  collectibles: Collectible[],
  origin: Vec3,
  options: NearbyOptions = {},
  excludeGuids?: Set<string>,
  excludeSchematics?: Set<string>,
  itemName?: (className: string) => string,
): NearbyResult {
  const limit = options.limit ?? DEFAULT_NEARBY_LIMIT;
  const collected = (c: Collectible): boolean =>
    (c.guid !== undefined && excludeGuids?.has(c.guid) === true) ||
    (c.schematic !== undefined && excludeSchematics?.has(c.schematic) === true);
  let items: NearbyItem[] = collectibles
    .filter((c) => (options.kinds === undefined || options.kinds.includes(c.kind)) && !collected(c))
    .map((c) => {
      const location = vecToMetres({ x: c.x, y: c.y, z: c.z });
      return {
        kind: c.kind,
        label: KIND_LABELS[c.kind] ?? c.kind,
        location,
        distance: distance(origin, location),
        bearing: compassBearing(origin, location),
        ...(c.unlock !== undefined ? { unlock: resolveUnlock(c.unlock, itemName) } : {}),
      };
    })
    .sort((a, b) => a.distance - b.distance);
  if (options.radius !== undefined) {
    const radius = options.radius;
    items = items.filter((i) => i.distance <= radius);
  }
  return {
    origin,
    radius: options.radius,
    matchCount: items.length,
    items: items.slice(0, limit),
    note: NEARBY_NOTE,
  };
}

/** Straight-line distance between two points (same units in, same units out; exact). */
export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export interface NearbyPart {
  /** Item display name. */
  item: string;
  /** Item descriptor class (e.g. Desc_Computer_C). */
  itemClass: string;
  /** Stack size at this pickup. */
  amount: number;
  /** World position in metres. */
  location: Vec3;
  /** Straight-line distance from the origin, in metres. */
  distance: number;
  /** 8-point compass direction from the origin. */
  bearing: string;
}

export interface NearbyPartsOptions {
  /** Filter to items whose class or display name contains this (case-insensitive). */
  item?: string;
  /** Cap matches to within this many metres of the origin. */
  radius?: number;
  limit?: number;
}

export interface NearbyPartsResult {
  origin: Vec3;
  radius?: number;
  matchCount: number;
  items: NearbyPart[];
  note: string;
}

const PARTS_NOTE =
  'Loose crash-site parts near you, from the complete static world dataset (the corrected 1.2 ' +
  'loot — every spawn, map-wide). IMPORTANT: unlike collectibles, the game does not record ' +
  'individual loose-part pickups by GUID, so these cannot be filtered to "not yet grabbed" — ' +
  'one you have already taken may still be listed; treat this as where parts spawn. ' +
  'Locations + distances are in metres; bearing is the compass direction from you. (A save that ' +
  'began before 1.2 may also show a few different in-world items, due to a since-fixed game bug.)';

/**
 * Loose crash-site parts near a world location, nearest-first, in metres. `origin`/`radius`
 * are in metres. Positions come from the static world-location dataset (all spawns, map-wide).
 * `excludeGuids` removes any whose GUID the save records as collected — but note loose-part
 * pickups are NOT currently GUID-tracked in `mDestroyedPickups` (only collectibles are), so in
 * practice this excludes nothing for parts; it is kept for parity and forward-compatibility.
 * `itemName` upgrades the item descriptor class to a display name (humanised fallback).
 */
export function nearbyParts(
  loot: LootPickup[],
  origin: Vec3,
  options: NearbyPartsOptions = {},
  excludeGuids?: Set<string>,
  itemName?: (className: string) => string,
): NearbyPartsResult {
  const limit = options.limit ?? DEFAULT_NEARBY_LIMIT;
  const needle = options.item?.trim().toLowerCase();
  const label = (cls: string): string => itemName?.(cls) ?? humaniseClassName(cls);
  let items: NearbyPart[] = loot
    .filter((p) => excludeGuids?.has(p.guid) !== true)
    .filter(
      (p) =>
        needle === undefined ||
        needle === '' ||
        p.itemClass.toLowerCase().includes(needle) ||
        label(p.itemClass).toLowerCase().includes(needle),
    )
    .map((p) => {
      const location = vecToMetres({ x: p.x, y: p.y, z: p.z });
      return {
        item: label(p.itemClass),
        itemClass: p.itemClass,
        amount: p.amount,
        location,
        distance: distance(origin, location),
        bearing: compassBearing(origin, location),
      };
    })
    .sort((a, b) => a.distance - b.distance);
  if (options.radius !== undefined) {
    const radius = options.radius;
    items = items.filter((i) => i.distance <= radius);
  }
  return {
    origin,
    radius: options.radius,
    matchCount: items.length,
    items: items.slice(0, limit),
    note: PARTS_NOTE,
  };
}
