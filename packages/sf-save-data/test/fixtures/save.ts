/**
 * Hand-crafted save fixture shaped like the adopted parser's output (the v4.1
 * tagged-property model), small enough to reason about. The real `.sav` files
 * are never used in tests — they are for `npm run inspect` only. Property values
 * mirror the real shapes confirmed against actual saves: InventoryStack
 * (`Item.value.itemReference.pathName` + `NumItems.value`), ItemAmount
 * (`ItemClass.value.pathName` + `Amount.value`), ObjectProperty (`value.pathName`)
 * and ArrayProperty (`values`).
 */
import type { RawObject, RawSave } from '../../src/parser/types.js';

const LVL = 'Persistent_Level:PersistentLevel';

// Collectible / resource-node actor typePaths (the clean class form the save uses).
const WAT1 = '/Game/FactoryGame/Prototype/WAT/BP_WAT1.BP_WAT1_C';
const WAT2 = '/Game/FactoryGame/Prototype/WAT/BP_WAT2.BP_WAT2_C';
const CRYSTAL = '/Game/FactoryGame/Resource/Environment/Crystal/BP_Crystal.BP_Crystal_C';
const CRYSTAL_MK2 = '/Game/FactoryGame/Resource/Environment/Crystal/BP_Crystal_mk2.BP_Crystal_mk2_C';
const CRYSTAL_MK3 = '/Game/FactoryGame/Resource/Environment/Crystal/BP_Crystal_mk3.BP_Crystal_mk3_C';
const DROP_POD = '/Game/FactoryGame/World/Benefit/DropPod/BP_DropPod.BP_DropPod_C';
const RESOURCE_DEPOSIT = '/Game/FactoryGame/Resource/BP_ResourceDeposit.BP_ResourceDeposit_C';

export function vec3(x: number, y: number, z: number): { translation: { x: number; y: number; z: number } } {
  return { translation: { x, y, z } };
}

function ref(pathName: string): { levelName: string; pathName: string } {
  return { levelName: '', pathName };
}

/** An ObjectProperty wrapper. */
export function objectProp(pathName: string): unknown {
  return { type: 'ObjectProperty', value: ref(pathName) };
}

/** A FloatProperty wrapper (e.g. mCurrentPotential, mCurrentProductionBoost). */
export function floatProp(value: number): unknown {
  return { type: 'FloatProperty', value };
}

/** An ArrayProperty of ObjectProperty references. */
export function refArrayProp(pathNames: string[]): unknown {
  return { type: 'ArrayProperty', values: pathNames.map(ref) };
}

/** An mInventoryStacks ArrayProperty of InventoryStack structs. */
export function inventoryStacks(items: { item: string; num: number }[]): unknown {
  return {
    type: 'ArrayProperty',
    values: items.map(({ item, num }) => ({
      type: 'InventoryStack',
      properties: {
        Item: { type: 'StructProperty', value: { itemReference: ref(item) } },
        NumItems: { type: 'IntProperty', value: num },
      },
    })),
  };
}

/** An `mSortRules` ArrayProperty of `SplitterSortRule` structs (the smart-splitter shape). */
export function sortRules(rules: { itemClass: string; output: number }[]): unknown {
  return {
    type: 'ArrayProperty',
    values: rules.map(({ itemClass, output }) => ({
      type: 'SplitterSortRule',
      properties: {
        ItemClass: { type: 'ObjectProperty', value: ref(itemClass) },
        OutputIndex: { type: 'IntProperty', value: output },
      },
    })),
  };
}

/** A SetProperty of FGuid structs (each a 4×uint32 array), as FGScannableSubsystem stores. */
export function guidSetProp(guids: number[][]): unknown {
  return { type: 'SetProperty', values: guids };
}

/** An mStoredItems ArrayProperty of ItemAmount structs (the depot shape). */
export function itemAmounts(items: { item: string; amount: number }[]): unknown {
  return {
    type: 'ArrayProperty',
    values: items.map(({ item, amount }) => ({
      type: 'ItemAmount',
      properties: {
        ItemClass: { type: 'ObjectProperty', value: ref(item) },
        Amount: { type: 'IntProperty', value: amount },
      },
    })),
  };
}

interface ObjOpts {
  instanceName?: string;
  transform?: { translation: { x: number; y: number; z: number } };
  components?: string[];
}

export function obj(typePath: string, properties: Record<string, unknown>, opts: ObjOpts = {}): RawObject {
  return {
    typePath,
    instanceName: opts.instanceName ?? `${LVL}.${typePath.split('.').pop() ?? 'X'}_1`,
    type: 'SaveEntity',
    properties,
    ...(opts.transform === undefined ? {} : { transform: opts.transform }),
    ...(opts.components === undefined ? {} : { components: opts.components.map(ref) }),
  };
}

export function makeSave(input: { objects: RawObject[]; header?: RawSave['header'] }): RawSave {
  return {
    header: input.header ?? {
      buildVersion: 999999,
      saveVersion: 60,
      sessionName: 'Fixture',
      playDurationSeconds: 1234,
    },
    levels: {
      Persistent_Level: {
        name: 'Persistent_Level',
        objects: input.objects,
      },
    },
  };
}

const PLAYER_INV = `${LVL}.Char_Player_C_1.Inventory`;
const STORE_NEAR_INV = `${LVL}.StoreNear.StorageInventory`;
const STORE_FAR_INV = `${LVL}.StoreFar.StorageInventory`;

/** A representative save exercising every normalise path. */
export const FIXTURE_SAVE: RawSave = makeSave({
  objects: [
    // Player + its inventory component (Cable has 0 → must be skipped).
    obj(
      '/Game/FactoryGame/Character/Player/Char_Player.Char_Player_C',
      { mInventory: objectProp(PLAYER_INV) },
      { instanceName: `${LVL}.Char_Player_C_1`, transform: vec3(100, 200, 300), components: [PLAYER_INV] },
    ),
    obj(
      '/Script/FactoryGame.FGInventoryComponent',
      {
        mInventoryStacks: inventoryStacks([
          { item: '/Game/FactoryGame/Resource/Parts/IronPlate/Desc_IronPlate.Desc_IronPlate_C', num: 50 },
          { item: '/Game/FactoryGame/Resource/Parts/Cable/Desc_Cable.Desc_Cable_C', num: 0 },
        ]),
      },
      { instanceName: PLAYER_INV },
    ),

    // HUB.
    obj('/Game/FactoryGame/Buildable/Factory/TradingPost/Build_TradingPost.Build_TradingPost_C', {}, {
      instanceName: `${LVL}.Hub_1`,
      transform: vec3(0, 0, 0),
    }),

    // Two storage containers at different distances, each with an inventory component.
    obj('/Game/FactoryGame/Buildable/Storage/Build_StorageContainerMk1.Build_StorageContainerMk1_C', {}, {
      instanceName: `${LVL}.StoreNear`,
      transform: vec3(10, 0, 0),
      components: [STORE_NEAR_INV],
    }),
    obj(
      '/Script/FactoryGame.FGInventoryComponent',
      { mInventoryStacks: inventoryStacks([{ item: 'Desc_Coal_C', num: 200 }]) },
      { instanceName: STORE_NEAR_INV },
    ),
    obj('/Game/FactoryGame/Buildable/Storage/Build_StorageContainerMk2.Build_StorageContainerMk2_C', {}, {
      instanceName: `${LVL}.StoreFar`,
      transform: vec3(1000, 0, 0),
      components: [STORE_FAR_INV],
    }),
    obj(
      '/Script/FactoryGame.FGInventoryComponent',
      { mInventoryStacks: inventoryStacks([{ item: 'Desc_Wire_C', num: 100 }]) },
      { instanceName: STORE_FAR_INV },
    ),

    // Dimensional depot.
    obj(
      '/Script/FactoryGame.FGCentralStorageSubsystem',
      { mStoredItems: itemAmounts([{ item: 'Desc_SAMIngot_C', amount: 500 }]) },
      { instanceName: `${LVL}.CentralStorageSubsystem` },
    ),

    // Recipe manager: one standard + one alternate.
    obj(
      '/Script/FactoryGame.FGRecipeManager',
      {
        mAvailableRecipes: refArrayProp([
          '/Game/FactoryGame/Recipes/Smelter/Recipe_IngotIron.Recipe_IngotIron_C',
          '/Game/FactoryGame/Recipes/Alternate/Recipe_Alternate_Wire_1.Recipe_Alternate_Wire_1_C',
        ]),
      },
      { instanceName: `${LVL}.RecipeManager` },
    ),

    // Schematic manager: a tutorial and a tier-3 milestone.
    obj(
      '/Game/FactoryGame/Schematics/Progression/BP_SchematicManager.BP_SchematicManager_C',
      {
        mPurchasedSchematics: refArrayProp([
          '/Game/FactoryGame/Schematics/Tutorial/Schematic_Tutorial1.Schematic_Tutorial1_C',
          '/Game/FactoryGame/Schematics/Progression/Schematic_3-2.Schematic_3-2_C',
        ]),
      },
      { instanceName: `${LVL}.SchematicManager` },
    ),

    // MAM research manager.
    obj(
      '/Game/FactoryGame/Recipes/Research/BP_ResearchManager.BP_ResearchManager_C',
      { mUnlockedResearchTrees: refArrayProp(['/Game/FactoryGame/Research/Research_Caterium.Research_Caterium_C']) },
      { instanceName: `${LVL}.ResearchManager` },
    ),

    // Game-phase manager: current phase 2, target 3.
    obj(
      '/Game/FactoryGame/Schematics/Progression/BP_GamePhaseManager.BP_GamePhaseManager_C',
      {
        mCurrentGamePhase: objectProp('/Game/FactoryGame/GamePhases/GP_Project_Assembly_Phase_2.GP_Project_Assembly_Phase_2'),
        mTargetGamePhase: objectProp('/Game/FactoryGame/GamePhases/GP_Project_Assembly_Phase_3.GP_Project_Assembly_Phase_3'),
      },
      { instanceName: `${LVL}.GamePhaseManager` },
    ),

    // Scannable subsystem: the collected-collectible record. Two collected
    // pickups (spheres/slugs) and one looted drop pod, by GUID (4×uint32 each).
    obj(
      '/Script/FactoryGame.FGScannableSubsystem',
      {
        mDestroyedPickups: guidSetProp([
          [1, 2, 3, 4],
          [5, 6, 7, 8],
        ]),
        mLootedDropPods: guidSetProp([[9, 10, 11, 12]]),
      },
      { instanceName: `${LVL}.ScannableSubsystem` },
    ),

    // A malformed object (properties is not a record) — must be skipped, not throw.
    { typePath: '/Game/Junk/Junk.Junk_C', instanceName: `${LVL}.Junk_1`, properties: 42 },

    // Remaining (un-collected) collectibles — present actors classified by typePath,
    // placed along +x at increasing distance from the origin for proximity tests:
    // 2 Mercer Spheres, 1 Somersloop, 3 blue + 1 yellow + 1 purple slug.
    obj(WAT2, {}, { instanceName: `${LVL}.WAT2_a`, transform: vec3(50, 0, 0) }),
    obj(WAT2, {}, { instanceName: `${LVL}.WAT2_b`, transform: vec3(5000, 0, 0) }),
    obj(WAT1, {}, { instanceName: `${LVL}.WAT1_a`, transform: vec3(100, 0, 0) }),
    obj(CRYSTAL, {}, { instanceName: `${LVL}.Crystal_a`, transform: vec3(200, 0, 0) }),
    obj(CRYSTAL, {}, { instanceName: `${LVL}.Crystal_b`, transform: vec3(300, 0, 0) }),
    obj(CRYSTAL, {}, { instanceName: `${LVL}.Crystal_c`, transform: vec3(400, 0, 0) }),
    obj(CRYSTAL_MK2, {}, { instanceName: `${LVL}.CrystalY`, transform: vec3(250, 0, 0) }),
    obj(CRYSTAL_MK3, {}, { instanceName: `${LVL}.CrystalP`, transform: vec3(260, 0, 0) }),

    // Excluded by design: hard-drive drop pod (looted state unreliable) and the
    // transient resource deposit. Neither must appear in progress or nearby.
    obj(DROP_POD, {}, { instanceName: `${LVL}.DropPod_1`, transform: vec3(60, 0, 0) }),
    obj(RESOURCE_DEPOSIT, {}, { instanceName: `${LVL}.Deposit_1`, transform: vec3(70, 0, 0) }),
  ],
});
