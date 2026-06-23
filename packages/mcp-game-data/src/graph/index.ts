import kuzu from 'kuzu';
import type { Connection } from 'kuzu';

import type { GameData, Item, Schematic } from '@foreman/game-data-core';
import type { QueryContext } from './context.js';
import { loadGameData } from './loader.js';
import { Resolver } from './resolve.js';
import { getItem, whatConsumes, type WhatConsumesResult } from './queries/items.js';
import {
  compareAlternates,
  getRecipe,
  recipesFor,
  type RecipesForResult,
} from './queries/recipes.js';
import {
  buildableWith,
  ingredientTree,
  totalRawInputs,
  type BuildableItem,
  type TotalRawInputsResult,
} from './queries/production.js';
import { getSchematic, listSchematics, type SchematicSummary } from './queries/schematics.js';
import {
  getBuilding,
  listPowerGenerators,
  type BuildingView,
  type GeneratorSummary,
} from './queries/buildings.js';
import type { AlternateComparison, IngredientTreeResult, RecipeView } from './types.js';

/** Cypher keywords that mutate data; rejected by `cypherQuery`. */
const MUTATING_KEYWORDS =
  /\b(CREATE|DELETE|SET|MERGE|DROP|DETACH|ALTER|COPY|INSTALL|LOAD|REMOVE)\b/i;

export type CypherResult = { rows: Record<string, unknown>[] } | { error: string };

/**
 * The graph query facade. Holds the Kùzu connection plus the parsed `GameData`,
 * and exposes one method per MCP tool. Relationship and recursive queries hit
 * Kùzu; rich detail objects (full recipes, items, schematics) are served from
 * the in-memory `GameData`, which already has the fully-resolved nested shape.
 */
export class GraphDB implements QueryContext {
  public readonly version: string;
  public readonly resolver: Resolver;

  constructor(
    public readonly conn: Connection,
    public readonly gameData: GameData,
  ) {
    this.version = gameData.version;
    this.resolver = new Resolver(gameData);
  }

  public getItem(name: string): Item | undefined {
    return getItem(this, name);
  }

  public whatConsumes(name: string): Promise<WhatConsumesResult | undefined> {
    return whatConsumes(this, name);
  }

  public getRecipe(name: string): RecipeView | undefined {
    return getRecipe(this, name);
  }

  public recipesFor(name: string): Promise<RecipesForResult | undefined> {
    return recipesFor(this, name);
  }

  public compareAlternates(name: string): Promise<AlternateComparison | undefined> {
    return compareAlternates(this, name);
  }

  public ingredientTree(
    item: string,
    targetPerMinute: number,
    recipeChoices?: Record<string, string>,
  ): Promise<IngredientTreeResult | undefined> {
    return ingredientTree(this, item, targetPerMinute, recipeChoices);
  }

  public totalRawInputs(
    item: string,
    targetPerMinute: number,
  ): Promise<TotalRawInputsResult | undefined> {
    return totalRawInputs(this, item, targetPerMinute);
  }

  public buildableWith(resources: string[]): Promise<BuildableItem[]> {
    return buildableWith(this, resources);
  }

  public listSchematics(tier?: number): SchematicSummary[] {
    return listSchematics(this, tier);
  }

  public getSchematic(name: string): Schematic | undefined {
    return getSchematic(this, name);
  }

  public getBuilding(name: string): BuildingView | undefined {
    return getBuilding(this, name);
  }

  public listPowerGenerators(): GeneratorSummary[] {
    return listPowerGenerators(this);
  }

  /** Guarded read-only escape hatch. Rejects any mutating Cypher keyword. */
  public async cypherQuery(query: string): Promise<CypherResult> {
    if (MUTATING_KEYWORDS.test(query)) {
      return {
        error:
          'Query rejected: only read-only Cypher is permitted (no CREATE/DELETE/SET/MERGE/DROP/…).',
      };
    }
    try {
      const result = await this.conn.query(query);
      const all = await result.getAll();
      result.close();
      return { rows: all };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** Builds an in-memory Kùzu graph from `GameData` and returns the query facade. */
export async function initGraph(gameData: GameData): Promise<GraphDB> {
  const db = new kuzu.Database(':memory:');
  const conn = new kuzu.Connection(db);
  await loadGameData(conn, gameData);
  return new GraphDB(conn, gameData);
}
