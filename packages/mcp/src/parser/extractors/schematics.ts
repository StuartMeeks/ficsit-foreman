import type { Ingredient, ItemForm, RawClass, Schematic, SchematicType } from '../types.js';
import { getNumber, getString, isRecord } from '../util.js';
import { extractClassNames, humaniseClassName } from '../normalise/classRef.js';
import { parseItemAmountList } from '../normalise/ingredients.js';
import { toDisplayAmount } from '../normalise/fluids.js';

/** Lookups built from already-parsed items, recipes and buildings. */
export interface SchematicLookups {
  itemForm: Map<string, ItemForm>;
  itemDisplay: Map<string, string>;
  itemClasses: Set<string>;
  productionRecipeClasses: Set<string>;
  /** Build-gun recipe class name → building class name it constructs. */
  buildRecipeToBuilding: Map<string, string>;
}

const TYPE_MAP: Record<string, SchematicType> = {
  EST_Milestone: 'milestone',
  EST_MAM: 'mam',
  EST_ResourceSink: 'awesome_shop',
  EST_HardDrive: 'hard_drive',
  EST_Alternate: 'hard_drive',
  EST_Tutorial: 'tutorial',
};

function mapType(raw: string): SchematicType {
  return TYPE_MAP[raw] ?? 'other';
}

/** Cost lines carry no production rate, so perMinute is 0. */
function mapCost(raw: string, lookups: SchematicLookups): Ingredient[] {
  return parseItemAmountList(raw).map((item): Ingredient => {
    const form = lookups.itemForm.get(item.className) ?? 'solid';
    const { amount, unit } = toDisplayAmount(item.amount, form);
    return {
      itemClassName: item.className,
      displayName: lookups.itemDisplay.get(item.className) ?? humaniseClassName(item.className),
      amount,
      perMinute: 0,
      unit,
    };
  });
}

function collectUnlockField(unlock: Record<string, unknown>, field: string): string[] {
  const value = unlock[field];
  return typeof value === 'string' ? extractClassNames(value) : [];
}

export function extractSchematic(raw: RawClass, lookups: SchematicLookups): Schematic {
  const className = getString(raw, 'ClassName');

  const unlocksRecipes: string[] = [];
  const unlocksBuildings: string[] = [];
  const unlocksItems: string[] = [];

  const rawUnlocks = raw['mUnlocks'];
  if (Array.isArray(rawUnlocks)) {
    for (const unlock of rawUnlocks) {
      if (!isRecord(unlock)) {
        continue;
      }
      // Recipes (and blueprint recipes) unlock either a production recipe or,
      // when the recipe is a build-gun recipe, a building.
      for (const recipeClass of [
        ...collectUnlockField(unlock, 'mRecipes'),
        ...collectUnlockField(unlock, 'mBlueprints'),
      ]) {
        if (lookups.productionRecipeClasses.has(recipeClass)) {
          unlocksRecipes.push(recipeClass);
        } else {
          const building = lookups.buildRecipeToBuilding.get(recipeClass);
          if (building !== undefined) {
            unlocksBuildings.push(building);
          }
        }
      }
      // Items granted or unlocked directly.
      for (const itemClass of [
        ...collectUnlockField(unlock, 'mItemDescriptors'),
        ...collectUnlockField(unlock, 'mItemsToGive'),
      ]) {
        if (lookups.itemClasses.has(itemClass)) {
          unlocksItems.push(itemClass);
        }
      }
    }
  }

  return {
    className,
    displayName: getString(raw, 'mDisplayName') || humaniseClassName(className),
    type: mapType(getString(raw, 'mType')),
    tier: getNumber(raw, 'mTechTier', 0),
    cost: mapCost(getString(raw, 'mCost'), lookups),
    unlocksRecipes: dedupe(unlocksRecipes),
    unlocksBuildings: dedupe(unlocksBuildings),
    unlocksItems: dedupe(unlocksItems),
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
