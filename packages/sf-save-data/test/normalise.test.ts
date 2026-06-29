import { describe, expect, it } from 'vitest';

import { normaliseSave } from '../src/normalise/index.js';
import { DEFAULT_ADVANCED_GAME_SETTINGS } from '../src/normalise/types.js';
import {
  byteEnumProp,
  enumProp,
  FIXTURE_SAVE,
  floatProp,
  intProp,
  makeSave,
  obj,
  objectProp,
  refArrayProp,
  sortRules,
  vec3,
} from './fixtures/save.js';

const { state } = normaliseSave(FIXTURE_SAVE, '2026-01-01T00:00:00.000Z');

describe('header + version', () => {
  it('detects version from build/save numbers and the session name', () => {
    expect(state.version).toBe('build 999999 (save 60)');
    expect(state.saveName).toBe('Fixture');
  });

  it('surfaces discrete header identity for the host', () => {
    expect(state.sessionName).toBe('Fixture');
    expect(state.buildVersion).toBe(999999);
    expect(state.saveVersion).toBe(60);
    expect(state.playDurationSeconds).toBe(1234);
  });
});

describe('player', () => {
  it('reads location and HUB location from transforms', () => {
    expect(state.player.location).toEqual({ x: 100, y: 200, z: 300 });
    expect(state.player.hubLocation).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('decodes inventory via the mInventory reference and skips empty slots', () => {
    expect(state.player.inventory).toHaveLength(1);
    expect(state.player.inventory[0]).toMatchObject({
      itemClass: 'Desc_IronPlate_C',
      quantity: 50,
    });
  });
});

describe('storage + depot', () => {
  it('extracts containers with their inventories', () => {
    expect(state.storage.containers).toHaveLength(2);
    const coal = state.storage.containers
      .flatMap((c) => c.inventory)
      .find((i) => i.itemClass === 'Desc_Coal_C');
    expect(coal?.quantity).toBe(200);
  });

  it('carries each container instance name (the join key to topology/graph)', () => {
    const names = state.storage.containers.map((c) => c.instanceName).sort();
    expect(names).toEqual([
      'Persistent_Level:PersistentLevel.StoreFar',
      'Persistent_Level:PersistentLevel.StoreNear',
    ]);
  });

  it('decodes the dimensional depot (ItemAmount shape)', () => {
    expect(state.storage.dimensionalDepot).toHaveLength(1);
    expect(state.storage.dimensionalDepot[0]).toMatchObject({
      itemClass: 'Desc_SAMIngot_C',
      quantity: 500,
    });
  });
});

describe('recipes', () => {
  it('classifies standard vs alternate', () => {
    expect(state.recipes).toHaveLength(2);
    const alt = state.recipes.find((r) => r.recipeClass === 'Recipe_Alternate_Wire_1_C');
    const std = state.recipes.find((r) => r.recipeClass === 'Recipe_IngotIron_C');
    expect(alt?.isAlternate).toBe(true);
    expect(std?.isAlternate).toBe(false);
  });
});

describe('milestones + MAM + phase', () => {
  it('classifies tutorial vs tiered milestone', () => {
    const tutorial = state.milestones.find((m) => m.schematicClass === 'Schematic_Tutorial1_C');
    const milestone = state.milestones.find((m) => m.schematicClass === 'Schematic_3-2_C');
    expect(tutorial?.kind).toBe('tutorial');
    expect(milestone).toMatchObject({ kind: 'milestone', tier: 3 });
  });

  it('reads MAM research and the assembly phase number', () => {
    // Raw research-tree class names; humanising/cleaning to "Caterium" is the edge's job.
    expect(state.mamResearch).toEqual(['Research_Caterium_C']);
    expect(state.assemblyPhase?.phase).toBe(2);
    expect(state.assemblyPhase?.current).toBe('GP_Project_Assembly_Phase_2');
  });
});

describe('collectibles', () => {
  it('reads collected-pickup + looted-drop-pod GUIDs from FGScannableSubsystem', () => {
    // mDestroyedPickups: [1,2,3,4] and [5,6,7,8]; mLootedDropPods: [9,10,11,12].
    // Each FGuid renders as 32 uppercase hex chars (four uint32s in file order).
    expect(state.collectedPickupGuids).toEqual([
      '00000001000000020000000300000004',
      '00000005000000060000000700000008',
    ]);
    expect(state.lootedDropPodGuids).toEqual(['000000090000000A0000000B0000000C']);
  });
});

describe('raw class names (no display-name enrichment)', () => {
  it('emits item/building class names only — naming is resolved at the edge', () => {
    // The neutral library no longer carries display names; only the raw classes.
    expect(state.player.inventory[0]).toMatchObject({
      itemClass: 'Desc_IronPlate_C',
      quantity: 50,
    });
    expect(state.player.inventory[0]).not.toHaveProperty('displayName');
    const sam = state.storage.dimensionalDepot.find((i) => i.itemClass === 'Desc_SAMIngot_C');
    expect(sam).not.toHaveProperty('displayName');
  });
});

describe('partial parse', () => {
  it('does not throw on a malformed object and produces no warnings when managers are present', () => {
    expect(state.warnings).toEqual([]);
  });

  it('degrades gracefully (warn-and-skip) on an empty save, never throwing', () => {
    const { state: empty } = normaliseSave({}, '2026-01-01T00:00:00.000Z');
    expect(empty.recipes).toEqual([]);
    expect(empty.player.inventory).toEqual([]);
    expect(empty.topology).toEqual({
      buildables: [],
      edges: [],
      powerCircuits: [],
      splitters: [],
    });
    expect(empty.warnings.length).toBeGreaterThan(0);
  });
});

describe('topology (the connectivity the graph projects)', () => {
  const LVL = 'Persistent_Level:PersistentLevel';
  const CONSTRUCTOR = `${LVL}.Build_ConstructorMk1_C_1`;
  const BELT = `${LVL}.Build_ConveyorBeltMk1_C_1`;
  const T_CONN = '/Script/FactoryGame.FGFactoryConnectionComponent';

  const wired = normaliseSave(
    makeSave({
      objects: [
        obj(
          '/Game/FactoryGame/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C',
          {},
          { instanceName: CONSTRUCTOR, transform: vec3(100, 0, 0) },
        ),
        obj(
          '/Game/FactoryGame/Buildable/Factory/ConveyorBeltMk1/Build_ConveyorBeltMk1.Build_ConveyorBeltMk1_C',
          {},
          { instanceName: BELT, transform: vec3(200, 0, 0) },
        ),
        // Both ends declare the same physical link — the extractor must dedup to one edge.
        obj(
          T_CONN,
          { mConnectedComponent: objectProp(`${BELT}.ConveyorAny0`) },
          {
            instanceName: `${CONSTRUCTOR}.Output0`,
          },
        ),
        obj(
          T_CONN,
          { mConnectedComponent: objectProp(`${CONSTRUCTOR}.Output0`) },
          {
            instanceName: `${BELT}.ConveyorAny0`,
          },
        ),
        // A pre-grouped power circuit.
        obj(
          '/Script/FactoryGame.FGPowerCircuit',
          {
            mCircuitID: { type: 'IntProperty', value: 7 },
            mComponents: refArrayProp([`${CONSTRUCTOR}.PowerInput`]),
          },
          { instanceName: `${LVL}.CircuitSubsystem.FGPowerCircuit_1` },
        ),
      ],
    }),
    '2026-01-01T00:00:00.000Z',
  ).state;

  it('records every Build_ actor as a node (the complete node set)', () => {
    const keys = wired.topology.buildables.map((b) => b.classKey).sort();
    expect(keys).toEqual(['Build_ConstructorMk1_C', 'Build_ConveyorBeltMk1_C']);
  });

  it('resolves a conveyor link to one canonically-ordered, deduped edge', () => {
    expect(wired.topology.edges).toHaveLength(1);
    expect(wired.topology.edges[0]).toMatchObject({
      kind: 'conveyor',
      from: CONSTRUCTOR,
      to: BELT,
      fromConnector: 'Output0',
      toConnector: 'ConveyorAny0',
    });
  });

  it('reads pre-grouped power-circuit membership', () => {
    expect(wired.topology.powerCircuits).toEqual([{ circuitId: 7, members: [CONSTRUCTOR] }]);
  });
});

describe('splitter sort rules (#148)', () => {
  const LVL = 'Persistent_Level:PersistentLevel';
  const FILTER = '/Game/FactoryGame/Resource/FilteringRules';
  const SMART = `${LVL}.Build_ConveyorAttachmentSplitterSmart_C_1`;
  const PROG = `${LVL}.Build_ConveyorAttachmentSplitterProgrammable_C_1`;
  const PLAIN = `${LVL}.Build_ConveyorAttachmentSplitter_C_1`;
  const SMART_CLASS =
    '/Game/FactoryGame/Buildable/Factory/CA_Splitter/Build_ConveyorAttachmentSplitterSmart.Build_ConveyorAttachmentSplitterSmart_C';
  const PROG_CLASS =
    '/Game/FactoryGame/Buildable/Factory/CA_Splitter/Build_ConveyorAttachmentSplitterProgrammable.Build_ConveyorAttachmentSplitterProgrammable_C';
  const PLAIN_CLASS =
    '/Game/FactoryGame/Buildable/Factory/CA_Splitter/Build_ConveyorAttachmentSplitter.Build_ConveyorAttachmentSplitter_C';

  const wired = normaliseSave(
    makeSave({
      objects: [
        obj(
          SMART_CLASS,
          {
            mSortRules: sortRules([
              { itemClass: `${FILTER}/Desc_Wildcard.Desc_Wildcard_C`, output: 0 },
              {
                itemClass: '/Game/FactoryGame/Resource/Parts/Wire/Desc_Wire.Desc_Wire_C',
                output: 1,
              },
              { itemClass: `${FILTER}/Desc_Overflow.Desc_Overflow_C`, output: 2 },
              { itemClass: `${FILTER}/Desc_AnyUndefined.Desc_AnyUndefined_C`, output: 1 },
              { itemClass: `${FILTER}/Desc_None.Desc_None_C`, output: 2 },
            ]),
          },
          { instanceName: SMART, transform: vec3(0, 0, 0) },
        ),
        obj(
          PROG_CLASS,
          {
            mSortRules: sortRules([
              {
                itemClass:
                  '/Game/FactoryGame/Resource/Parts/IronPlate/Desc_IronPlate.Desc_IronPlate_C',
                output: 0,
              },
            ]),
          },
          { instanceName: PROG, transform: vec3(10, 0, 0) },
        ),
        // A plain splitter carries no rules and must not appear in topology.splitters.
        obj(PLAIN_CLASS, {}, { instanceName: PLAIN, transform: vec3(20, 0, 0) }),
      ],
    }),
    '2026-01-01T00:00:00.000Z',
  ).state;

  it('decodes every filter category, keeping the item class only for item rules', () => {
    const smart = wired.topology.splitters.find((s) => s.instanceName === SMART);
    expect(smart).toMatchObject({ classKey: 'Build_ConveyorAttachmentSplitterSmart_C' });
    expect(smart?.rules).toEqual([
      { outputIndex: 0, rule: 'any' },
      { outputIndex: 1, rule: 'item', itemClass: 'Desc_Wire_C' },
      { outputIndex: 2, rule: 'overflow' },
      { outputIndex: 1, rule: 'anyUndefined' },
      { outputIndex: 2, rule: 'none' },
    ]);
  });

  it('records programmable splitters too', () => {
    const prog = wired.topology.splitters.find((s) => s.instanceName === PROG);
    expect(prog?.classKey).toBe('Build_ConveyorAttachmentSplitterProgrammable_C');
    expect(prog?.rules).toEqual([{ outputIndex: 0, rule: 'item', itemClass: 'Desc_IronPlate_C' }]);
  });

  it('does not record plain splitters (they carry no rules)', () => {
    expect(wired.topology.splitters.map((s) => s.instanceName)).not.toContain(PLAIN);
    // …but the plain splitter is still a node in the complete buildable set.
    expect(wired.topology.buildables.map((b) => b.instanceName)).toContain(PLAIN);
  });
});

describe('generators (#68)', () => {
  const LVL = 'Persistent_Level:PersistentLevel';
  const powered = normaliseSave(
    makeSave({
      objects: [
        // A fuel-burning generator: overclocked, with coal loaded.
        obj(
          '/Game/FactoryGame/Buildable/Factory/GeneratorCoal/Build_GeneratorCoal.Build_GeneratorCoal_C',
          {
            mCurrentPotential: floatProp(1.5),
            mCurrentFuelClass: objectProp(
              '/Game/FactoryGame/Resource/RawResources/Coal/Desc_Coal.Desc_Coal_C',
            ),
          },
          { instanceName: `${LVL}.GenCoal_1`, transform: vec3(500, 0, 0) },
        ),
        // Geothermal: no fuel, default clock.
        obj(
          '/Game/FactoryGame/Buildable/Factory/GeneratorGeoThermal/Build_GeneratorGeoThermal.Build_GeneratorGeoThermal_C',
          {},
          { instanceName: `${LVL}.GenGeo_1` },
        ),
      ],
    }),
    '2026-01-01T00:00:00.000Z',
  ).state;

  it('extracts a fuel generator with clock and current fuel', () => {
    const coal = powered.production.generators.find((g) => g.instanceName === `${LVL}.GenCoal_1`);
    expect(coal).toMatchObject({
      buildingClass: 'Build_GeneratorCoal_C',
      clockSpeed: 1.5,
      fuelClass: 'Desc_Coal_C',
      location: { x: 500, y: 0, z: 0 },
    });
  });

  it('extracts geothermal with no fuel and a default clock', () => {
    const geo = powered.production.generators.find((g) => g.instanceName === `${LVL}.GenGeo_1`);
    expect(geo?.buildingClass).toBe('Build_GeneratorGeoThermal_C');
    expect(geo?.clockSpeed).toBe(1);
    expect(geo?.fuelClass).toBeUndefined();
  });

  it('keeps generators separate from producers/extractors', () => {
    expect(powered.production.generators).toHaveLength(2);
    expect(powered.production.producers).toHaveLength(0);
    expect(powered.production.extractors).toHaveLength(0);
    expect(powered.production.batteries).toHaveLength(0);
  });
});

describe('batteries (#148)', () => {
  const LVL = 'Persistent_Level:PersistentLevel';
  const T_BATTERY =
    '/Game/FactoryGame/Buildable/Factory/PowerStorageMk1/Build_PowerStorageMk1.Build_PowerStorageMk1_C';
  const charged = normaliseSave(
    makeSave({
      objects: [
        // A charged Power Storage.
        obj(
          T_BATTERY,
          { mPowerStore: floatProp(73.5) },
          {
            instanceName: `${LVL}.Battery_1`,
            transform: vec3(10, 20, 30),
          },
        ),
        // An empty one — the save omits mPowerStore, so it must default to 0.
        obj(T_BATTERY, {}, { instanceName: `${LVL}.Battery_2` }),
      ],
    }),
    '2026-01-01T00:00:00.000Z',
  ).state;

  it('extracts stored charge, defaulting an absent mPowerStore to 0', () => {
    expect(charged.production.batteries).toEqual([
      {
        instanceName: `${LVL}.Battery_1`,
        buildingClass: 'Build_PowerStorageMk1_C',
        chargeMWh: 73.5,
        location: { x: 10, y: 20, z: 30 },
      },
      {
        instanceName: `${LVL}.Battery_2`,
        buildingClass: 'Build_PowerStorageMk1_C',
        chargeMWh: 0,
        location: undefined,
      },
    ]);
  });

  it('does not classify a battery as a generator/producer', () => {
    expect(charged.production.generators).toHaveLength(0);
    expect(charged.production.producers).toHaveLength(0);
  });
});

describe('advanced game settings (Game Modes, #172)', () => {
  const LVL = 'Persistent_Level:PersistentLevel';
  const GAME_STATE = '/Game/FactoryGame/-Shared/Blueprint/BP_GameState.BP_GameState_C';
  const RES_NODE = '/Game/FactoryGame/Resource/BP_ResourceNode.BP_ResourceNode_C';
  const COAL = '/Game/FactoryGame/Resource/RawResources/Coal/Desc_Coal.Desc_Coal_C';

  it('defaults to a no-op state when no BP_GameState_C is present (pre-1.2/vanilla)', () => {
    // FIXTURE_SAVE carries no game-state actor.
    expect(state.advancedGameSettings).toEqual(DEFAULT_ADVANCED_GAME_SETTINGS);
    expect(state.resourceNodeOverrides).toEqual([]);
  });

  it('parses the six settings and resolved node overrides, matching the ground-truth save', () => {
    const { state: parsed } = normaliseSave(
      makeSave({
        objects: [
          obj(
            GAME_STATE,
            {
              mNodeRandomizationSeed: intProp(2025976192),
              mSpacePartsCostMultiplier: floatProp(10),
              mPartsCostMultiplier: floatProp(1.5),
              mEnergyCostMultiplier: floatProp(2),
              mNodeRandomization: enumProp('ENodeRandomizationMode', 'NRM_Strict'),
              mNodePuritySettings: enumProp('ENodePuritySettings', 'NPS_AllRandom'),
            },
            { instanceName: `${LVL}.BP_GameState_C_1` },
          ),
          obj(
            RES_NODE,
            {
              mResourceClassOverride: objectProp(COAL),
              mPurityOverride: byteEnumProp('EResourcePurity', 'RP_Pure'),
            },
            { instanceName: `${LVL}.BP_ResourceNode620`, transform: vec3(406197, -252989, 3920) },
          ),
        ],
      }),
      '2026-01-01T00:00:00.000Z',
    );

    expect(parsed.advancedGameSettings).toEqual({
      worldSeed: 2025976192,
      spaceElevatorCostMultiplier: 10,
      recipeCostMultiplier: 1.5,
      powerConsumptionMultiplier: 2,
      nodeRandomization: 'Strict',
      nodePuritySettings: 'AllRandom',
    });
    expect(parsed.resourceNodeOverrides).toEqual([
      {
        position: { x: 406197, y: -252989, z: 3920 },
        resourceClass: 'Desc_Coal_C',
        purity: 'pure',
      },
    ]);
  });

  it('defaults each setting independently when only some are non-default', () => {
    const { state: parsed } = normaliseSave(
      makeSave({
        objects: [
          obj(
            GAME_STATE,
            { mEnergyCostMultiplier: floatProp(5) },
            { instanceName: `${LVL}.BP_GameState_C_1` },
          ),
        ],
      }),
      '2026-01-01T00:00:00.000Z',
    );
    expect(parsed.advancedGameSettings).toEqual({
      ...DEFAULT_ADVANCED_GAME_SETTINGS,
      powerConsumptionMultiplier: 5,
    });
    expect(parsed.resourceNodeOverrides).toEqual([]);
  });

  it('normalises the game’s RP_Inpure spelling and other randomisation modes', () => {
    const { state: parsed } = normaliseSave(
      makeSave({
        objects: [
          obj(
            GAME_STATE,
            {
              mNodeRandomization: enumProp('ENodeRandomizationMode', 'NRM_AdvancedRich'),
              mNodePuritySettings: enumProp('ENodePuritySettings', 'NPS_Increase'),
            },
            { instanceName: `${LVL}.BP_GameState_C_1` },
          ),
          obj(
            RES_NODE,
            { mPurityOverride: byteEnumProp('EResourcePurity', 'RP_Inpure') },
            { instanceName: `${LVL}.BP_ResourceNode99` },
          ),
        ],
      }),
      '2026-01-01T00:00:00.000Z',
    );
    expect(parsed.advancedGameSettings.nodeRandomization).toBe('AdvancedRich');
    expect(parsed.advancedGameSettings.nodePuritySettings).toBe('Increase');
    expect(parsed.resourceNodeOverrides).toEqual([
      { position: undefined, resourceClass: undefined, purity: 'impure' },
    ]);
  });
});
