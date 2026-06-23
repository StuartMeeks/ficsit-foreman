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

export function makeSave(input: {
  objects: RawObject[];
  collectables?: string[];
  header?: RawSave['header'];
}): RawSave {
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
        collectables: (input.collectables ?? []).map(ref),
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

    // A malformed object (properties is not a record) — must be skipped, not throw.
    { typePath: '/Game/Junk/Junk.Junk_C', instanceName: `${LVL}.Junk_1`, properties: 42 },
  ],
  // Collected registry: 3 spheres (WAT1), 2 sloops (WAT2), 4 slugs, 1 drop pod, 1 flora.
  collectables: [
    `${LVL}.BP_WAT11_1`,
    `${LVL}.BP_WAT1_C_UAID_a`,
    `${LVL}.BP_WAT13_2`,
    `${LVL}.BP_WAT2_C_UAID_b`,
    `${LVL}.BP_WAT2_C_UAID_c`,
    `${LVL}.BP_Crystal6_1`,
    `${LVL}.BP_Crystal_mk2_1`,
    `${LVL}.BP_Crystal_mk3_1`,
    `${LVL}.BP_Crystal11_2`,
    `${LVL}.BP_DropPod7`,
    `${LVL}.BP_Shroom_1`,
  ],
});
