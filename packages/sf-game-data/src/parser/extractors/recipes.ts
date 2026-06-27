import type {
  BuildCostLine,
  Ingredient,
  ItemForm,
  Recipe,
  RawClass,
  VariablePower,
} from '../types.js';
import { getNumber, getString } from '../util.js';
import { extractClassNames } from '@foreman/sf-core';
import { parseItemAmountList, type RawItemAmount } from '../normalise/ingredients.js';
import { perMinute, toDisplayAmount } from '../normalise/fluids.js';

/** Lookups built from already-parsed items, resources and buildings. */
export interface RecipeLookups {
  itemForm: Map<string, ItemForm>;
  itemDisplay: Map<string, string>;
  buildingDisplay: Map<string, string>;
  buildingClasses: Set<string>;
}

/** A build-gun recipe resolved to the building it constructs and its cost. */
export interface BuildRecipe {
  buildingClassName: string;
  cost: BuildCostLine[];
}

export function isBuildGunRecipe(raw: RawClass): boolean {
  return /BuildGun/i.test(getString(raw, 'mProducedIn'));
}

function isAlternateRecipe(className: string, displayName: string): boolean {
  return /Alternate/i.test(className) || /^Alternate/i.test(displayName);
}

function resolveForm(lookups: RecipeLookups, className: string): ItemForm {
  return lookups.itemForm.get(className) ?? 'solid';
}

/**
 * The item's authored display name, or `''` when unknown. The edge humanises the
 * bare class name when no authored name exists (presentation boundary).
 */
function resolveDisplay(lookups: RecipeLookups, className: string): string {
  return lookups.itemDisplay.get(className) ?? '';
}

function mapIngredient(
  rawItem: RawItemAmount,
  craftTime: number,
  lookups: RecipeLookups,
): Ingredient {
  const form = resolveForm(lookups, rawItem.className);
  const { amount, unit } = toDisplayAmount(rawItem.amount, form);
  return {
    itemClassName: rawItem.className,
    displayName: resolveDisplay(lookups, rawItem.className),
    amount,
    perMinute: perMinute(amount, craftTime),
    unit,
  };
}

function resolveVariablePower(raw: RawClass): VariablePower | undefined {
  const constant = getNumber(raw, 'mVariablePowerConsumptionConstant', 0);
  const factor = getNumber(raw, 'mVariablePowerConsumptionFactor', 1);
  if (constant === 0 && factor === 1) {
    return undefined;
  }
  return { min: constant, max: constant + factor };
}

/** Extracts a production recipe. Call only when `isBuildGunRecipe` is false. */
export function extractRecipe(raw: RawClass, lookups: RecipeLookups): Recipe {
  const className = getString(raw, 'ClassName');
  const displayName = getString(raw, 'mDisplayName');
  const craftTime = getNumber(raw, 'mManufactoringDuration', 0);
  const producedInRaw = getString(raw, 'mProducedIn');

  const producedInClasses = extractClassNames(producedInRaw).filter((cn) =>
    lookups.buildingClasses.has(cn),
  );
  const producedIn = producedInClasses.map((cn) => lookups.buildingDisplay.get(cn) ?? cn);

  const recipe: Recipe = {
    className,
    displayName,
    isAlternate: isAlternateRecipe(className, displayName),
    craftTime,
    ingredients: parseItemAmountList(getString(raw, 'mIngredients')).map((item) =>
      mapIngredient(item, craftTime, lookups),
    ),
    products: parseItemAmountList(getString(raw, 'mProduct')).map((item) =>
      mapIngredient(item, craftTime, lookups),
    ),
    producedIn,
    producedInClasses,
    inBuildGun: false,
    inWorkshop: /WorkBench|Workshop/i.test(producedInRaw),
  };

  const variablePower = resolveVariablePower(raw);
  if (variablePower !== undefined) {
    recipe.variablePower = variablePower;
  }
  return recipe;
}

/**
 * Resolves a build-gun recipe to the building it constructs. The docs file does
 * not link the build descriptor to its `FGBuildable` entry, so a name heuristic
 * is used: the product `Desc_X_C` maps to the building `Build_X_C`.
 */
export function extractBuildRecipe(raw: RawClass): BuildRecipe | undefined {
  const products = parseItemAmountList(getString(raw, 'mProduct'));
  const product = products[0];
  if (product === undefined) {
    return undefined;
  }
  const buildingClassName = product.className.replace(/^Desc_/, 'Build_');
  const cost = parseItemAmountList(getString(raw, 'mIngredients')).map(
    (item): BuildCostLine => ({ itemClassName: item.className, amount: item.amount }),
  );
  return { buildingClassName, cost };
}
