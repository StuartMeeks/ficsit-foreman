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
import type { SaveStoreRegistry } from '../store/registry.js';

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

// The host (foreman backend) injects the active playthrough's save path; the
// model never needs to set it. Optional so the legacy single-save mode still
// works when no path is supplied.
const savePathSchema = z
  .string()
  .optional()
  .describe('Managed by the host — the save to read. Leave unset.');

/**
 * Registers the save-game tools. Descriptions are tight and model-facing — they
 * appear in the system context on every request. All tools are read-only and tag
 * every response with the detected game version and save name. Each accepts an
 * optional `savePath` (host-injected) so a tool call reads the right
 * playthrough's save; the {@link SaveStoreRegistry} resolves (and caches) it.
 */
export function registerTools(server: McpServer, registry: SaveStoreRegistry): void {
  const ok = (store: SaveStore, payload: object): ToolResult => ({
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
      inputSchema: { savePath: savePathSchema },
    },
    async ({ savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      return ok(store, { player: playerSummary(store.getState()) });
    },
  );

  server.registerTool(
    'get_unlocked_recipes',
    {
      title: 'Get unlocked recipes',
      description: 'All unlocked recipes, split into standard and alternate, with counts.',
      inputSchema: { savePath: savePathSchema },
    },
    async ({ savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      return ok(store, { recipes: unlockedRecipes(store.getState()) });
    },
  );

  server.registerTool(
    'get_milestones',
    {
      title: 'Get milestones',
      description:
        'Unlocked milestones grouped by tier, plus tutorial schematics, MAM research unlocks, and the current Project Assembly (Space Elevator) phase.',
      inputSchema: { savePath: savePathSchema },
    },
    async ({ savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      return ok(store, { progress: milestones(store.getState()) });
    },
  );

  server.registerTool(
    'get_storage',
    {
      title: 'Get storage',
      description:
        'Storage container contents and the dimensional depot. Pass a location {x,y,z} to sort containers nearest-first by distance.',
      inputSchema: { location: vec3Schema.optional(), savePath: savePathSchema },
    },
    async ({ location, savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      return ok(store, { storage: storageView(store.getState(), location) });
    },
  );

  server.registerTool(
    'get_collectibles',
    {
      title: 'Get collectibles',
      description:
        'Per-type collection progress — for each kind (Mercer Sphere, Somersloop, blue/yellow/purple power slug): how many of the world total remain uncollected in this save and how many are collected. Exact on a fully-explored save; read the note (under-explored saves over-count collected). Hard drives and resource nodes are not covered yet (the save cannot reliably classify them).',
      inputSchema: { savePath: savePathSchema },
    },
    async ({ savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      return ok(store, { collectibles: collectibleProgressView(store.getState()) });
    },
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
        savePath: savePathSchema,
      },
    },
    async ({ location, kinds, radius, limit, savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      return ok(store, { nearby: nearby(store.getState(), location, { kinds, radius, limit }) });
    },
  );

  // Host-facing: parse just the header of a save and return its in-game name +
  // version, used to seed a playthrough's default name on upload.
  server.registerTool(
    'describe_save',
    {
      title: 'Describe save',
      description:
        'Return the in-game save name and game/build version of a save file. Managed by the host.',
      inputSchema: { savePath: z.string().describe('The save file to describe.') },
    },
    async ({ savePath }): Promise<ToolResult> => {
      const store = registry.resolve(savePath);
      // Touch the state so the header is parsed, then surface the metadata.
      store.getState();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ saveName: store.saveName, version: store.version }),
          },
        ],
      };
    },
  );
}
