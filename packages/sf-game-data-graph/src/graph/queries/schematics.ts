import type { Schematic } from '@foreman/sf-game-data';
import type { QueryContext } from '../context.js';

export interface SchematicSummary {
  className: string;
  displayName: string;
  type: Schematic['type'];
  tier: number;
  unlocks: { recipes: number; buildings: number; items: number };
}

function summarise(schematic: Schematic): SchematicSummary {
  return {
    className: schematic.className,
    displayName: schematic.displayName,
    type: schematic.type,
    tier: schematic.tier,
    unlocks: {
      recipes: schematic.unlocksRecipes.length,
      buildings: schematic.unlocksBuildings.length,
      items: schematic.unlocksItems.length,
    },
  };
}

/** All milestones/MAM nodes etc., optionally filtered to a single tier. */
export function listSchematics(ctx: QueryContext, tier?: number): SchematicSummary[] {
  return Object.values(ctx.gameData.schematics)
    .filter((schematic) => tier === undefined || schematic.tier === tier)
    .map(summarise)
    .sort((a, b) => a.tier - b.tier || a.displayName.localeCompare(b.displayName));
}

/** A single schematic with its full unlock list, display names resolved. */
export function getSchematic(ctx: QueryContext, name: string): Schematic | undefined {
  const className = ctx.resolver.resolveSchematic(name);
  if (className === undefined) {
    return undefined;
  }
  return ctx.gameData.schematics[className];
}
