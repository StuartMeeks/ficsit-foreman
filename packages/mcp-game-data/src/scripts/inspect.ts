/**
 * Developer CLI for exercising the tools against a real (or fixture) docs file
 * without an MCP client. Unlike the server, this prints to stdout.
 *
 *   npm run inspect                              # summary + tool list
 *   npm run inspect get_item '{"name":"Iron Plate"}'
 *   npm run inspect ingredient_tree '{"item":"Turbo Motor","targetPerMinute":1}'
 *   npm run inspect total_raw_inputs '{"item":"Reinforced Iron Plate","targetPerMinute":5}'
 */
import { emptyGameData, parseDocsFile } from '@foreman/game-data-core';
import { initGraph } from '../graph/index.js';
import { resolveDocsPath } from '@foreman/game-data-core';

async function run(): Promise<void> {
  const tool = process.argv[2];
  const argJson = process.argv[3];
  const args: Record<string, unknown> = argJson === undefined ? {} : JSON.parse(argJson);

  const { path: docsPath, warning } = resolveDocsPath();
  if (warning !== undefined) {
    console.error(warning);
  }
  const gameData =
    docsPath === undefined ? emptyGameData('unknown') : parseDocsFile(docsPath).gameData;
  const graph = await initGraph(gameData);

  const str = (key: string): string => String(args[key] ?? '');
  const num = (key: string): number => Number(args[key] ?? 0);

  let result: unknown;
  switch (tool) {
    case 'get_item':
      result = graph.getItem(str('name'));
      break;
    case 'get_recipe':
      result = graph.getRecipe(str('name'));
      break;
    case 'recipes_for':
      result = await graph.recipesFor(str('item'));
      break;
    case 'ingredient_tree':
      result = await graph.ingredientTree(
        str('item'),
        num('targetPerMinute'),
        args['recipeChoices'] as Record<string, string> | undefined,
      );
      break;
    case 'total_raw_inputs':
      result = await graph.totalRawInputs(str('item'), num('targetPerMinute'));
      break;
    case 'what_consumes':
      result = await graph.whatConsumes(str('item'));
      break;
    case 'compare_alternates':
      result = await graph.compareAlternates(str('item'));
      break;
    case 'buildable_with':
      result = await graph.buildableWith((args['resources'] as string[]) ?? []);
      break;
    case 'list_schematics':
      result = graph.listSchematics(args['tier'] === undefined ? undefined : num('tier'));
      break;
    case 'get_schematic':
      result = graph.getSchematic(str('name'));
      break;
    case 'get_building':
      result = graph.getBuilding(str('name'));
      break;
    case 'list_power_generators':
      result = graph.listPowerGenerators();
      break;
    case 'cypher_query':
      result = await graph.cypherQuery(str('query'));
      break;
    default:
      result = {
        version: graph.version,
        counts: {
          items: Object.keys(gameData.items).length,
          resources: Object.keys(gameData.resources).length,
          recipes: Object.keys(gameData.recipes).length,
          buildings: Object.keys(gameData.buildings).length,
          schematics: Object.keys(gameData.schematics).length,
        },
        tools: [
          'get_item',
          'get_recipe',
          'recipes_for',
          'ingredient_tree',
          'total_raw_inputs',
          'what_consumes',
          'compare_alternates',
          'buildable_with',
          'list_schematics',
          'get_schematic',
          'get_building',
          'list_power_generators',
          'cypher_query',
        ],
        usage: "npm run inspect <tool> '<json-args>'",
      };
  }

  console.log(JSON.stringify({ version: graph.version, result }, null, 2));
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
