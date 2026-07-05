import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import type { GameData, WorldLocations } from '@foreman/sf-game-data';
import { WorldQueries } from '@foreman/sf-game-data';
import { initGraph, type GraphDB } from '@foreman/sf-game-data-graph';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerGameDataTools } from '../src/tools/gameData.js';

/**
 * Registration-layer harness for the game-data MCP tools (#225). The tools' query logic is
 * covered at the graph level; this exercises the thin registration wrappers themselves —
 * that each tool is registered under its name, a valid call returns a non-error,
 * version-tagged payload with the expected top-level key, and a miss returns `isError`.
 *
 * We capture the handlers via a stub `server` (registerGameDataTools only ever calls
 * `server.registerTool(name, schema, handler)`), then invoke them directly — no MCP transport.
 */
type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

const gameData: GameData = JSON.parse(
  fs.readFileSync(
    fileURLToPath(
      new URL('../../sf-game-data-graph/test/fixtures/game-data.json', import.meta.url),
    ),
    'utf8',
  ),
);
// A tiny world with one GUID-keyed and one schematic-keyed collectible, so the
// collectible tools have something to return and we can assert identity survives.
const testWorld: WorldLocations = {
  gameVersion: 'test',
  build: 0,
  source: 'test',
  counts: { somersloop: 1, helmet: 1, hardDrive: 1 },
  collectibles: [
    { id: 'C1', kind: 'somersloop', guid: 'GUID-SLOOP-1', x: 100, y: 0, z: 0 },
    { id: 'C2', kind: 'helmet', schematic: 'Schematic_Helmet_Beta_C', x: 200, y: 0, z: 0 },
    // A hard-drive pod carries an unlock COST (what's needed to open it) — must survive.
    {
      id: 'C3',
      kind: 'hardDrive',
      guid: 'GUID-POD-1',
      unlock: { powerMW: 250, item: { itemClass: 'Desc_IronPlate_C', amount: 50 } },
      x: 300,
      y: 0,
      z: 0,
    },
  ],
  resourceNodes: [],
  lootPickups: [],
};

let graph: GraphDB;
const handlers = new Map<string, Handler>();

beforeAll(async () => {
  graph = await initGraph(gameData);
  const stubServer = {
    registerTool(name: string, _schema: unknown, handler: Handler): void {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  registerGameDataTools(stubServer, graph, new WorldQueries(testWorld, gameData));
});

/** Graph-backed tools: assert registration, a version-tagged happy payload, and misses. */
const graphCases: {
  name: string;
  key: string;
  happy: Record<string, unknown>;
  miss?: Record<string, unknown>;
}[] = [
  { name: 'get_item', key: 'item', happy: { name: 'Iron Plate' }, miss: { name: 'Nope Ore' } },
  { name: 'list_items', key: 'items', happy: {} },
  { name: 'get_recipe', key: 'recipe', happy: { name: 'Iron Plate' }, miss: { name: 'Nope' } },
  { name: 'list_recipes', key: 'recipes', happy: {} },
  { name: 'recipes_for', key: 'recipes', happy: { item: 'Iron Plate' }, miss: { item: 'Nope' } },
  {
    name: 'ingredient_tree',
    key: 'tree',
    happy: { item: 'Reinforced Iron Plate', targetPerMinute: 5 },
    miss: { item: 'Nope', targetPerMinute: 5 },
  },
  {
    name: 'full_production_line',
    key: 'productionMachines',
    happy: { item: 'Reinforced Iron Plate', targetPerMinute: 5 },
    miss: { item: 'Nope', targetPerMinute: 5 },
  },
  {
    name: 'total_raw_inputs',
    key: 'rawInputs',
    happy: { item: 'Reinforced Iron Plate', targetPerMinute: 5 },
    miss: { item: 'Nope', targetPerMinute: 5 },
  },
  {
    name: 'what_consumes',
    key: 'consumedBy',
    happy: { item: 'Iron Ingot' },
    miss: { item: 'Nope' },
  },
  {
    name: 'compare_alternates',
    key: 'recipes',
    happy: { item: 'Reinforced Iron Plate' },
    miss: { item: 'Nope' },
  },
  { name: 'buildable_with', key: 'buildable', happy: { resources: ['Iron Ore'] } },
  { name: 'list_schematics', key: 'schematics', happy: {} },
  {
    name: 'get_schematic',
    key: 'schematic',
    happy: { name: 'Plate Production' },
    miss: { name: 'Nope' },
  },
  { name: 'get_building', key: 'building', happy: { name: 'Smelter' }, miss: { name: 'Nope' } },
  { name: 'list_power_generators', key: 'generators', happy: {} },
  { name: 'list_buildings', key: 'buildings', happy: {} },
  { name: 'cypher_query', key: 'rows', happy: { query: 'MATCH (i:Item) RETURN count(i) AS n' } },
];

describe('game-data tool registration (#225)', () => {
  for (const c of graphCases) {
    it(`${c.name}: registered, returns a version-tagged { ${c.key} }`, async () => {
      const handler = handlers.get(c.name);
      expect(handler, `${c.name} should be registered`).toBeDefined();

      const res = await handler!(c.happy);
      expect(res.isError, `${c.name} happy call should not error`).toBeFalsy();
      const body = JSON.parse(res.content[0]!.text) as Record<string, unknown>;
      expect(body['version']).toBe('test-1.0');
      expect(body).toHaveProperty(c.key);

      if (c.miss !== undefined) {
        const missRes = await handler!(c.miss);
        expect(missRes.isError, `${c.name} miss should be an error`).toBe(true);
        const missBody = JSON.parse(missRes.content[0]!.text) as { error?: string };
        expect(missBody.error).toMatch(/^Not found:/);
      }
    });
  }

  // World-backed tools: with an empty world dataset they return no results, but the point
  // here is that the registration wrapper is wired and doesn't throw.
  const worldTools = [
    { name: 'list_collectibles', happy: {} },
    { name: 'nearest_collectibles', happy: { coord: { x: 0, y: 0, z: 0 } } },
    { name: 'nearest_resource_nodes', happy: { coord: { x: 0, y: 0, z: 0 } } },
    { name: 'list_parts', happy: {} },
    { name: 'nearest_parts', happy: { coord: { x: 0, y: 0, z: 0 } } },
  ];
  for (const c of worldTools) {
    it(`${c.name}: registered and returns without error`, async () => {
      const handler = handlers.get(c.name);
      expect(handler, `${c.name} should be registered`).toBeDefined();
      const res = await handler!(c.happy);
      expect(res.isError).toBeFalsy();
    });
  }

  it('rejects a mutating cypher_query', async () => {
    const res = await handlers.get('cypher_query')!({ query: 'MATCH (i:Item) DELETE i' });
    expect(res.isError).toBe(true);
  });

  // #207/#209: the foreman must be able to store a collectible's identity on a waypoint.
  it('nearest_collectibles preserves collectible identity (guid / schematic)', async () => {
    const res = await handlers.get('nearest_collectibles')!({ coord: { x: 0, y: 0, z: 0 } });
    const body = JSON.parse(res.content[0]!.text) as { collectibles: Record<string, unknown>[] };
    const sloop = body.collectibles.find((c) => c['kind'] === 'somersloop');
    const helmet = body.collectibles.find((c) => c['kind'] === 'helmet');
    expect(sloop?.['guid']).toBe('GUID-SLOOP-1');
    expect(helmet?.['schematic']).toBe('Schematic_Helmet_Beta_C');
    // A pod's unlock COST (power/items needed to open it) must survive for the waypoint.
    const pod = body.collectibles.find((c) => c['kind'] === 'hardDrive');
    expect((pod?.['unlock'] as { powerMW?: number } | undefined)?.powerMW).toBe(250);
  });

  it('list_collectibles preserves identity for the listed kind', async () => {
    const res = await handlers.get('list_collectibles')!({ type: 'somersloop' });
    const body = JSON.parse(res.content[0]!.text) as { collectibles?: Record<string, unknown>[] };
    expect(body.collectibles?.[0]?.['guid']).toBe('GUID-SLOOP-1');
  });
});
