/**
 * Developer CLI for exercising the tools against a real (or fixture) docs file
 * without an MCP client. Unlike the server, this prints to stdout.
 *
 *   npm run inspect                              # summary + tool list
 *   npm run inspect get_item '{"name":"Iron Plate"}'
 *   npm run inspect ingredient_tree '{"item":"Turbo Motor","targetPerMinute":1}'
 *   npm run inspect total_raw_inputs '{"item":"Reinforced Iron Plate","targetPerMinute":5}'
 */
import { loadDataset, WorldQueries } from '@foreman/sf-game-data';
import { initGraph } from '@foreman/sf-game-data-graph';

type Coord = { x: number; y: number; z: number };

async function run(): Promise<void> {
  const tool = process.argv[2];
  const argJson = process.argv[3];
  const args: Record<string, unknown> = argJson === undefined ? {} : JSON.parse(argJson);

  const { gameData, world, warning } = loadDataset();
  if (warning !== undefined) {
    console.error(warning);
  }
  const graph = await initGraph(gameData);
  const worldQueries = new WorldQueries(world, gameData);

  const str = (key: string): string => String(args[key] ?? '');
  const num = (key: string): number => Number(args[key] ?? 0);
  const coord = (): Coord => (args['coord'] as Coord | undefined) ?? { x: 0, y: 0, z: 0 };
  const optKind = <T>(key: string): T | undefined =>
    args[key] === undefined ? undefined : (args[key] as T);

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
    case 'full_production_line':
      result = await graph.fullProductionLine(
        str('item'),
        num('targetPerMinute'),
        args['recipeChoices'] as Record<string, string> | undefined,
        args['assumptions'] as
          | {
              minerMark?: number;
              purity?: 'impure' | 'normal' | 'pure';
              beltMetresPerLink?: number;
            }
          | undefined,
      );
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
    case 'list_collectibles':
      result = worldQueries.listCollectibles(optKind('type'));
      break;
    case 'nearest_collectibles':
      result = {
        collectibles: worldQueries.nearestCollectibles(
          coord(),
          optKind('type'),
          args['n'] === undefined ? undefined : num('n'),
        ),
      };
      break;
    case 'nearest_resource_nodes':
      result = {
        nodes: worldQueries.nearestResourceNodes(coord(), {
          resource: optKind('resource'),
          purity: optKind('purity'),
          n: args['n'] === undefined ? undefined : num('n'),
        }),
      };
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
          'list_collectibles',
          'nearest_collectibles',
          'nearest_resource_nodes',
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
