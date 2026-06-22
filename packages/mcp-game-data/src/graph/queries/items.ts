import type { Item } from '../../parser/types.js';
import { type QueryContext, itemByClass } from '../context.js';
import { rows } from '../run.js';

export function getItem(ctx: QueryContext, name: string): Item | undefined {
  const className = ctx.resolver.resolveItem(name);
  if (className === undefined) {
    return undefined;
  }
  return itemByClass(ctx.gameData, className);
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
