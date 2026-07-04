import type { Item } from '@foreman/sf-game-data';
import { type QueryContext, itemByClass } from '../context.js';
import { rows } from '../run.js';

export function getItem(ctx: QueryContext, name: string): Item | undefined {
  const className = ctx.resolver.resolveItem(name);
  if (className === undefined) {
    return undefined;
  }
  return itemByClass(ctx.gameData, className);
}

/** A compact item entry for name discovery (no recipe/stack detail). */
export interface ItemSummary {
  className: string;
  displayName: string;
}

/**
 * Every real, named item and resource as a compact `{ className, displayName }`
 * entry — the foreman's way to discover canonical item names before naming one in
 * a work order (item/resource references resolve through the same set). Excludes
 * dataless descriptors (empty display name). Optionally narrows by a
 * case-insensitive `search` substring matched against display name and class name.
 */
export function listItems(ctx: QueryContext, opts?: { search?: string }): ItemSummary[] {
  const search = opts?.search?.trim().toLowerCase();
  const seen = new Set<string>();
  const results: ItemSummary[] = [];
  for (const item of [
    ...Object.values(ctx.gameData.items),
    ...Object.values(ctx.gameData.resources),
  ]) {
    if (item.displayName === '' || seen.has(item.className)) {
      continue;
    }
    if (search !== undefined && search !== '') {
      const haystack = `${item.displayName} ${item.className}`.toLowerCase();
      if (!haystack.includes(search)) {
        continue;
      }
    }
    seen.add(item.className);
    results.push({ className: item.className, displayName: item.displayName });
  }
  return results.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export interface ConsumingRecipe {
  recipe: string;
  className: string;
  isAlternate: boolean;
  perMinute: number;
}

export interface WhatConsumesResult {
  item: string;
  itemClassName: string;
  consumedBy: ConsumingRecipe[];
}

/** All recipes that use an item as an ingredient, via the CONSUMES edge. */
export async function whatConsumes(
  ctx: QueryContext,
  name: string,
): Promise<WhatConsumesResult | undefined> {
  const itemClassName = ctx.resolver.resolveItem(name);
  if (itemClassName === undefined) {
    return undefined;
  }
  const result = await rows(
    ctx.conn,
    `MATCH (r:Recipe)-[c:CONSUMES]->(i:Item {className: $cn})
     RETURN r.className AS className, r.displayName AS displayName,
            r.isAlternate AS isAlternate, c.perMinute AS perMinute
     ORDER BY displayName`,
    { cn: itemClassName },
  );
  return {
    item: itemByClass(ctx.gameData, itemClassName)?.displayName ?? name,
    itemClassName,
    consumedBy: result.map((row) => ({
      recipe: String(row['displayName']),
      className: String(row['className']),
      isAlternate: Boolean(row['isAlternate']),
      perMinute: Number(row['perMinute']),
    })),
  };
}
