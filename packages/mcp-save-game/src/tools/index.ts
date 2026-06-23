import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  collectiblesView,
  milestones,
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
        'Collected-collectible summary: reliable alien-artifact and power-slug totals, approximate Mercer/Somersloop and hard-drive splits, and world totals for reference. Read the note — exact per-type counts and locations require world-location data not yet available.',
      inputSchema: {},
    },
    async (): Promise<ToolResult> => ok({ collectibles: collectiblesView(store.getState()) }),
  );
}
