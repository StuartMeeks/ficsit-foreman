import type { IngredientUnit } from '@foreman/game-data-core';
import {
  type QueryContext,
  displayForItem,
  itemByClass,
  machineForRecipe,
  round,
  unitForItem,
} from '../context.js';
import { rows } from '../run.js';
import type { IngredientTreeResult, ProductionComponent, RawInput } from '../types.js';

interface ProducingRecipe {
  className: string;
  displayName: string;
  isAlternate: boolean;
  outputPerMinute: number;
}

interface SubNode {
  recipe?: ProducingRecipe;
  ingredients: { className: string; perMinute: number }[];
}

export interface TotalRawInputsResult {
  item: string;
  itemClassName: string;
  targetPerMinute: number;
  unit: IngredientUnit;
  rawInputs: RawInput[];
  warnings: string[];
}

export interface BuildableItem {
  item: string;
  itemClassName: string;
}

async function producingRecipes(
  ctx: QueryContext,
  itemClassName: string,
): Promise<ProducingRecipe[]> {
  const result = await rows(
    ctx.conn,
    `MATCH (rec:Recipe)-[p:PRODUCES]->(i:Item {className: $cn})
     RETURN rec.className AS className, rec.displayName AS displayName,
            rec.isAlternate AS isAlternate, p.perMinute AS perMinute`,
    { cn: itemClassName },
  );
  return result.map((row) => ({
    className: String(row['className']),
    displayName: String(row['displayName']),
    isAlternate: Boolean(row['isAlternate']),
    outputPerMinute: Number(row['perMinute']),
  }));
}

async function consumesOf(
  ctx: QueryContext,
  recipeClassName: string,
): Promise<{ className: string; perMinute: number }[]> {
  const result = await rows(
    ctx.conn,
    `MATCH (r:Recipe {className: $rc})-[c:CONSUMES]->(i:Item)
     RETURN i.className AS className, c.perMinute AS perMinute`,
    { rc: recipeClassName },
  );
  return result.map((row) => ({
    className: String(row['className']),
    perMinute: Number(row['perMinute']),
  }));
}

function chooseRecipe(
  recipes: ProducingRecipe[],
  itemClassName: string,
  choiceMap: Map<string, string>,
  warnings: string[],
): ProducingRecipe | undefined {
  if (recipes.length === 0) {
    return undefined;
  }
  const override = choiceMap.get(itemClassName);
  if (override !== undefined) {
    const match = recipes.find((r) => r.className === override);
    if (match !== undefined) {
      return match;
    }
    warnings.push(`Recipe '${override}' does not produce '${itemClassName}'; using default.`);
  }
  const byClass = (a: ProducingRecipe, b: ProducingRecipe): number =>
    a.className.localeCompare(b.className);
  const standard = recipes.filter((r) => !r.isAlternate).sort(byClass);
  return standard[0] ?? [...recipes].sort(byClass)[0];
}

/**
 * Flattened per-minute requirements and machine counts for every tier of
 * production. The graph supplies the structure (producing recipes and their
 * consume edges); the weighted multiplicative roll-up — demand multiplies along
 * each edge and sums across shared sub-components — is done here over a
 * topologically-ordered subgraph, which recursive Cypher cannot express cleanly.
 */
export async function ingredientTree(
  ctx: QueryContext,
  itemName: string,
  targetPerMinute: number,
  recipeChoices?: Record<string, string>,
): Promise<IngredientTreeResult | undefined> {
  const targetCn = ctx.resolver.resolveItem(itemName);
  if (targetCn === undefined) {
    return undefined;
  }
  const warnings: string[] = [];

  const choiceMap = new Map<string, string>();
  if (recipeChoices !== undefined) {
    for (const [key, value] of Object.entries(recipeChoices)) {
      const itemKey = ctx.resolver.resolveItem(key) ?? key;
      const recipeValue = ctx.resolver.resolveRecipe(value) ?? value;
      choiceMap.set(itemKey, recipeValue);
    }
  }

  // Build the production subgraph, memoised so shared sub-trees are visited once.
  const nodes = new Map<string, SubNode>();
  const visit = async (cn: string): Promise<void> => {
    if (nodes.has(cn)) {
      return;
    }
    // Raw resources are always leaves. The game has Converter recipes that
    // produce ores (e.g. "Iron Ore (Limestone)"), but players mine ore — so a
    // resource terminates the tree regardless of any recipe that can make it.
    if (itemByClass(ctx.gameData, cn)?.isResource === true) {
      nodes.set(cn, { ingredients: [] });
      return;
    }
    const recipe = chooseRecipe(await producingRecipes(ctx, cn), cn, choiceMap, warnings);
    if (recipe === undefined) {
      nodes.set(cn, { ingredients: [] }); // raw resource / unproduced leaf
      return;
    }
    const node: SubNode = { recipe, ingredients: [] };
    nodes.set(cn, node); // set before recursing — guards against cycles
    const consumes = await consumesOf(ctx, recipe.className);
    node.ingredients = consumes;
    for (const ingredient of consumes) {
      await visit(ingredient.className);
    }
  };
  await visit(targetCn);

  // Topological order, target first. Back-edges (cycles) are reported and broken.
  const order: string[] = [];
  const temp = new Set<string>();
  const perm = new Set<string>();
  const topo = (cn: string): void => {
    if (perm.has(cn)) {
      return;
    }
    if (temp.has(cn)) {
      warnings.push(`Cycle detected at '${displayForItem(ctx.gameData, cn)}'; breaking.`);
      return;
    }
    temp.add(cn);
    for (const ingredient of nodes.get(cn)?.ingredients ?? []) {
      topo(ingredient.className);
    }
    temp.delete(cn);
    perm.add(cn);
    order.push(cn);
  };
  topo(targetCn);
  order.reverse();

  // Propagate demand from the target downwards.
  const demand = new Map<string, number>([[targetCn, targetPerMinute]]);
  const machineCount = new Map<string, number>();
  for (const cn of order) {
    const node = nodes.get(cn);
    const required = demand.get(cn) ?? 0;
    if (node?.recipe !== undefined) {
      const scale = node.recipe.outputPerMinute > 0 ? required / node.recipe.outputPerMinute : 0;
      machineCount.set(cn, (machineCount.get(cn) ?? 0) + scale);
      for (const ingredient of node.ingredients) {
        demand.set(
          ingredient.className,
          (demand.get(ingredient.className) ?? 0) + ingredient.perMinute * scale,
        );
      }
    }
  }

  const components: ProductionComponent[] = [];
  for (const cn of order) {
    if (cn === targetCn) {
      continue;
    }
    const node = nodes.get(cn);
    const component: ProductionComponent = {
      item: displayForItem(ctx.gameData, cn),
      itemClassName: cn,
      perMinute: round(demand.get(cn) ?? 0),
      unit: unitForItem(ctx.gameData, cn),
      isRaw: node?.recipe === undefined,
    };
    if (node?.recipe !== undefined) {
      component.recipe = node.recipe.displayName;
      const machine = machineForRecipe(ctx.gameData, node.recipe.className);
      if (machine !== undefined) {
        component.machine = machine;
      }
      component.machineCount = round(machineCount.get(cn) ?? 0);
    }
    components.push(component);
  }

  const targetNode = nodes.get(targetCn);
  const result: IngredientTreeResult = {
    item: displayForItem(ctx.gameData, targetCn),
    itemClassName: targetCn,
    targetPerMinute,
    unit: unitForItem(ctx.gameData, targetCn),
    recipe: targetNode?.recipe?.displayName ?? '(no recipe — raw item)',
    components,
    warnings,
  };
  if (targetNode?.recipe !== undefined) {
    const machine = machineForRecipe(ctx.gameData, targetNode.recipe.className);
    if (machine !== undefined) {
      result.machine = machine;
    }
    result.machineCount = round(machineCount.get(targetCn) ?? 0);
  }
  return result;
}

/** Leaf raw resources only — what the player actually mines/extracts. */
export async function totalRawInputs(
  ctx: QueryContext,
  itemName: string,
  targetPerMinute: number,
): Promise<TotalRawInputsResult | undefined> {
  const tree = await ingredientTree(ctx, itemName, targetPerMinute);
  if (tree === undefined) {
    return undefined;
  }
  const rawInputs: RawInput[] = tree.components
    .filter((component) => component.isRaw)
    .map((component) => ({
      item: component.item,
      itemClassName: component.itemClassName,
      perMinute: component.perMinute,
      unit: component.unit,
    }));
  return {
    item: tree.item,
    itemClassName: tree.itemClassName,
    targetPerMinute,
    unit: tree.unit,
    rawInputs,
    warnings: tree.warnings,
  };
}

/**
 * Items producible from a set of raw resources. A fixpoint closure over recipe
 * edges fetched from the graph: an item is buildable only when every ingredient
 * of some recipe producing it is already buildable.
 */
export async function buildableWith(
  ctx: QueryContext,
  resourceNames: string[],
): Promise<BuildableItem[]> {
  const available = new Set<string>();
  for (const name of resourceNames) {
    const className = ctx.resolver.resolveItem(name);
    if (className !== undefined) {
      available.add(className);
    }
  }
  const seeds = new Set(available);

  const ingredientRows = await rows(
    ctx.conn,
    `MATCH (r:Recipe)-[:CONSUMES]->(i:Item) RETURN r.className AS recipe, collect(i.className) AS ins`,
  );
  const productRows = await rows(
    ctx.conn,
    `MATCH (r:Recipe)-[:PRODUCES]->(i:Item) RETURN r.className AS recipe, collect(i.className) AS outs`,
  );
  const ingredientsByRecipe = new Map<string, string[]>();
  for (const row of ingredientRows) {
    ingredientsByRecipe.set(String(row['recipe']), (row['ins'] as string[]) ?? []);
  }
  const productsByRecipe = new Map<string, string[]>();
  for (const row of productRows) {
    productsByRecipe.set(String(row['recipe']), (row['outs'] as string[]) ?? []);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [recipe, ingredients] of ingredientsByRecipe) {
      if (!ingredients.every((cn) => available.has(cn))) {
        continue;
      }
      for (const product of productsByRecipe.get(recipe) ?? []) {
        if (!available.has(product)) {
          available.add(product);
          changed = true;
        }
      }
    }
  }

  return [...available]
    .filter((cn) => !seeds.has(cn))
    .map((cn) => ({ item: displayForItem(ctx.gameData, cn), itemClassName: cn }))
    .sort((a, b) => a.item.localeCompare(b.item));
}
