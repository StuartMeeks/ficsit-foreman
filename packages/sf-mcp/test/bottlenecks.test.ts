import type { Building, Recipe, WorldLocations } from '@foreman/sf-game-data';
import { normaliseSave } from '@foreman/sf-save-data';
import { buildSaveGraph } from '@foreman/sf-save-data-graph';
import { describe, expect, it } from 'vitest';

import type { GameDataIndex } from '../src/gameData.js';
import { bottlenecksView } from '../src/query/bottlenecks.js';
import { makeSave, obj, objectProp, vec3 } from '../../sf-save-data/test/fixtures/save.js';

const LVL = 'Persistent_Level:PersistentLevel';
const T_CONSTRUCTOR =
  '/Game/FactoryGame/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C';
const T_MINER =
  '/Game/FactoryGame/Buildable/Factory/MinerMk1/Build_MinerMk1.Build_MinerMk1_C';
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
        obj(T_CONSTRUCTOR, { mCurrentRecipe: objectProp(RECIPE_INGOT) }, { instanceName: CON, transform: vec3(0, 0, 0) }),
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
      resourceNodes: [{ id: 'n1', kind: 'resourceNode', resourceClass: 'Desc_OreIron_C', purity: 'normal', x: 0, y: 0, z: 0 }],
    };
    const save = makeSave({
      objects: [
        obj(T_MINER, {}, { instanceName: MINER, transform: vec3(0, 0, 0) }),
        obj(T_BELT, {}, { instanceName: BELT, transform: vec3(50, 0, 0) }),
        obj(T_CONSTRUCTOR, { mCurrentRecipe: objectProp(RECIPE_INGOT) }, { instanceName: CON, transform: vec3(100, 0, 0) }),
        obj(T_CONN, { mConnectedComponent: objectProp(`${BELT}.ConveyorAny0`) }, { instanceName: `${MINER}.Output0` }),
        obj(T_CONN, { mConnectedComponent: objectProp(`${MINER}.Output0`) }, { instanceName: `${BELT}.ConveyorAny0` }),
        obj(T_CONN, { mConnectedComponent: objectProp(`${CON}.Input0`) }, { instanceName: `${BELT}.ConveyorAny1` }),
        obj(T_CONN, { mConnectedComponent: objectProp(`${BELT}.ConveyorAny1`) }, { instanceName: `${CON}.Input0` }),
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
      resourceNodes: [{ id: 'n1', kind: 'resourceNode', resourceClass: 'Desc_OreIron_C', purity: 'normal', x: 0, y: 0, z: 0 }],
    };
    // A throttled belt that can only carry 15/min — below the recipe's 30/min need.
    const game: GameDataIndex = {
      ...GAME,
      buildings: { ...GAME.buildings, Build_ConveyorBeltMk1_C: { ...GAME.buildings.Build_ConveyorBeltMk1_C, conveyorSpeedPerMin: 15 } as Building },
    };
    const save = makeSave({
      objects: [
        obj(T_MINER, {}, { instanceName: MINER, transform: vec3(0, 0, 0) }),
        obj(T_BELT, {}, { instanceName: BELT, transform: vec3(50, 0, 0) }),
        obj(T_CONSTRUCTOR, { mCurrentRecipe: objectProp(RECIPE_INGOT) }, { instanceName: CON, transform: vec3(100, 0, 0) }),
        obj(T_CONN, { mConnectedComponent: objectProp(`${BELT}.ConveyorAny0`) }, { instanceName: `${MINER}.Output0` }),
        obj(T_CONN, { mConnectedComponent: objectProp(`${MINER}.Output0`) }, { instanceName: `${BELT}.ConveyorAny0` }),
        obj(T_CONN, { mConnectedComponent: objectProp(`${CON}.Input0`) }, { instanceName: `${BELT}.ConveyorAny1` }),
        obj(T_CONN, { mConnectedComponent: objectProp(`${BELT}.ConveyorAny1`) }, { instanceName: `${CON}.Input0` }),
      ],
    });
    const state = normaliseSave(save, '2026-01-01T00:00:00.000Z').state;
    const view = bottlenecksView(state, buildSaveGraph(state), game, world);
    expect(view.summary.starved).toBe(1);
    expect(view.bottlenecks[0]?.detail).toContain('per min');
  });
});
