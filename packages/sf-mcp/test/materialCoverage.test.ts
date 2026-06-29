import type { Building, Recipe, WorldLocations } from '@foreman/sf-game-data';
import { humaniseClassName } from '@foreman/sf-present';
import { normaliseSave } from '@foreman/sf-save-data';
import { describe, expect, it } from 'vitest';

import type { GameDataIndex } from '../src/gameData.js';
import { materialCoverageView } from '../src/query/selectors.js';
import {
  inventoryStacks,
  makeSave,
  obj,
  objectProp,
  vec3,
} from '../../sf-save-data/test/fixtures/save.js';

const LVL = 'Persistent_Level:PersistentLevel';
const CONSTRUCTOR =
  '/Game/FactoryGame/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C';
const STORAGE =
  '/Game/FactoryGame/Buildable/Storage/Build_StorageContainerMk1.Build_StorageContainerMk1_C';
const RECIPE_IRON_PLATE = '/Game/FactoryGame/Recipes/Constructor/Recipe_IronPlate.Recipe_IronPlate_C';
const STORE_INV = `${LVL}.Store_1.StorageInventory`;

// One constructor making Iron Plate (automated) + a storage box holding Copper Sheets (in stock).
const SAVE = makeSave({
  objects: [
    obj(
      CONSTRUCTOR,
      { mCurrentRecipe: objectProp(RECIPE_IRON_PLATE) },
      { instanceName: `${LVL}.Con_1`, transform: vec3(0, 0, 0) },
    ),
    obj(STORAGE, {}, { instanceName: `${LVL}.Store_1`, transform: vec3(10, 0, 0), components: [STORE_INV] }),
    obj(
      '/Script/FactoryGame.FGInventoryComponent',
      { mInventoryStacks: inventoryStacks([{ item: 'Desc_CopperSheet_C', num: 150 }]) },
      { instanceName: STORE_INV },
    ),
  ],
});

const GAME: GameDataIndex = {
  displayNames: new Map([
    ['Recipe_IronPlate_C', 'Iron Plate'],
    ['Desc_IronPlate_C', 'Iron Plate'],
    ['Desc_CopperSheet_C', 'Copper Sheet'],
    ['Build_ConstructorMk1_C', 'Constructor'],
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

const resolve = (className: string): string => GAME.displayNames.get(className) ?? humaniseClassName(className);

describe('materialCoverageView (#62 dependency check)', () => {
  const state = normaliseSave(SAVE, '2026-01-01T00:00:00.000Z').state;
  const view = materialCoverageView(
    state,
    GAME,
    emptyWorld,
    ['Iron Plate', 'Copper Sheet', 'Steel Beam'],
    resolve,
  );
  const byQuery = Object.fromEntries(view.coverage.map((c) => [c.query, c]));

  it('reports an automated item as covered with its production rate', () => {
    expect(byQuery['Iron Plate']).toMatchObject({
      automated: true,
      producedPerMinute: 20,
      machineCount: 1,
      covered: true,
    });
  });

  it('reports a stocked-but-not-produced item as covered via storage', () => {
    expect(byQuery['Copper Sheet']).toMatchObject({
      automated: false,
      producedPerMinute: 0,
      inStock: 150,
      covered: true,
    });
  });

  it('flags an item that is neither produced nor stocked as a gap', () => {
    expect(byQuery['Steel Beam']).toMatchObject({ automated: false, inStock: 0, covered: false });
    expect(view.gaps).toEqual(['Steel Beam']);
  });
});
