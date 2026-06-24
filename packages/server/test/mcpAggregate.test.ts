import { describe, expect, it } from 'vitest';

import { McpAggregateGateway } from '../src/mcp/aggregateGateway.js';
import type { McpGateway, ToolDefinition, ToolInvocationResult } from '../src/mcp/client.js';

function gateway(
  version: string,
  toolNames: string[],
  opts: { failList?: boolean } = {},
): McpGateway & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    gameVersion: version,
    listTools: async (): Promise<ToolDefinition[]> => {
      if (opts.failList === true) {
        throw new Error('unreachable');
      }
      return toolNames.map((name) => ({
        name,
        description: name,
        inputSchema: { type: 'object' },
      }));
    },
    callTool: async (name): Promise<ToolInvocationResult> => {
      calls.push(name);
      return { text: `${version}:${name}`, isError: false };
    },
  };
}

describe('McpAggregateGateway', () => {
  it('exposes the primary game version and merges tools, primary winning clashes', async () => {
    const primary = gateway('game-1.0', ['get_recipe', 'shared']);
    const save = gateway('save-2.0', ['get_player_state', 'shared']);
    const agg = new McpAggregateGateway(primary, [save]);

    expect(agg.gameVersion).toBe('game-1.0');
    const tools = await agg.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_player_state', 'get_recipe', 'shared']);
  });

  it('routes each tool call to the server that owns it', async () => {
    const primary = gateway('game-1.0', ['get_recipe', 'shared']);
    const save = gateway('save-2.0', ['get_player_state']);
    const agg = new McpAggregateGateway(primary, [save]);

    await agg.listTools();
    expect((await agg.callTool('get_recipe', {})).text).toBe('game-1.0:get_recipe');
    expect((await agg.callTool('get_player_state', {})).text).toBe('save-2.0:get_player_state');
    // The clashing name resolves to the primary.
    expect((await agg.callTool('shared', {})).text).toBe('game-1.0:shared');
    expect(save.calls).toEqual(['get_player_state']);
  });

  it('degrades gracefully when a secondary is unreachable', async () => {
    const primary = gateway('game-1.0', ['get_recipe']);
    const save = gateway('save-2.0', ['get_player_state'], { failList: true });
    const agg = new McpAggregateGateway(primary, [save]);

    const tools = await agg.listTools();
    expect(tools.map((t) => t.name)).toEqual(['get_recipe']);
    expect((await agg.callTool('get_recipe', {})).text).toBe('game-1.0:get_recipe');
  });
});
