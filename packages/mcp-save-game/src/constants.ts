/**
 * Every Satisfactory class path / property key the normalise layer matches on,
 * in one place. All values were confirmed by inspecting real saves (see
 * `src/scripts/inspect.ts` and the package README). Matchers are regexes rather
 * than exact literals so minor instance-naming variation still resolves; if a
 * future game build renames something, this is the only file to correct.
 *
 * The save's object graph spans many World-Partition sublevels; the singleton
 * managers below live in `Persistent_Level`, but actors (player, storage,
 * collectibles) are scattered across all levels — so callers iterate every level.
 */

/** The player pawn (carries the world transform and the inventory reference). */
export const PLAYER_CHARACTER = /Char_Player/;

/** The HUB / first build. */
export const HUB_BUILDING = /Build_TradingPost|Build_HubTerminal/;

/** Storage containers (Mk1/Mk2/Integrated/Player all share this prefix). */
export const STORAGE_BUILDING = /Build_Storage/;

/** Recipe manager singleton + the array of unlocked recipe class refs. */
export const RECIPE_MANAGER = /FGRecipeManager/;
export const AVAILABLE_RECIPES_PROP = 'mAvailableRecipes';

/** Schematic manager singleton + the array of purchased schematic class refs. */
export const SCHEMATIC_MANAGER = /BP_SchematicManager/;
export const PURCHASED_SCHEMATICS_PROP = 'mPurchasedSchematics';

/** MAM research manager singleton + the array of unlocked research-tree refs. */
export const RESEARCH_MANAGER = /BP_ResearchManager/;
export const UNLOCKED_RESEARCH_PROP = 'mUnlockedResearchTrees';

/** Game-phase manager singleton + the current-phase object ref. */
export const GAME_PHASE_MANAGER = /BP_GamePhaseManager/;
export const CURRENT_PHASE_PROP = 'mCurrentGamePhase';
export const TARGET_PHASE_PROP = 'mTargetGamePhase';
/** `GP_Project_Assembly_Phase_2` → 2. */
export const GAME_PHASE_NUMBER = /Phase_(\d+)/;

/** Dimensional depot (central storage subsystem) + its stored-items array. */
export const CENTRAL_STORAGE_SUBSYSTEM = /FGCentralStorageSubsystem/;
export const STORED_ITEMS_PROP = 'mStoredItems';

/** The player's main inventory component reference. */
export const PLAYER_INVENTORY_PROP = 'mInventory';
/** Inventory stacks on any FGInventoryComponent. */
export const INVENTORY_STACKS_PROP = 'mInventoryStacks';

/** Recipes whose class name marks them as an alternate (vs the standard recipe). */
export const ALTERNATE_RECIPE = /Recipe_Alternate_/i;

/** Schematic class-name classification. */
export const TUTORIAL_SCHEMATIC = /Schematic_Tutorial|Schematic_StartingRecipes/i;
export const MAM_SCHEMATIC = /\/Research\/|Schematic_(?:MAM|Research)/i;
/** `Schematic_3-2_C` → tier 3. */
export const SCHEMATIC_TIER = /Schematic_(\d+)-/;

/**
 * Collectible kind heuristics, matched against the picked-up actor's instance
 * name in the per-level `collectables` (destroyed-actor) list. Calibrated
 * against real saves: artifact and slug TOTALS are reliable; the finer splits
 * (sphere vs sloop, slug colour, hard drives) are approximate — exact per-type
 * counts/locations need the world-location dataset (game-data v3).
 */
export const COLLECTIBLE_KIND = {
  /** Mercer Spheres + Somersloops (BP_WAT1 / BP_WAT2). Reliable TOTAL (≈400 vs truth). */
  alienArtifact: /BP_WAT/i,
  /** Somersloop, class-prefixed. Approximate split only (regex-sensitive). */
  somersloop: /BP_WAT2_/i,
  powerSlug: /BP_Crystal/i,
  dropPod: /DropPod/i,
  crashDebris: /CrashSiteDebris|DebrisActor/i,
  itemPickup: /ItemPickup/i,
} as const;

/**
 * Known world totals for a fresh v1.0+ game, surfaced by `get_collectibles` as
 * reference context. These are constants (not from the save) and may vary by
 * game version or with mods.
 */
export const WORLD_COLLECTIBLE_TOTALS = {
  mercerSpheres: 298,
  somersloops: 106,
  dropPods: 118,
} as const;
