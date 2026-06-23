import type { CollectibleKind } from '../constants.js';
import type {
  AssemblyPhase,
  CollectibleCount,
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
  itemCount: number;
  inventory: Inventory;
}

export function playerSummary(state: SaveState): PlayerSummary {
  return {
    location: state.player.location,
    hubLocation: state.player.hubLocation,
    itemCount: state.player.inventory.length,
    inventory: state.player.inventory,
  };
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
  'collected = world total − remaining-in-save. Exact on a fully-explored save; ' +
  'on an under-explored save (World-Partition cells not yet streamed in) the ' +
  'collected figure is over-counted.';

export interface CollectibleProgressView {
  perType: CollectibleCount[];
  note: string;
}

/** Per-type collection progress (Mercer Spheres, Somersloops, blue/yellow/purple slugs). */
export function collectibleProgressView(state: SaveState): CollectibleProgressView {
  return { perType: state.collectibleProgress, note: COVERAGE_NOTE };
}

export interface NearbyItem {
  kind: CollectibleKind;
  label: string;
  location: Vec3;
  distance: number;
}

export interface NearbyOptions {
  kinds?: CollectibleKind[];
  radius?: number;
  limit?: number;
}

export interface NearbyResult {
  origin: Vec3;
  radius?: number;
  /** Total matches (before the limit was applied). */
  matchCount: number;
  items: NearbyItem[];
}

const DEFAULT_NEARBY_LIMIT = 20;

/**
 * Un-collected collectibles near a world location, nearest-first. Filtered by
 * `kinds` and `radius`, capped by `limit` (default 20).
 */
export function nearby(state: SaveState, origin: Vec3, options: NearbyOptions = {}): NearbyResult {
  const limit = options.limit ?? DEFAULT_NEARBY_LIMIT;
  let items: NearbyItem[] = state.remainingCollectibles
    .filter(
      (c): c is typeof c & { location: Vec3 } =>
        c.location !== undefined && (options.kinds === undefined || options.kinds.includes(c.kind)),
    )
    .map((c) => ({
      kind: c.kind,
      label: c.label,
      location: c.location,
      distance: distance(origin, c.location),
    }))
    .sort((a, b) => a.distance - b.distance);
  if (options.radius !== undefined) {
    const radius = options.radius;
    items = items.filter((i) => i.distance <= radius);
  }
  return { origin, radius: options.radius, matchCount: items.length, items: items.slice(0, limit) };
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.round(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
}
