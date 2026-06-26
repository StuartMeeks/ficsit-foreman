import type { GameData, Ingredient, Recipe } from '@foreman/sf-game-data';
import { type QueryContext, machineForRecipe, round } from '../context.js';
import { rows } from '../run.js';
import type {
  AlternateComparison,
  AlternateComparisonRow,
  IngredientView,
  RecipeView,
} from '../types.js';

function toIngredientViews(ingredients: Ingredient[]): IngredientView[] {
  return ingredients.map((ingredient) => ({
    item: ingredient.displayName,
    itemClassName: ingredient.itemClassName,
    amount: ingredient.amount,
    perMinute: ingredient.perMinute,
    unit: ingredient.unit,
  }));
}

export function toRecipeView(recipe: Recipe): RecipeView {
  const view: RecipeView = {
    className: recipe.className,
    displayName: recipe.displayName,
    isAlternate: recipe.isAlternate,
    craftTime: recipe.craftTime,
    producedIn: recipe.producedIn,
    ingredients: toIngredientViews(recipe.ingredients),
    products: toIngredientViews(recipe.products),
  };
  if (recipe.variablePower !== undefined) {
    view.variablePower = recipe.variablePower;
  }
  return view;
}

export function getRecipe(ctx: QueryContext, name: string): RecipeView | undefined {
  const className = ctx.resolver.resolveRecipe(name);
  if (className === undefined) {
    return undefined;
  }
  const recipe = ctx.gameData.recipes[className];
  return recipe === undefined ? undefined : toRecipeView(recipe);
}

/** Class names of recipes that produce an item, via the PRODUCES edge. */
async function producingRecipeClasses(ctx: QueryContext, itemClassName: string): Promise<string[]> {
  const result = await rows(
    ctx.conn,
    `MATCH (r:Recipe)-[:PRODUCES]->(i:Item {className: $cn}) RETURN r.className AS className`,
    { cn: itemClassName },
  );
  return result.map((row) => String(row['className']));
}

export interface RecipesForResult {
  item: string;
  itemClassName: string;
  recipes: (RecipeView & { isStandard: boolean })[];
}

export async function recipesFor(
  ctx: QueryContext,
  itemName: string,
): Promise<RecipesForResult | undefined> {
  const itemClassName = ctx.resolver.resolveItem(itemName);
  if (itemClassName === undefined) {
    return undefined;
  }
  const classes = await producingRecipeClasses(ctx, itemClassName);
  const views = classes
    .map((className) => ctx.gameData.recipes[className])
    .filter((recipe): recipe is Recipe => recipe !== undefined)
    .map(toRecipeView);

  // The standard recipe is the (alphabetically-first) non-alternate, if any.
  const standardClass = views
    .filter((v) => !v.isAlternate)
    .sort((a, b) => a.className.localeCompare(b.className))[0]?.className;

  return {
    item: ctx.gameData.items[itemClassName]?.displayName ?? itemName,
    itemClassName,
    recipes: views.map((view) => ({ ...view, isStandard: view.className === standardClass })),
  };
}

export async function compareAlternates(
  ctx: QueryContext,
  itemName: string,
): Promise<AlternateComparison | undefined> {
  const itemClassName = ctx.resolver.resolveItem(itemName);
  if (itemClassName === undefined) {
    return undefined;
  }
  const classes = await producingRecipeClasses(ctx, itemClassName);
  const recipeRows: AlternateComparisonRow[] = [];
  for (const className of classes) {
    const recipe = ctx.gameData.recipes[className];
    if (recipe === undefined) {
      continue;
    }
    const product = recipe.products.find((p) => p.itemClassName === itemClassName);
    recipeRows.push({
      recipe: recipe.displayName,
      className: recipe.className,
      isAlternate: recipe.isAlternate,
      machine: machineForRecipe(ctx.gameData, className) ?? null,
      craftTime: recipe.craftTime,
      outputPerMinute: round(product?.perMinute ?? 0),
      ingredients: toIngredientViews(recipe.ingredients),
    });
  }
  recipeRows.sort((a, b) => Number(a.isAlternate) - Number(b.isAlternate));
  return {
    item: ctx.gameData.items[itemClassName]?.displayName ?? itemName,
    itemClassName,
    recipes: recipeRows,
  };
}

export type { GameData };
