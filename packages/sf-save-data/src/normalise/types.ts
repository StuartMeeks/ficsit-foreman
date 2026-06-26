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
 * A recipe-running factory machine, as read from the save (no game-data join yet).
 * This is the machine's *configuration* — recipe, clock and somersloop boost — from
 * which the query layer derives theoretical throughput and estimated power. What the
 * machine is actually fed/producing (belts, pipes, power) is out of scope here — see
 * the actual-production graph issue.
 */
export interface ProducerLine {
  /** Building class, e.g. `Build_ConstructorMk1_C`. */
  buildingClass: string;
  displayName: string;
  /** Recipe class the machine is set to, e.g. `Recipe_IronPlate_C`. Undefined = unconfigured. */
  recipeClass?: string;
  /** Clock speed as a fraction (1 = 100%); defaults to 1 when the save omits it. */
  clockSpeed: number;
  /** Somersloop output multiplier (1 = none); defaults to 1 when omitted. */
  productionBoost: number;
  location?: Vec3;
}

/** A resource extractor (miner / pump / fracking). Output is the node's resource. */
export interface ExtractorLine {
  buildingClass: string;
  displayName: string;
  clockSpeed: number;
  productionBoost: number;
  location?: Vec3;
}

export interface ProductionState {
  producers: ProducerLine[];
  extractors: ExtractorLine[];
}

export interface SaveState {
  /** Detected game version (build number, with save version), or 'unknown'. */
  version: string;
  /** Save session name, or the file base name. */
  saveName: string;
  /** Raw in-game session name from the header (undefined if absent). */
  sessionName?: string;
  /** Map name from the header, e.g. `Persistent_Level` (undefined if absent). */
  mapName?: string;
  /** Satisfactory changelist/build number from the header — comparable to game data's `build`. */
  buildVersion?: number;
  /** Save-format version from the header. */
  saveVersion?: number;
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
  /** Active factory machines (recipe-runners) and resource extractors. */
  production: ProductionState;
  milestones: Milestone[];
  /** Unlocked MAM research-tree names. */
  mamResearch: string[];
  assemblyPhase?: AssemblyPhase;
  /**
   * GUIDs of collected collectibles (spheres/sloops/slugs), from
   * `FGScannableSubsystem.mDestroyedPickups` — matched against the world-locations
   * dataset for exact per-kind collected counts. See `collectibleProgressView`.
   */
  collectedPickupGuids: string[];
  /** GUIDs of looted hard-drive drop pods (`FGScannableSubsystem.mLootedDropPods`). */
  lootedDropPodGuids: string[];
  /**
   * Instance names of collected loose crash-site parts (`FGItemPickup_Spawnable`), taken
   * from each sublevel's `collectables` (collected/removed-actor) record. These are NOT in
   * `mDestroyedPickups` (that tracks collectibles only); they are matched against the
   * world-locations `lootPickups[].id` to drop already-grabbed parts. Map-wide and complete.
   */
  collectedLootIds: string[];
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
    production: { producers: [], extractors: [] },
    milestones: [],
    mamResearch: [],
    collectedPickupGuids: [],
    lootedDropPodGuids: [],
    collectedLootIds: [],
    warnings: [],
  };
}
