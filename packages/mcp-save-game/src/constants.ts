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

/** A collectible type the save can classify by an actor's typePath. */
export type CollectibleKind =
  | 'mercerSphere'
  | 'somersloop'
  | 'powerSlugBlue'
  | 'powerSlugYellow'
  | 'powerSlugPurple';

/**
 * Present-actor matchers for *un-collected* collectibles, keyed on the actor's
 * `typePath` (which is the clean class — reliable, unlike the instanceName-only
 * `collectables` destroyed registry). A collected collectible is destroyed and
 * absent, so what remains in the save is what's left to grab. Calibrated against
 * a real save: remaining-actor counts matched ground truth exactly per colour
 * (e.g. blue 410, yellow 270, purple 195), so `collected = total − remaining`
 * is exact on a fully-explored save. The matchers are mutually exclusive
 * (`BP_Crystal_C` does not match `BP_Crystal_mk2_C`).
 *
 * `BP_WAT2_C` is the Mercer Sphere and `BP_WAT1_C` the Somersloop — confirmed by
 * first-party asset extraction (the packaged level files carry exactly 298
 * `BP_WAT2_C` and 106 `BP_WAT1_C` instances, matching the known world totals).
 */
export const COLLECTIBLE_ACTORS: { kind: CollectibleKind; typePath: RegExp; label: string }[] = [
  { kind: 'mercerSphere', typePath: /BP_WAT2_C/, label: 'Mercer Sphere' },
  { kind: 'somersloop', typePath: /BP_WAT1_C/, label: 'Somersloop' },
  { kind: 'powerSlugPurple', typePath: /BP_Crystal_mk3_C/, label: 'Purple Power Slug' },
  { kind: 'powerSlugYellow', typePath: /BP_Crystal_mk2_C/, label: 'Yellow Power Slug' },
  { kind: 'powerSlugBlue', typePath: /BP_Crystal_C/, label: 'Blue Power Slug' },
];
// Hard-drive crash sites (BP_DropPod_C) are deliberately NOT here: looted pods
// persist as actors (they are world structures, not destroyed pickups) and the
// parser cannot read their looted flag on current builds, so total − remaining
// is unreliable. Hard drives are a game-data v3 (world-locations) concern.

/**
 * Known world totals for a fresh v1.0+ game, used to derive
 * `collected = total − remaining`. Fixed public constants (not from the save);
 * may vary by game version or with mods. Resource nodes are NOT here — the save
 * carries no resource type or purity for them, so they are a game-data v3
 * (world-locations dataset) concern.
 */
export const WORLD_TOTALS: Record<CollectibleKind, number> = {
  mercerSphere: 298,
  somersloop: 106,
  powerSlugBlue: 596,
  powerSlugYellow: 389,
  powerSlugPurple: 257,
};

/**
 * Tuning for streamed-cell detection (used to scope a real "collected" count to
 * the explored area). Each save sublevel is a World-Partition cell; its objects
 * cluster tightly. A cell is a streamed region we can trust the present/absent
 * inference within. `LOOSE_CELL_DIAGONAL` excludes the one outsized level (the
 * persistent level of globally-scattered actors), whose bounding box would
 * otherwise swallow the whole map. `STREAMED_CELL_MARGIN` pads each cell box so a
 * collectible near a sparsely-populated cell's edge still counts. Calibrated
 * against real saves (a 0%-collected save yields ~0 collected; a near-complete
 * one yields ~the full total).
 */
export const LOOSE_CELL_DIAGONAL = 50000;
export const STREAMED_CELL_MARGIN = 2000;
