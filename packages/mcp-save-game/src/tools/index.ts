import { loadWorldLocations, type WorldLocations } from '@foreman/game-data-core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { logger } from '../logger.js';
import {
  collectibleProgressView,
  milestones,
  nearbyFromWorld,
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
  'hardDrive',
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
  // The static world-location dataset (every fixed collectible placement), loaded
  // once at startup. Backs get_nearby — complete and accurate, unlike the save,
  // which only contains collectibles in already-streamed World-Partition cells.
  const worldResolution = loadWorldLocations();
  if (worldResolution.warning !== undefined) {
    logger.warn(worldResolution.warning);
  }
  const world: WorldLocations = worldResolution.world;

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
        "The pioneer's current world location, HUB location, total play time, and personal inventory (aggregated per item).",
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
        'Purchased milestones grouped by tier, the current Project Assembly (Space Elevator) phase, and `mamResearch` — the MAM research TREES the pioneer has unlocked (e.g. "Power Slugs", "Hard Drive"), i.e. the categories available to research, NOT individual completed nodes. `other` is a catch-all of remaining schematics; do not present it as completed MAM research.',
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
        'Per-kind collectible visibility (Mercer Sphere, Somersloop, blue/yellow/purple power slug): the fixed world total, and how many un-collected ones are PRESENT in the regions this save has loaded. The save cannot tell collected from not-yet-explored, so it does NOT report a "collected" or "remaining" total — read the note, and never claim a collected count. For where to find collectibles, use get_nearby.',
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
        'Collectibles near a world location, nearest-first, each with coordinates and distance, from the complete static world dataset. Filter by kinds (mercerSphere, somersloop, powerSlugBlue/Yellow/Purple, hardDrive), cap by radius and limit (default 20). Use the player location from get_player_state as the origin to answer "what can I grab near me?". Read the note: positions are every placement in the world; the save cannot confirm which you have already collected.',
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
      return ok(store, {
        nearby: nearbyFromWorld(world.collectibles, location, { kinds, radius, limit }),
      });
    },
  );

  // Host-facing: parse just the header of a save and return its in-game name +
  // version, used to seed a playthrough's default name on upload.
  server.registerTool(
    'describe_save',
    {
      title: 'Describe save',
      description:
        "Host-internal: returns only a save file's in-game name and game/build version, used by the backend to seed a playthrough name on upload. Not for answering pioneer questions — for play time, location, or progress use get_player_state / get_milestones.",
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
