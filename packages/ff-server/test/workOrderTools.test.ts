import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { McpGateway, ToolDefinition, ToolInvocationResult } from '../src/mcp/client.js';
import { WorkOrderService } from '../src/services/workOrderService.js';
import {
  BLOCK_WORK_ORDER,
  CREATE_WORK_ORDER,
  PROPOSE_COMPLETION,
  REVISE_WORK_ORDER,
  enrichBuildCosts,
  handleWorkOrderTool,
  isWorkOrderTool,
  workOrderToolDefinitions,
  type WorkOrderToolDeps,
} from '../src/tools/workOrderTools.js';
import { createTestDb, createTestPlaythrough, type TestDb } from './helpers.js';

let db: TestDb;
let deps: WorkOrderToolDeps;

async function seedPlaythrough(): Promise<string> {
  return createTestPlaythrough(db.prisma);
}

/** A stub gateway whose get_building returns a fixed cost for a couple of buildings. */
function stubMcp(): McpGateway {
  const costs: Record<
    string,
    { className: string; buildCost: { item: string; itemClassName: string; amount: number }[] }
  > = {
    Smelter: {
      className: 'Build_SmelterMk1_C',
      buildCost: [{ item: 'Iron Rod', itemClassName: 'Desc_IronRod_C', amount: 5 }],
    },
    'Conveyor Splitter': {
      className: 'Build_ConveyorAttachmentSplitter_C',
      buildCost: [{ item: 'Iron Plate', itemClassName: 'Desc_IronPlate_C', amount: 2 }],
    },
  };
  // The building list backing list_buildings (used to suggest names on a miss).
  const buildings = [
    { className: 'Build_SmelterMk1_C', displayName: 'Smelter', category: 'Manufacturer' },
    {
      className: 'Build_ConveyorAttachmentSplitter_C',
      displayName: 'Conveyor Splitter',
      category: 'AttachmentSplitter',
    },
    {
      className: 'Build_ConveyorAttachmentSplitterSmart_C',
      displayName: 'Smart Splitter',
      category: 'SplitterSmart',
    },
  ];
  return {
    gameVersion: '1.2.3.0',
    listTools: async (): Promise<ToolDefinition[]> => [],
    callTool: async (name, args): Promise<ToolInvocationResult> => {
      if (name === 'get_building') {
        const building = costs[String((args as { name?: string }).name)];
        return building === undefined
          ? { text: 'Not found: building.', isError: true }
          : { text: JSON.stringify({ building }), isError: false };
      }
      if (name === 'list_buildings') {
        return { text: JSON.stringify({ buildings }), isError: false };
      }
      return { text: '', isError: true };
    },
  };
}

const validCreateInput = {
  title: 'Establish Iron Ingot Line',
  goal: 'Smelt 30 iron ingots per minute.',
  buildSteps: [
    { title: 'Place two smelters', buildables: [{ name: 'Smelter', requiredCount: 2 }] },
  ],
  expectedOutputs: [{ kind: 'item', item: 'Iron Ingot', perMinute: 30 }],
};

beforeAll(async () => {
  db = await createTestDb();
  deps = {
    workOrders: new WorkOrderService(db.prisma),
    gameVersion: () => '1.2.3.0',
    mcp: stubMcp(),
  };
});

afterAll(async () => {
  await db.cleanup();
});

describe('work-order tool registry', () => {
  it('recognises the server-local tools and nothing else', () => {
    expect(isWorkOrderTool(CREATE_WORK_ORDER)).toBe(true);
    expect(isWorkOrderTool(PROPOSE_COMPLETION)).toBe(true);
    expect(isWorkOrderTool('get_recipe')).toBe(false);
  });

  it('exposes valid Anthropic tool definitions', () => {
    const defs = workOrderToolDefinitions();
    expect(defs.length).toBeGreaterThanOrEqual(7);
    for (const def of defs) {
      expect(def.inputSchema['type']).toBe('object');
      expect(def.description.length).toBeGreaterThan(0);
    }
  });
});

describe('handleWorkOrderTool', () => {
  it('creates an order in the new state, stamps the version, and resolves build cost', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      validCreateInput,
      deps,
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.workOrder?.sequenceNumber).toBe(1);
    expect(outcome.workOrder?.state).toBe('new');
    expect(outcome.workOrder?.version).toBe('1.2.3.0');
    expect(outcome.text).toContain('WO-001');
    // The server resolved the Smelter's per-unit build cost via get_building.
    const buildable = outcome.workOrder?.buildSteps[0]?.buildables[0];
    expect(buildable?.buildingClass).toBe('Build_SmelterMk1_C');
    expect(buildable?.buildCost).toEqual([
      { itemName: 'Iron Rod', itemClass: 'Desc_IronRod_C', amount: 5 },
    ]);
  });

  it('does not supersede the previous order on a second create', async () => {
    const playthrough = await seedPlaythrough();
    await handleWorkOrderTool(playthrough, CREATE_WORK_ORDER, validCreateInput, deps);
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      { ...validCreateInput, title: 'Pivot to copper' },
      deps,
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toContain('WO-002');
    expect(await deps.workOrders.list(playthrough)).toHaveLength(2);
  });

  it('rejects invalid create input without persisting', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(playthrough, CREATE_WORK_ORDER, { title: '' }, deps);
    expect(outcome.isError).toBe(true);
    expect(outcome.workOrder).toBeUndefined();
    expect(await deps.workOrders.list(playthrough)).toHaveLength(0);
  });

  it('rejects (and does not persist) an order naming an unresolvable buildable', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      {
        ...validCreateInput,
        buildSteps: [{ title: 'Belts', buildables: [{ name: 'Splitter', requiredCount: 15 }] }],
      },
      deps,
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.workOrder).toBeUndefined();
    expect(outcome.text).toContain('Conveyor Splitter'); // suggestion in the rejection
    // Nothing was written — the foreman must fix the name and retry.
    expect(await deps.workOrders.list(playthrough)).toHaveLength(0);
  });

  it('revises the current order in place rather than creating a new one', async () => {
    const playthrough = await seedPlaythrough();
    const created = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      validCreateInput,
      deps,
    );
    // No Start — the order is still `new`. Revise must still target it.
    const outcome = await handleWorkOrderTool(
      playthrough,
      REVISE_WORK_ORDER,
      { goal: 'Smelt 45 iron ingots per minute.', changeSummary: 'Bumped target.' },
      deps,
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.workOrder?.id).toBe(created.workOrder?.id);
    expect(outcome.workOrder?.sequenceNumber).toBe(1);
    expect(outcome.workOrder?.currentRevision).toBe(2);
    expect(await deps.workOrders.list(playthrough)).toHaveLength(1);
  });

  it('refuses to propose completion of a new (unstarted) order', async () => {
    const playthrough = await seedPlaythrough();
    await handleWorkOrderTool(playthrough, CREATE_WORK_ORDER, validCreateInput, deps);
    const outcome = await handleWorkOrderTool(playthrough, PROPOSE_COMPLETION, {}, deps);
    // A work order can't be completed before the pioneer has started it.
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toMatch(/started/i);
  });

  it('proposes completion of the active order without completing it', async () => {
    const playthrough = await seedPlaythrough();
    const created = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      validCreateInput,
      deps,
    );
    await deps.workOrders.transition(playthrough, created.workOrder!.id, 'Start', 'Pioneer');

    const outcome = await handleWorkOrderTool(playthrough, PROPOSE_COMPLETION, {}, deps);
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toMatch(/confirm/i);
    // State is unchanged — the foreman cannot complete.
    expect(outcome.workOrder?.state).toBe('active');
  });

  it('blocks the active order with a reason and resolution hint', async () => {
    const playthrough = await seedPlaythrough();
    const created = await handleWorkOrderTool(
      playthrough,
      CREATE_WORK_ORDER,
      validCreateInput,
      deps,
    );
    await deps.workOrders.transition(playthrough, created.workOrder!.id, 'Start', 'Pioneer');

    const outcome = await handleWorkOrderTool(
      playthrough,
      BLOCK_WORK_ORDER,
      { blockedReason: 'Recipe locked.', blockedResolutionHint: 'Research it in the MAM.' },
      deps,
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.workOrder?.state).toBe('blocked');
  });

  it('errors when proposing completion with no active order', async () => {
    const playthrough = await seedPlaythrough();
    const outcome = await handleWorkOrderTool(playthrough, PROPOSE_COMPLETION, {}, deps);
    expect(outcome.isError).toBe(true);
  });
});

describe('enrichBuildCosts', () => {
  it('attaches per-unit cost + class for resolved buildables', async () => {
    const plan = {
      buildSteps: [
        { title: 'a', buildables: [{ name: 'Smelter', requiredCount: 2 }] },
        { title: 'b', buildables: [{ name: 'Conveyor Splitter', requiredCount: 4 }] },
      ],
    };
    const result = await enrichBuildCosts(plan, stubMcp());
    expect(result.ok).toBe(true);
    expect(plan.buildSteps[0]!.buildables[0]).toMatchObject({
      buildingClass: 'Build_SmelterMk1_C',
      buildCost: [{ itemName: 'Iron Rod', itemClass: 'Desc_IronRod_C', amount: 5 }],
    });
    expect(plan.buildSteps[1]!.buildables[0]!.buildingClass).toBe(
      'Build_ConveyorAttachmentSplitter_C',
    );
  });

  it('is ok when there are no buildables to resolve', async () => {
    const result = await enrichBuildCosts({}, stubMcp());
    expect(result.ok).toBe(true);
  });

  it('rejects an unresolved buildable and suggests the canonical name', async () => {
    const plan = {
      buildSteps: [{ title: 'a', buildables: [{ name: 'Splitter', requiredCount: 15 }] }],
    };
    const result = await enrichBuildCosts(plan, stubMcp());
    expect(result.ok).toBe(false);
    if (result.ok) {
      return; // narrow for the type-checker
    }
    expect(result.unresolved).toEqual(['Splitter']);
    // The rejection surfaces the two splitter variants, not the bare guess.
    expect(result.message).toContain('"Splitter"');
    expect(result.message).toContain('Conveyor Splitter');
    expect(result.message).toContain('Smart Splitter');
    expect(result.message).toContain('list_buildings');
  });

  it('reports no close match when nothing overlaps', async () => {
    const plan = {
      buildSteps: [{ title: 'a', buildables: [{ name: 'Nonexistent Machine', requiredCount: 1 }] }],
    };
    const result = await enrichBuildCosts(plan, stubMcp());
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.message).toContain('Nonexistent Machine');
    expect(result.message).toContain('no close match');
  });
});
