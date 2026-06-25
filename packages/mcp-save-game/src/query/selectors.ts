import type {
  Collectible,
  CollectibleKind as WorldCollectibleKind,
  WorldLocations,
} from '@foreman/game-data-core';

import { STREAMED_CELL_MARGIN } from '../constants.js';
import type {
  AssemblyPhase,
  BoundingBox,
  Inventory,
  Milestone,
  SaveState,
  StorageContainer,
  UnlockedRecipe,
  Vec3,
} from '../normalise/types.js';

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
    location: state.player.location,
    hubLocation: state.player.hubLocation,
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
 * Storage containers and the dimensional depot. When a `location` is given,
 * containers are annotated with distance to it and sorted nearest-first.
 */
export function storageView(state: SaveState, location?: Vec3): StorageView {
  let containers: (StorageContainer & { distance?: number })[] = state.storage.containers;
  if (location !== undefined) {
    containers = state.storage.containers
      .map((container) => ({
        ...container,
        distance:
          container.location === undefined ? undefined : distance(location, container.location),
      }))
      .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }
  return {
    containerCount: state.storage.containers.length,
    containers,
    dimensionalDepot: state.storage.dimensionalDepot,
  };
}

const COVERAGE_NOTE =
  'worldTotal is the fixed map-wide count. The map streams in by region as the pioneer ' +
  'explores, and within an explored region collected collectibles are absent while ' +
  'un-collected ones are present — so collectedInExplored and presentInSave are derived only ' +
  'over the regions this save has loaded (approximate, ±a few at region edges). ' +
  'inUnexploredAreas are collectibles in regions not yet loaded — status unknown (could be ' +
  'collected or not). presentInSave + collectedInExplored + inUnexploredAreas ≈ worldTotal. ' +
  'For actual locations to grab, use get_nearby.';

export interface CollectibleProgress {
  kind: WorldCollectibleKind;
  label: string;
  /** Fixed map-wide total for this kind. */
  worldTotal: number;
  /** Un-collected and present in an explored (streamed) region — i.e. still grabbable. */
  presentInSave: number;
  /** Collected, inferred over explored regions only (absent where the region is loaded). */
  collectedInExplored: number;
  /** In regions not yet loaded — collection status unknown. */
  inUnexploredAreas: number;
}

export interface CollectibleProgressView {
  perType: CollectibleProgress[];
  note: string;
}

/**
 * Per-type collectible progress (Mercer Spheres, Somersloops, blue/yellow/purple
 * slugs). Scopes a real "collected" count to the explored region: a kind's
 * collectibles from the world dataset that fall inside a streamed cell, minus
 * those still present, are collected; the rest lie in unexplored regions and are
 * left as unknown. Accurate at both extremes (0%-explored ⇒ ~0 collected;
 * fully-explored ⇒ ~the full collected total), approximate at the margins.
 */
export function collectibleProgressView(
  state: SaveState,
  world: WorldLocations,
): CollectibleProgressView {
  const inExplored = explorationTest(state.streamedCellBoxes);
  const streamedByKind = new Map<string, number>();
  for (const collectible of world.collectibles) {
    if (inExplored(collectible)) {
      streamedByKind.set(collectible.kind, (streamedByKind.get(collectible.kind) ?? 0) + 1);
    }
  }
  const perType: CollectibleProgress[] = state.collectibleProgress.map((c) => {
    const streamedTotal = streamedByKind.get(c.kind) ?? 0;
    const collectedInExplored = Math.max(0, streamedTotal - c.presentInSave);
    return {
      kind: c.kind,
      label: c.label,
      worldTotal: c.worldTotal,
      presentInSave: c.presentInSave,
      collectedInExplored,
      inUnexploredAreas: Math.max(0, c.worldTotal - c.presentInSave - collectedInExplored),
    };
  });
  return { perType, note: COVERAGE_NOTE };
}

/** Builds a predicate: is a point within any streamed cell box (with a margin)? */
function explorationTest(boxes: BoundingBox[]): (p: { x: number; y: number }) => boolean {
  const m = STREAMED_CELL_MARGIN;
  return (p) =>
    boxes.some((b) => p.x >= b.x0 - m && p.x <= b.x1 + m && p.y >= b.y0 - m && p.y <= b.y1 + m);
}

export interface NearbyItem {
  kind: WorldCollectibleKind;
  label: string;
  location: Vec3;
  distance: number;
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
};

const NEARBY_NOTE =
  'Positions come from the static world dataset (every fixed placement in the world). ' +
  'The save cannot confirm which of these you have already collected, so some nearby ' +
  'items may already be gone — treat this as "where collectibles are", not "what is left".';

/**
 * Collectibles near a world location, nearest-first, from the static world-
 * location dataset (complete and accurate, unlike the save which only contains
 * collectibles in already-streamed cells). Filtered by `kinds` and `radius`,
 * capped by `limit` (default 20). Coordinates are centimetres, matching the
 * pioneer's save location.
 */
export function nearbyFromWorld(
  collectibles: Collectible[],
  origin: Vec3,
  options: NearbyOptions = {},
): NearbyResult {
  const limit = options.limit ?? DEFAULT_NEARBY_LIMIT;
  let items: NearbyItem[] = collectibles
    .filter((c) => options.kinds === undefined || options.kinds.includes(c.kind))
    .map((c) => {
      const location = { x: c.x, y: c.y, z: c.z };
      return {
        kind: c.kind,
        label: KIND_LABELS[c.kind] ?? c.kind,
        location,
        distance: distance(origin, location),
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

export function distance(a: Vec3, b: Vec3): number {
  return Math.round(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
}
