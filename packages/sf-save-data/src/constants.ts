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
 * Recipe-running factory machines (Constructor → Manufacturer, Smelter/Foundry,
 * Refinery, Blender, Packager/Unpackager, Particle Accelerator, Converter,
 * Quantum Encoder). All inherit `FGBuildableManufacturer` and carry an
 * `mCurrentRecipe` + `mInputInventory`/`mOutputInventory`. The regex matches the
 * `Build_<Machine>` class-name prefix; Mk variants and the `_C` suffix fall out.
 */
export const MANUFACTURER_BUILDING =
  /Build_(?:Constructor|Assembler|Manufacturer|Smelter|Foundry|OilRefinery|Refinery|Blender|Packager|ParticleAccelerator|Converter|QuantumEncoder|HadronCollider|Encoder)/;

/**
 * Resource extractors (miners, oil + water extractors, fracking). These have no
 * `mCurrentRecipe`; output is the node's resource, rate-scaled by node purity.
 * Water extractors draw from water volumes (no node) and are special-cased to
 * Water in the query layer. Geothermal generators are power, not extraction (#68).
 */
export const EXTRACTOR_BUILDING = /Build_(?:MinerMk\d|OilPump|WaterPump|FrackingExtractor)/;

/** Water extractor — extracts Water from a volume, not a resource node. */
export const WATER_EXTRACTOR = /Build_WaterPump/;
/** The Water item descriptor a water extractor yields. */
export const WATER_ITEM_CLASS = 'Desc_Water_C';

/** The recipe a producing buildable is set to (ObjectProperty → recipe class). */
export const CURRENT_RECIPE_PROP = 'mCurrentRecipe';
/**
 * Clock speed (overclock) as a fraction: 1.0 = 100%, 2.5 = max. Saved only when
 * not at default, so an absent property means 100% (→ default to 1.0).
 */
export const CLOCK_SPEED_PROP = 'mCurrentPotential';
/** Somersloop production amplification (output multiplier; absent → 1.0). */
export const PRODUCTION_BOOST_PROP = 'mCurrentProductionBoost';

/**
 * The subsystem that records exactly which collectibles a pioneer has collected,
 * by GUID: `mDestroyedPickups` (spheres/sloops/slugs) and `mLootedDropPods`
 * (hard-drive pods). Matched against each collectible's GUID in the world-
 * locations dataset for exact, per-actor collected status at any progression —
 * see [[save-game-test-data]]. (The save stores collected collectibles by GUID,
 * not class, and only here — not in the per-level `collectables`/destroyed-actor
 * lists, which proved unreliable.)
 */
export const FG_SCANNABLE_SUBSYSTEM = /FGScannableSubsystem/;
