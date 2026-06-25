/**
 * The clean, serialisable model the MCP tools answer over. Nothing downstream of
 * `normaliseSave` sees a raw `typePath`, tagged-property wrapper, or Unreal class
 * path — only these records. Display names are humanised from class names alone
 * (no game-data lookup; this server does not duplicate the game-data graph).
 */

import type { CollectibleKind } from '../constants.js';

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
 * One un-collected collectible still present in the save, with its world
 * location. Collected ones are destroyed (absent), so this is "what's left to
 * grab, and where".
 */
export interface RemainingCollectible {
  kind: CollectibleKind;
  label: string;
  location?: Vec3;
}

/**
 * Per-type collectible visibility. `presentInSave` is the count of un-collected
 * actors of that type the save actually contains — i.e. those in World-Partition
 * cells the pioneer has streamed in. The save reveals nothing about cells not yet
 * streamed and does not record which collectibles were picked up, so a reliable
 * "collected" or "remaining" total cannot be derived from the save alone (only
 * `worldTotal`, a fixed public constant, and what is currently present).
 */
export interface CollectibleCount {
  kind: CollectibleKind;
  label: string;
  worldTotal: number;
  presentInSave: number;
}

export interface SaveState {
  /** Detected game version (build number, with save version), or 'unknown'. */
  version: string;
  /** Save session name, or the file base name. */
  saveName: string;
  /** Total in-game play time in seconds, if the header carries it. */
  playDurationSeconds?: number;
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
  /** Per-type collection progress (Mercer Spheres, Somersloops, slugs, hard drives). */
  collectibleProgress: CollectibleCount[];
  /** Un-collected collectibles still in the save, with locations (for proximity). */
  remainingCollectibles: RemainingCollectible[];
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
    collectibleProgress: [],
    remainingCollectibles: [],
    warnings: [],
  };
}
