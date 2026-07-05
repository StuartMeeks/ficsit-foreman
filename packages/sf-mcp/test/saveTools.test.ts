import { describe, expect, it } from 'vitest';

import { emptySaveState } from '@foreman/sf-save-data';
import { buildSaveGraph } from '@foreman/sf-save-data-graph';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { SaveStore } from '../src/store/saveStore.js';
import { SaveStoreRegistry } from '../src/store/registry.js';
import { registerSaveTools } from '../src/tools/save.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;
const NOW = '2026-01-01T00:00:00.000Z';

describe('get_collected_identities (#209)', () => {
  it('returns collected pickup/pod GUIDs and unlocked schematics for reconciliation', async () => {
    const state = emptySaveState('v', 'Fixture', NOW);
    state.collectedPickupGuids = ['G1', 'G2']; // spheres / sloops / slugs
    state.lootedDropPodGuids = ['P1']; // hard-drive pods
    state.milestones = [{ schematicClass: 'Schematic_Helmet_Beta_C', kind: 'other' }]; // customizer unlock
    const store = SaveStore.fromState(state);
    const registry = new SaveStoreRegistry(store, undefined, 5, {
      statMtime: () => 1,
      load: () => ({ state, graph: buildSaveGraph({}) }),
      now: () => NOW,
    });
    const handlers = new Map<string, Handler>();
    const stubServer = {
      registerTool(name: string, _schema: unknown, handler: Handler): void {
        handlers.set(name, handler);
      },
    } as unknown as McpServer;
    registerSaveTools(stubServer, registry);

    const handler = handlers.get('get_collected_identities');
    expect(handler).toBeDefined();

    const res = await handler!({ savePath: undefined }); // undefined → the default store
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(res.content[0]!.text) as { guids: string[]; schematics: string[] };
    // GUID set = destroyed pickups ∪ looted pods.
    expect(new Set(body.guids)).toEqual(new Set(['G1', 'G2', 'P1']));
    // Schematic set = unlocked schematics (the customizer-collectible key).
    expect(body.schematics).toContain('Schematic_Helmet_Beta_C');
  });
});
