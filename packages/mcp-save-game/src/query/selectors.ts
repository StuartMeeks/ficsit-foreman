import type {
  AssemblyPhase,
  Collectibles,
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

export function collectiblesView(state: SaveState): Collectibles {
  return state.collectibles;
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.round(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
}
