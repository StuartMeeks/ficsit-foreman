/**
 * The clean, serialisable model the MCP tools answer over. Nothing downstream of
 * `normaliseSave` sees a raw `typePath`, tagged-property wrapper, or Unreal class
 * path — only these records. Display names are humanised from class names alone
 * (no game-data lookup; this server does not duplicate the game-data graph).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface InventoryStack {
  /** Item class name, e.g. `Desc_IronPlate_C`. */
  itemClass: string;
  displayName: string;
  quantity: number;
}

export type Inventory = InventoryStack[];

export interface PlayerState {
  location?: Vec3;
  hubLocation?: Vec3;
  inventory: Inventory;
}

export interface StorageContainer {
  buildingClass: string;
  displayName: string;
  location?: Vec3;
  inventory: Inventory;
}

export interface UnlockedRecipe {
  recipeClass: string;
  displayName: string;
  isAlternate: boolean;
}

export type MilestoneKind = 'milestone' | 'tutorial' | 'other';

export interface Milestone {
  schematicClass: string;
  displayName: string;
  /** Milestone tier (1–9) where derivable from the class name. */
  tier?: number;
  kind: MilestoneKind;
}

export interface AssemblyPhase {
  /** Current Project Assembly / Space Elevator phase number, if derivable. */
  phase?: number;
  current?: string;
  target?: string;
}

/**
 * Collected-collectible figures. The save records a per-level "collected"
 * (destroyed-actor) registry whose entries don't reliably encode type. Calibrated
 * against real saves: artifact and slug TOTALS are reliable; the per-type split is
 * approximate, and exact per-type counts/locations need the world dataset
 * (game-data v3 World Locations). `precise` is therefore always false in v1.
 */
export interface Collectibles {
  /** Total entries in the collected registry (all kinds, incl. flora/pickups). */
  totalCollected: number;
  /** Counts that match ground truth closely. */
  reliable: {
    alienArtifacts: number;
    powerSlugs: number;
  };
  /** Best-effort splits — may be off by a handful; do not treat as exact. */
  approximate: {
    mercerSpheres: number;
    somersloops: number;
    dropPodsOrHardDrives: number;
  };
  /** Known world totals for a fresh v1.0+ game, for reference (not from the save). */
  worldTotals: {
    mercerSpheres: number;
    somersloops: number;
    dropPods: number;
  };
  precise: false;
  note: string;
}

export interface SaveState {
  /** Detected game version (build number, with save version), or 'unknown'. */
  version: string;
  /** Save session name, or the file base name. */
  saveName: string;
  /** ISO timestamp of when this state was parsed. */
  parsedAt: string;
  player: PlayerState;
  storage: {
    containers: StorageContainer[];
    dimensionalDepot: Inventory;
  };
  recipes: UnlockedRecipe[];
  milestones: Milestone[];
  /** Unlocked MAM research-tree names. */
  mamResearch: string[];
  assemblyPhase?: AssemblyPhase;
  collectibles: Collectibles;
  /** Non-fatal issues collected during normalisation. */
  warnings: string[];
}

/** A valid empty state for when no save is loaded (or a parse failed). */
export function emptySaveState(version: string, saveName: string, parsedAt: string): SaveState {
  return {
    version,
    saveName,
    parsedAt,
    player: { inventory: [] },
    storage: { containers: [], dimensionalDepot: [] },
    recipes: [],
    milestones: [],
    mamResearch: [],
    collectibles: {
      totalCollected: 0,
      reliable: { alienArtifacts: 0, powerSlugs: 0 },
      approximate: { mercerSpheres: 0, somersloops: 0, dropPodsOrHardDrives: 0 },
      worldTotals: { mercerSpheres: 0, somersloops: 0, dropPods: 0 },
      precise: false,
      note: 'No save loaded.',
    },
    warnings: [],
  };
}
