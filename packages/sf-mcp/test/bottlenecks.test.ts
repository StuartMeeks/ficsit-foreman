import type { Building, Recipe, WorldLocations } from '@foreman/sf-game-data';
import { emptySaveState, normaliseSave } from '@foreman/sf-save-data';
import { buildSaveGraph } from '@foreman/sf-save-data-graph';
import { describe, expect, it } from 'vitest';

import type { GameDataIndex } from '../src/gameData.js';
import { bottlenecksView, buildNetwork } from '../src/query/bottlenecks.js';
import { getEffectiveGameData } from '../src/query/effectiveGameData.js';
import { resolveExtraction } from '../src/query/selectors.js';
import {
  makeSave,
  obj,
  objectProp,
  sortRules,
  vec3,
} from '../../sf-save-data/test/fixtures/save.js';

const LVL = 'Persistent_Level:PersistentLevel';
const T_CONSTRUCTOR =
  '/Game/FactoryGame/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C';
const T_MINER = '/Game/FactoryGame/Buildable/Factory/MinerMk1/Build_MinerMk1.Build_MinerMk1_C';
const T_BELT =
  '/Game/FactoryGame/Buildable/Factory/ConveyorBeltMk1/Build_ConveyorBeltMk1.Build_ConveyorBeltMk1_C';
const T_CONN = '/Script/FactoryGame.FGFactoryConnectionComponent';
const RECIPE_INGOT = '/Game/FactoryGame/Recipes/Smelter/Recipe_IngotIron.Recipe_IngotIron_C';

const ingredient = (itemClassName: string, perMinute: number) => ({
  itemClassName,
  displayName: '',
  amount: perMinute,
  perMinute,
  unit: 'items' as const,
});

const GAME: GameDataIndex = {
  displayNames: new Map([
    ['Desc_OreIron_C', 'Iron Ore'],
    ['Desc_IronIngot_C', 'Iron Ingot'],
    ['Build_ConstructorMk1_C', 'Constructor'],
  ]),
  recipes: {
    Recipe_IngotIron_C: {
      className: 'Recipe_IngotIron_C',
      displayName: 'Iron Ingot',
      isAlternate: false,
      craftTime: 2,
      ingredients: [ingredient('Desc_OreIron_C', 30)],
      products: [ingredient('Desc_IronIngot_C', 30)],
      producedIn: [],
      producedInClasses: [],
      inBuildGun: false,
      inWorkshop: false,
    } satisfies Recipe,
  },
  buildings: {
    Build_ConstructorMk1_C: {
      className: 'Build_ConstructorMk1_C',
      displayName: 'Constructor',
      description: '',
      category: 'production',
      powerConsumption: 4,
      buildCost: [],
    } satisfies Building,
    Build_MinerMk1_C: {
      className: 'Build_MinerMk1_C',
      displayName: 'Miner Mk1',
      description: '',
      category: 'production',
      powerConsumption: 5,
      extractionRatePerMin: 60,
      buildCost: [],
    } satisfies Building,
    Build_ConveyorBeltMk1_C: {
      className: 'Build_ConveyorBeltMk1_C',
      displayName: 'Conveyor Belt Mk1',
      description: '',
      category: 'logistics',
      powerConsumption: 0,
      conveyorSpeedPerMin: 60,
      buildCost: [],
    } satisfies Building,
  },
};

const emptyWorld: WorldLocations = {
  gameVersion: 'test',
  build: 0,
  source: 'test',
  counts: {},
  collectibles: [],
  resourceNodes: [],
  lootPickups: [],
};

describe('bottlenecksView (#148/#126)', () => {
  it('flags an unfed producer as starved, and a recipe-less one as idle', () => {
    const CON = `${LVL}.Con_1`;
    const IDLE = `${LVL}.Con_2`;
    const save = makeSave({
      objects: [
        obj(
          T_CONSTRUCTOR,
          { mCurrentRecipe: objectProp(RECIPE_INGOT) },
          { instanceName: CON, transform: vec3(0, 0, 0) },
        ),
        obj(T_CONSTRUCTOR, {}, { instanceName: IDLE, transform: vec3(10, 0, 0) }),
      ],
    });
    const state = normaliseSave(save, '2026-01-01T00:00:00.000Z').state;
    const view = bottlenecksView(state, buildSaveGraph(state), GAME, emptyWorld);

    expect(view.producerCount).toBe(2);
    expect(view.summary.starved).toBe(1);
    expect(view.summary.idle).toBe(1);
    expect(view.summary.ok).toBe(0);
    const starved = view.bottlenecks.find((b) => b.instanceName === CON);
    expect(starved?.verdict).toBe('starved');
    expect(starved?.detail).toContain('Iron Ore');
    expect(view.bottlenecks.find((b) => b.instanceName === IDLE)?.verdict).toBe('idle');
  });

  it('reports a producer fed over a belt from a sufficient extractor as ok', () => {
    const MINER = `${LVL}.Miner_1`;
    const BELT = `${LVL}.Belt_1`;
    const CON = `${LVL}.Con_1`;
    const world: WorldLocations = {
      ...emptyWorld,
      resourceNodes: [
        {
          id: 'n1',
          kind: 'resourceNode',
          resourceClass: 'Desc_OreIron_C',
          purity: 'normal',
          x: 0,
          y: 0,
          z: 0,
        },
      ],
    };
    const save = makeSave({
      objects: [
        obj(T_MINER, {}, { instanceName: MINER, transform: vec3(0, 0, 0) }),
        obj(T_BELT, {}, { instanceName: BELT, transform: vec3(50, 0, 0) }),
        obj(
          T_CONSTRUCTOR,
          { mCurrentRecipe: objectProp(RECIPE_INGOT) },
          { instanceName: CON, transform: vec3(100, 0, 0) },
        ),
        obj(
          T_CONN,
          { mConnectedComponent: objectProp(`${BELT}.ConveyorAny0`) },
          { instanceName: `${MINER}.Output0` },
        ),
        obj(
          T_CONN,
          { mConnectedComponent: objectProp(`${MINER}.Output0`) },
          { instanceName: `${BELT}.ConveyorAny0` },
        ),
        obj(
          T_CONN,
          { mConnectedComponent: objectProp(`${CON}.Input0`) },
          { instanceName: `${BELT}.ConveyorAny1` },
        ),
        obj(
          T_CONN,
          { mConnectedComponent: objectProp(`${BELT}.ConveyorAny1`) },
          { instanceName: `${CON}.Input0` },
        ),
      ],
    });
    const state = normaliseSave(save, '2026-01-01T00:00:00.000Z').state;
    const view = bottlenecksView(state, buildSaveGraph(state), GAME, world);

    // The miner is an extractor, not a producer; only the constructor is counted.
    expect(view.producerCount).toBe(1);
    expect(view.summary.ok).toBe(1);
    expect(view.summary.starved).toBe(0);
    expect(view.bottlenecks).toHaveLength(0);
  });

  it('flags the same producer starved when the belt cannot carry enough', () => {
    const MINER = `${LVL}.Miner_1`;
    const BELT = `${LVL}.Belt_1`;
    const CON = `${LVL}.Con_1`;
    const world: WorldLocations = {
      ...emptyWorld,
      resourceNodes: [
        {
          id: 'n1',
          kind: 'resourceNode',
          resourceClass: 'Desc_OreIron_C',
          purity: 'normal',
          x: 0,
          y: 0,
          z: 0,
        },
      ],
    };
    // A throttled belt that can only carry 15/min — below the recipe's 30/min need.
    const game: GameDataIndex = {
      ...GAME,
      buildings: {
        ...GAME.buildings,
        Build_ConveyorBeltMk1_C: {
          ...GAME.buildings.Build_ConveyorBeltMk1_C,
          conveyorSpeedPerMin: 15,
        } as Building,
      },
    };
    const save = makeSave({
      objects: [
        obj(T_MINER, {}, { instanceName: MINER, transform: vec3(0, 0, 0) }),
        obj(T_BELT, {}, { instanceName: BELT, transform: vec3(50, 0, 0) }),
        obj(
          T_CONSTRUCTOR,
          { mCurrentRecipe: objectProp(RECIPE_INGOT) },
          { instanceName: CON, transform: vec3(100, 0, 0) },
        ),
        obj(
          T_CONN,
          { mConnectedComponent: objectProp(`${BELT}.ConveyorAny0`) },
          { instanceName: `${MINER}.Output0` },
        ),
        obj(
          T_CONN,
          { mConnectedComponent: objectProp(`${MINER}.Output0`) },
          { instanceName: `${BELT}.ConveyorAny0` },
        ),
        obj(
          T_CONN,
          { mConnectedComponent: objectProp(`${CON}.Input0`) },
          { instanceName: `${BELT}.ConveyorAny1` },
        ),
        obj(
          T_CONN,
          { mConnectedComponent: objectProp(`${BELT}.ConveyorAny1`) },
          { instanceName: `${CON}.Input0` },
        ),
      ],
    });
    const state = normaliseSave(save, '2026-01-01T00:00:00.000Z').state;
    const view = bottlenecksView(state, buildSaveGraph(state), game, world);
    expect(view.summary.starved).toBe(1);
    expect(view.bottlenecks[0]?.detail).toContain('per min');
  });
});

describe('buildNetwork — smart-splitter filter routing (#148/#126)', () => {
  const T_SMART =
    '/Game/FactoryGame/Buildable/Factory/CA_Splitter/Build_ConveyorAttachmentSplitterSmart.Build_ConveyorAttachmentSplitterSmart_C';
  const T_BELT2 =
    '/Game/FactoryGame/Buildable/Factory/ConveyorBeltMk1/Build_ConveyorBeltMk1.Build_ConveyorBeltMk1_C';
  const FILTER = '/Game/FactoryGame/Resource/FilteringRules';

  it('maps each output (Output1/2/3 → outputIndex 0/1/2) to its sort-rule filter', () => {
    const SS = `${LVL}.Smart_1`;
    const B1 = `${LVL}.B1`;
    const B2 = `${LVL}.B2`;
    const B3 = `${LVL}.B3`;
    const conn = (owner: string, c: string, peer: string) =>
      obj(T_CONN, { mConnectedComponent: objectProp(peer) }, { instanceName: `${owner}.${c}` });
    const save = makeSave({
      objects: [
        obj(
          T_SMART,
          {
            // idx0 = any (Wildcard), idx1 = overflow, idx2 = item Iron Ore — as in the real save.
            mSortRules: sortRules([
              { itemClass: `${FILTER}/Desc_Wildcard.Desc_Wildcard_C`, output: 0 },
              { itemClass: `${FILTER}/Desc_Overflow.Desc_Overflow_C`, output: 1 },
              {
                itemClass:
                  '/Game/FactoryGame/Resource/RawResources/OreIron/Desc_OreIron.Desc_OreIron_C',
                output: 2,
              },
            ]),
          },
          { instanceName: SS, transform: vec3(0, 0, 0) },
        ),
        obj(T_BELT2, {}, { instanceName: B1, transform: vec3(1, 0, 0) }),
        obj(T_BELT2, {}, { instanceName: B2, transform: vec3(2, 0, 0) }),
        obj(T_BELT2, {}, { instanceName: B3, transform: vec3(3, 0, 0) }),
        conn(SS, 'Output1', `${B1}.ConveyorAny0`),
        conn(B1, 'ConveyorAny0', `${SS}.Output1`),
        conn(SS, 'Output2', `${B2}.ConveyorAny0`),
        conn(B2, 'ConveyorAny0', `${SS}.Output2`),
        conn(SS, 'Output3', `${B3}.ConveyorAny0`),
        conn(B3, 'ConveyorAny0', `${SS}.Output3`),
      ],
    });
    const state = normaliseSave(save, '2026-01-01T00:00:00.000Z').state;
    const game: GameDataIndex = { displayNames: new Map(), recipes: {}, buildings: {} };
    const net = buildNetwork(
      state,
      buildSaveGraph(state),
      getEffectiveGameData(state, game),
      emptyWorld,
    );
    const edge = (to: string) => net.edges.find((e) => e.from === SS && e.to === to);

    // Output1 (idx0, Wildcard) → unrestricted.
    expect(edge(B1)?.allow).toBeUndefined();
    expect(edge(B1)?.overflow).toBeUndefined();
    // Output2 (idx1, Overflow) → overflow output.
    expect(edge(B2)?.overflow).toBe(true);
    // Output3 (idx2, Iron Ore) → allow only iron ore.
    expect(edge(B3)?.allow).toEqual(['Desc_OreIron_C']);
  });
});

describe('bottlenecksView — fluid head lift (#148/#126)', () => {
  const T_WATER = '/Game/FactoryGame/Buildable/Factory/WaterPump/Build_WaterPump.Build_WaterPump_C';
  const T_PUMP =
    '/Game/FactoryGame/Buildable/Factory/PipelinePump/Build_PipelinePumpMk2.Build_PipelinePumpMk2_C';
  const T_PACKAGER = '/Game/FactoryGame/Buildable/Factory/Packager/Build_Packager.Build_Packager_C';
  const T_PIPE_CONN = '/Script/FactoryGame.FGPipeConnectionFactory';
  const RECIPE_PW =
    '/Game/FactoryGame/Recipes/Packager/Recipe_PackagedWater.Recipe_PackagedWater_C';

  // A Packager makes Packaged Water (a SOLID output) from Water — so it consumes fluid and must
  // not credit its own head lift to its supply network.
  const game: GameDataIndex = {
    displayNames: new Map([['Desc_Water_C', 'Water']]),
    recipes: {
      Recipe_PackagedWater_C: {
        className: 'Recipe_PackagedWater_C',
        displayName: 'Packaged Water',
        isAlternate: false,
        craftTime: 1,
        ingredients: [
          {
            itemClassName: 'Desc_Water_C',
            displayName: 'Water',
            amount: 2,
            perMinute: 60,
            unit: 'm³',
          },
        ],
        products: [
          {
            itemClassName: 'Desc_PackagedWater_C',
            displayName: '',
            amount: 2,
            perMinute: 60,
            unit: 'items',
          },
        ],
        producedIn: [],
        producedInClasses: [],
        inBuildGun: false,
        inWorkshop: false,
      } satisfies Recipe,
    },
    buildings: {
      Build_WaterPump_C: {
        className: 'Build_WaterPump_C',
        displayName: 'Water Extractor',
        description: '',
        category: 'production',
        powerConsumption: 20,
        extractionRatePerMin: 120,
        buildCost: [],
      } satisfies Building,
      Build_Packager_C: {
        className: 'Build_Packager_C',
        displayName: 'Packager',
        description: '',
        category: 'production',
        powerConsumption: 10,
        buildCost: [],
      } satisfies Building,
    },
    fluids: new Set(['Desc_Water_C']),
  };
  const pipe = (owner: string, c: string, peer: string) =>
    obj(T_PIPE_CONN, { mConnectedComponent: objectProp(peer) }, { instanceName: `${owner}.${c}` });

  // A water extractor at z=0 piped to a Packager 20 m above it (max water head lift 13 m).
  const scene = (withPump: boolean) => {
    const WP = `${LVL}.Water_1`;
    const PK = `${LVL}.Packager_1`;
    const list = [
      obj(T_WATER, {}, { instanceName: WP, transform: vec3(0, 0, 0) }),
      obj(
        T_PACKAGER,
        { mCurrentRecipe: objectProp(RECIPE_PW) },
        { instanceName: PK, transform: vec3(0, 0, 2000) },
      ),
      pipe(WP, 'PipeOutput0', `${PK}.PipeInput0`),
      pipe(PK, 'PipeInput0', `${WP}.PipeOutput0`),
    ];
    if (withPump) {
      // A Mk2 pump (57 m) at the extractor's level lifts the whole shared network past 20 m.
      const P = `${LVL}.Pump_1`;
      list.push(
        obj(T_PUMP, {}, { instanceName: P, transform: vec3(0, 0, 0) }),
        pipe(WP, 'PipeOutput1', `${P}.PipeInput0`),
        pipe(P, 'PipeInput0', `${WP}.PipeOutput1`),
      );
    }
    return makeSave({ objects: list });
  };

  it('flags a fluid consumer above its network’s head lift as starved (no pump)', () => {
    const state = normaliseSave(scene(false), '2026-01-01T00:00:00.000Z').state;
    const view = bottlenecksView(state, buildSaveGraph(state), game, emptyWorld);
    expect(view.summary.starved).toBe(1);
    const b = view.bottlenecks.find((x) => x.verdict === 'starved');
    expect(b?.detail).toContain('Water');
    expect(b?.detail).toContain('lifted'); // head-lift cause, not a generic shortfall
  });

  it('does not starve it once a pump shares enough head lift across the network', () => {
    const pumpGame: GameDataIndex = {
      ...game,
      buildings: {
        ...game.buildings,
        Build_PipelinePumpMk2_C: {
          className: 'Build_PipelinePumpMk2_C',
          displayName: 'Pipeline Pump Mk.2',
          description: '',
          category: 'logistics',
          powerConsumption: 8,
          buildCost: [],
        } satisfies Building,
      },
    };
    const state = normaliseSave(scene(true), '2026-01-01T00:00:00.000Z').state;
    const view = bottlenecksView(state, buildSaveGraph(state), pumpGame, emptyWorld);
    expect(view.summary.starved).toBe(0); // water now reachable, and supply (120) ≥ demand (60)
  });

  it('rate-starves fluid consumers sharing an under-supplied network (contention)', () => {
    // One extractor (60 m³/min) feeding two Packagers that each need 60 → 120 demand > 60 supply.
    const thinGame: GameDataIndex = {
      ...game,
      buildings: {
        ...game.buildings,
        Build_WaterPump_C: {
          ...game.buildings.Build_WaterPump_C,
          extractionRatePerMin: 60,
        } as Building,
      },
    };
    const WP = `${LVL}.W`;
    const P1 = `${LVL}.P1`;
    const P2 = `${LVL}.P2`;
    const save = makeSave({
      objects: [
        obj(T_WATER, {}, { instanceName: WP, transform: vec3(0, 0, 0) }),
        obj(
          T_PACKAGER,
          { mCurrentRecipe: objectProp(RECIPE_PW) },
          { instanceName: P1, transform: vec3(5, 0, 0) },
        ),
        obj(
          T_PACKAGER,
          { mCurrentRecipe: objectProp(RECIPE_PW) },
          { instanceName: P2, transform: vec3(10, 0, 0) },
        ),
        pipe(WP, 'PipeOutput0', `${P1}.PipeInput0`),
        pipe(P1, 'PipeInput0', `${WP}.PipeOutput0`),
        pipe(WP, 'PipeOutput1', `${P2}.PipeInput0`),
        pipe(P2, 'PipeInput0', `${WP}.PipeOutput1`),
      ],
    });
    const state = normaliseSave(save, '2026-01-01T00:00:00.000Z').state;
    const view = bottlenecksView(state, buildSaveGraph(state), thinGame, emptyWorld);
    expect(view.summary.starved).toBe(2); // both packagers, supply 60 / demand 120
    const b = view.bottlenecks.find((x) => x.verdict === 'starved');
    expect(b?.detail).toContain('30'); // delivered 60 × 0.5
    expect(b?.detail).toContain('per min');
  });
});

describe('1.2 Game Modes overlay (#172)', () => {
  it('recipe parts cost × scales required inputs, not outputs', () => {
    const state = emptySaveState('test', 'test', '2026-01-01T00:00:00.000Z');
    state.advancedGameSettings.recipeCostMultiplier = 1.5;
    const eff = getEffectiveGameData(state, GAME);
    const producer = {
      instanceName: 'p',
      buildingClass: 'Build_ConstructorMk1_C',
      recipeClass: 'Recipe_IngotIron_C',
      clockSpeed: 1,
      productionBoost: 1,
    };
    expect(eff.requiredInputs(producer)).toEqual({ Desc_OreIron_C: 45 }); // 30 × 1.5
    expect(eff.producerOutputs(producer)).toEqual({ Desc_IronIngot_C: 30 }); // outputs unaffected
  });

  it('a node-randomisation override takes precedence over the canonical world node', () => {
    const world: WorldLocations = {
      ...emptyWorld,
      resourceNodes: [
        {
          id: 'n1',
          kind: 'resourceNode',
          resourceClass: 'Desc_OreIron_C',
          purity: 'normal',
          x: 0,
          y: 0,
          z: 0,
        },
      ],
    };
    const line = {
      instanceName: 'e',
      buildingClass: 'Build_MinerMk1_C',
      clockSpeed: 1,
      productionBoost: 1,
      location: { x: 0, y: 0, z: 0 },
    };
    // Override wins: copper + pure (purityMul 2), not the canonical iron/normal.
    expect(
      resolveExtraction(line, world, [
        { position: { x: 0, y: 0, z: 0 }, resourceClass: 'Desc_OreCopper_C', purity: 'pure' },
      ]),
    ).toMatchObject({ resourceClass: 'Desc_OreCopper_C', purity: 'pure', purityMul: 2 });
    // No override: falls back to the canonical world node.
    expect(resolveExtraction(line, world)).toMatchObject({
      resourceClass: 'Desc_OreIron_C',
      purity: 'normal',
      purityMul: 1,
    });
  });
});
