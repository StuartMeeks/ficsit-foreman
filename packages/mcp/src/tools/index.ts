import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { GraphDB } from '../graph/index.js';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

/**
 * Registers every Foreman MCP tool. Tool descriptions are tight and
 * model-facing — they appear in the system context on every request. All
 * responses are version-tagged. Tools return computed, distilled answers; the
 * recursion and aggregation happen server-side in the graph layer.
 */
export function registerTools(server: McpServer, graph: GraphDB): void {
  const ok = (payload: object): ToolResult => ({
    content: [{ type: 'text', text: JSON.stringify({ version: graph.version, ...payload }) }],
  });
  const notFound = (what: string): ToolResult => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({ version: graph.version, error: `Not found: ${what}` }),
      },
    ],
    isError: true,
  });

  server.registerTool(
    'get_item',
    {
      title: 'Get item',
      description:
        'Resolve an item by display name or class name. Returns item details including form (solid/liquid/gas) and sink points.',
      inputSchema: { name: z.string() },
    },
    async ({ name }): Promise<ToolResult> => {
      const item = graph.getItem(name);
      return item === undefined ? notFound(`item '${name}'`) : ok({ item });
    },
  );

  server.registerTool(
    'get_recipe',
    {
      title: 'Get recipe',
      description:
        'Resolve a recipe by display name or class name. Returns the full recipe: ingredients, products, machine and per-minute rates.',
      inputSchema: { name: z.string() },
    },
    async ({ name }): Promise<ToolResult> => {
      const recipe = graph.getRecipe(name);
      return recipe === undefined ? notFound(`recipe '${name}'`) : ok({ recipe });
    },
  );

  server.registerTool(
    'recipes_for',
    {
      title: 'Recipes for item',
      description:
        'All recipes that produce the named item, including alternates. Flags which recipe is the standard one.',
      inputSchema: { item: z.string() },
    },
    async ({ item }): Promise<ToolResult> => {
      const result = await graph.recipesFor(item);
      return result === undefined ? notFound(`item '${item}'`) : ok(result);
    },
  );

  server.registerTool(
    'ingredient_tree',
    {
      title: 'Ingredient tree',
      description:
        'Flat list of per-minute requirements and machine counts for every tier of production of an item at a target rate. Does NOT return nested recipe objects — the graph does the recursion and returns the computed answer. Optional recipeChoices maps an item (name or class) to a chosen recipe.',
      inputSchema: {
        item: z.string(),
        targetPerMinute: z.number().positive(),
        recipeChoices: z.record(z.string(), z.string()).optional(),
      },
    },
    async ({ item, targetPerMinute, recipeChoices }): Promise<ToolResult> => {
      const result = await graph.ingredientTree(item, targetPerMinute, recipeChoices);
      return result === undefined ? notFound(`item '${item}'`) : ok({ tree: result });
    },
  );

  server.registerTool(
    'total_raw_inputs',
    {
      title: 'Total raw inputs',
      description:
        'Leaf raw resources only (iron ore, water, crude oil, …) needed to produce an item at a target rate. What the player actually has to mine or extract.',
      inputSchema: { item: z.string(), targetPerMinute: z.number().positive() },
    },
    async ({ item, targetPerMinute }): Promise<ToolResult> => {
      const result = await graph.totalRawInputs(item, targetPerMinute);
      return result === undefined ? notFound(`item '${item}'`) : ok(result);
    },
  );

  server.registerTool(
    'what_consumes',
    {
      title: 'What consumes item',
      description: 'All recipes that use the named item as an ingredient.',
      inputSchema: { item: z.string() },
    },
    async ({ item }): Promise<ToolResult> => {
      const result = await graph.whatConsumes(item);
      return result === undefined ? notFound(`item '${item}'`) : ok(result);
    },
  );

  server.registerTool(
    'compare_alternates',
    {
      title: 'Compare alternate recipes',
      description:
        'Side-by-side cost and throughput comparison for all recipes (standard and alternate) that produce the named item.',
      inputSchema: { item: z.string() },
    },
    async ({ item }): Promise<ToolResult> => {
      const result = await graph.compareAlternates(item);
      return result === undefined ? notFound(`item '${item}'`) : ok(result);
    },
  );

  server.registerTool(
    'buildable_with',
    {
      title: 'Buildable with resources',
      description:
        'Given a list of raw resource names, returns every item producible from them (transitive closure over recipes).',
      inputSchema: { resources: z.array(z.string()).min(1) },
    },
    async ({ resources }): Promise<ToolResult> => {
      const buildable = await graph.buildableWith(resources);
      return ok({ resources, buildable });
    },
  );

  server.registerTool(
    'list_schematics',
    {
      title: 'List schematics',
      description:
        'All schematics (milestones, MAM, AWESOME shop, hard drives), optionally filtered by tier.',
      inputSchema: { tier: z.number().int().min(0).optional() },
    },
    async ({ tier }): Promise<ToolResult> => {
      return ok({ schematics: graph.listSchematics(tier) });
    },
  );

  server.registerTool(
    'get_schematic',
    {
      title: 'Get schematic',
      description:
        'Resolve a schematic by display name or class name. Returns it with its full unlock list.',
      inputSchema: { name: z.string() },
    },
    async ({ name }): Promise<ToolResult> => {
      const schematic = graph.getSchematic(name);
      return schematic === undefined ? notFound(`schematic '${name}'`) : ok({ schematic });
    },
  );

  server.registerTool(
    'cypher_query',
    {
      title: 'Cypher query (read-only)',
      description:
        'Guarded escape hatch. Executes a read-only Cypher query against the Kùzu graph. Rejects any query containing a mutating keyword (CREATE, DELETE, SET, MERGE, DROP, …). Node tables: Item, Recipe, Building, Schematic. Rel tables: PRODUCES, CONSUMES, PRODUCED_IN, BUILD_COST, UNLOCKS_RECIPE, UNLOCKS_BUILDING, UNLOCKS_ITEM.',
      inputSchema: { query: z.string() },
    },
    async ({ query }): Promise<ToolResult> => {
      const result = await graph.cypherQuery(query);
      if ('error' in result) {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ version: graph.version, error: result.error }) },
          ],
          isError: true,
        };
      }
      return ok({ rows: result.rows });
    },
  );
}
