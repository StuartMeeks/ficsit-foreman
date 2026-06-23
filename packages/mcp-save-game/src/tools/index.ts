import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  collectibleProgressView,
  milestones,
  nearby,
  playerSummary,
  storageView,
  unlockedRecipes,
} from '../query/selectors.js';
import type { SaveStore } from '../store/saveStore.js';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

const vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() });
const collectibleKindSchema = z.enum([
  'mercerSphere',
  'somersloop',
  'powerSlugBlue',
  'powerSlugYellow',
  'powerSlugPurple',
]);

/**
 * Registers the v1 save-game tools. Descriptions are tight and model-facing —
 * they appear in the system context on every request. All tools are read-only
 * and tag every response with the detected game version and save name. They
 * return computed, distilled answers, not raw save dumps.
 */
export function registerTools(server: McpServer, store: SaveStore): void {
  const ok = (payload: object): ToolResult => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({ version: store.version, saveName: store.saveName, ...payload }),
      },
    ],
  });

  server.registerTool(
    'get_player_state',
    {
      title: 'Get player state',
      description:
        "The pioneer's current world location, HUB location, and personal inventory (aggregated per item).",
      inputSchema: {},
    },
    async (): Promise<ToolResult> => ok({ player: playerSummary(store.getState()) }),
  );

  server.registerTool(
    'get_unlocked_recipes',
    {
      title: 'Get unlocked recipes',
      description: 'All unlocked recipes, split into standard and alternate, with counts.',
      inputSchema: {},
    },
    async (): Promise<ToolResult> => ok({ recipes: unlockedRecipes(store.getState()) }),
  );

  server.registerTool(
    'get_milestones',
    {
      title: 'Get milestones',
      description:
        'Unlocked milestones grouped by tier, plus tutorial schematics, MAM research unlocks, and the current Project Assembly (Space Elevator) phase.',
      inputSchema: {},
    },
    async (): Promise<ToolResult> => ok({ progress: milestones(store.getState()) }),
  );

  server.registerTool(
    'get_storage',
    {
      title: 'Get storage',
      description:
        'Storage container contents and the dimensional depot. Pass a location {x,y,z} to sort containers nearest-first by distance.',
      inputSchema: { location: vec3Schema.optional() },
    },
    async ({ location }): Promise<ToolResult> =>
      ok({ storage: storageView(store.getState(), location) }),
  );

  server.registerTool(
    'get_collectibles',
    {
      title: 'Get collectibles',
      description:
        'Per-type collection progress — for each kind (Mercer Sphere, Somersloop, blue/yellow/purple power slug): how many of the world total remain uncollected in this save and how many are collected. Exact on a fully-explored save; read the note (under-explored saves over-count collected). Hard drives and resource nodes are not covered yet (the save cannot reliably classify them).',
      inputSchema: {},
    },
    async (): Promise<ToolResult> =>
      ok({ collectibles: collectibleProgressView(store.getState()) }),
  );

  server.registerTool(
    'get_nearby',
    {
      title: 'Get nearby collectibles',
      description:
        'Un-collected collectibles near a world location, nearest-first, each with its coordinates and distance. Filter by kinds (mercerSphere, somersloop, powerSlugBlue/Yellow/Purple), cap by radius and limit (default 20). Use the player location from get_player_state as the origin to answer "what can I grab near me?".',
      inputSchema: {
        location: vec3Schema,
        kinds: z.array(collectibleKindSchema).optional(),
        radius: z.number().positive().optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ location, kinds, radius, limit }): Promise<ToolResult> =>
      ok({ nearby: nearby(store.getState(), location, { kinds, radius, limit }) }),
  );
}
