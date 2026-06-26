import type { Building, Recipe, WorldLocations } from '@foreman/sf-game-data';
import { describe, expect, it } from 'vitest';

import type { GameDataIndex } from '../src/gameData.js';
import { normaliseSave } from '@foreman/sf-save-data';
import { productionView } from '../src/query/selectors.js';
import { floatProp, makeSave, obj, objectProp, vec3 } from '../../sf-save-data/test/fixtures/save.js';

const LVL = 'Persistent_Level:PersistentLevel';

const CONSTRUCTOR =
  '/Game/FactoryGame/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C';
const MINER = '/Game/FactoryGame/Buildable/Factory/MinerMk1/Build_MinerMk1.Build_MinerMk1_C';
const RECIPE_IRON_PLATE =
  '/Game/FactoryGame/Recipes/Constructor/Recipe_IronPlate.Recipe_IronPlate_C';

/** A constructor configured with a recipe + optional clock; no inventory needed. */
function constructor(
  instance: string,
  opts: { recipe?: string; clock?: number; boost?: number; at: ReturnType<typeof vec3> },
) {
  return obj(
    CONSTRUCTOR,
    {
      ...(opts.recipe === undefined ? {} : { mCurrentRecipe: objectProp(opts.recipe) }),
      ...(opts.clock === undefined ? {} : { mCurrentPotential: floatProp(opts.clock) }),
      ...(opts.boost === undefined ? {} : { mCurrentProductionBoost: floatProp(opts.boost) }),
    },
    { instanceName: `${LVL}.${instance}`, transform: opts.at },
  );
}

const PRODUCTION_SAVE = makeSave({
  objects: [
    constructor('Con_A', { recipe: RECIPE_IRON_PLATE, clock: 1.5, at: vec3(100, 0, 0) }), // 30/min
    constructor('Con_B', { recipe: RECIPE_IRON_PLATE, at: vec3(200, 0, 0) }), // 20/min (default clock)
    obj(MINER, {}, { instanceName: `${LVL}.Miner_1`, transform: vec3(5000, 0, 0) }),
  ],
});

/** A minimal game-data index covering only what these fixtures reference. */
const GAME: GameDataIndex = {
  displayNames: new Map([
    ['Build_ConstructorMk1_C', 'Constructor'],
    ['Build_MinerMk1_C', 'Miner Mk.1'],
    ['Recipe_IronPlate_C', 'Iron Plate'],
    ['Desc_IronPlate_C', 'Iron Plate'],
    ['Desc_OreIron_C', 'Iron Ore'],
  ]),
  recipes: {
    Recipe_IronPlate_C: {
      className: 'Recipe_IronPlate_C',
      displayName: 'Iron Plate',
      isAlternate: false,
      craftTime: 6,
      ingredients: [
        { itemClassName: 'Desc_IronIngot_C', displayName: 'Iron Ingot', amount: 3, perMinute: 30, unit: 'items' },
      ],
      products: [
        { itemClassName: 'Desc_IronPlate_C', displayName: 'Iron Plate', amount: 2, perMinute: 20, unit: 'items' },
      ],
      producedIn: ['Constructor'],
      producedInClasses: ['Build_ConstructorMk1_C'],
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
      displayName: 'Miner Mk.1',
      description: '',
      category: 'extraction',
      powerConsumption: 5,
      extractionRatePerMin: 60,
      buildCost: [],
    } satisfies Building,
  },
};

const WORLD: WorldLocations = {
  gameVersion: 'test',
  build: 0,
  source: 'test',
  counts: {},
  collectibles: [],
  resourceNodes: [
    // Co-located with the miner at (5000,0,0) so it resolves the resource + purity.
    { id: 'n1', kind: 'resourceNode', resourceClass: 'Desc_OreIron_C', purity: 'pure', x: 5000, y: 0, z: 0 },
  ],
  lootPickups: [],
};

const { state } = normaliseSave(PRODUCTION_SAVE, '2026-01-01T00:00:00.000Z', GAME.displayNames);

describe('normalise: production', () => {
  it('extracts producer configuration (recipe, clock, boost, location)', () => {
    expect(state.production.producers).toHaveLength(2);
    const a = state.production.producers.find((p) => p.clockSpeed === 1.5);
    expect(a).toMatchObject({
      buildingClass: 'Build_ConstructorMk1_C',
      recipeClass: 'Recipe_IronPlate_C',
      clockSpeed: 1.5,
      productionBoost: 1, // absent → default 1
      location: { x: 100, y: 0, z: 0 }, // raw cm at this layer
    });
  });

  it('extracts extractors', () => {
    expect(state.production.extractors).toHaveLength(1);
    expect(state.production.extractors[0]?.buildingClass).toBe('Build_MinerMk1_C');
  });
});

describe('productionView (theoretical capacity)', () => {
  const view = productionView(state, GAME, WORLD);

  it('counts machines and totals estimated power', () => {
    expect(view.producerCount).toBe(2);
    expect(view.extractorCount).toBe(1);
    // 4×1.5^1.321928 + 4×1 + 5×1 ≈ 6.8 + 4 + 5.
    expect(view.estimatedPowerMW).toBeCloseTo(4 * 1.5 ** 1.321928 + 4 + 5, 0);
  });

  it('aggregates effective output per item across machines', () => {
    const plate = view.items.find((i) => i.itemClass === 'Desc_IronPlate_C');
    expect(plate).toMatchObject({
      item: 'Iron Plate',
      unit: 'items',
      effectivePerMinute: 50, // 30 (×1.5) + 20 (×1.0)
      machineCount: 2,
    });
    expect(plate?.sources).toEqual([{ label: 'Iron Plate', machineCount: 2, effectivePerMinute: 50 }]);
  });

  it('resolves an extractor resource + purity-scaled rate from its node', () => {
    const ore = view.items.find((i) => i.itemClass === 'Desc_OreIron_C');
    // 60 base × 2 (pure) × 1.0 clock = 120/min.
    expect(ore).toMatchObject({ item: 'Iron Ore', effectivePerMinute: 120, machineCount: 1 });
    expect(ore?.sources[0]?.label).toBe('Miner Mk.1 (pure)');
  });

  it('does not enumerate individual machines without an item filter', () => {
    expect(view.machines).toBeUndefined();
  });

  it('lists individual machines (with locations) when filtered by item', () => {
    const plate = productionView(state, GAME, WORLD, { item: 'plate' });
    expect(plate.items).toHaveLength(1);
    expect(plate.machines).toHaveLength(2);
    const overclocked = plate.machines?.find((m) => m.clockPercent === 150);
    expect(overclocked).toMatchObject({
      building: 'Constructor',
      recipe: 'Iron Plate',
      location: { x: 1, y: 0, z: 0 }, // 100 cm → 1 m
    });
    expect(overclocked?.outputs[0]).toMatchObject({ basePerMinute: 20, effectivePerMinute: 30 });

    const ore = productionView(state, GAME, WORLD, { item: 'ore' });
    expect(ore.machines).toHaveLength(1);
    expect(ore.machines?.[0]).toMatchObject({ resource: 'Iron Ore', purity: 'pure' });
  });
});
