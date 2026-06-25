import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WorkOrderService } from '../src/services/workOrderService.js';
import {
  BLOCK_WORK_ORDER,
  CREATE_WORK_ORDER,
  PROPOSE_COMPLETION,
  REVISE_WORK_ORDER,
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

const validCreateInput = {
  title: 'Establish Iron Ingot Line',
  goal: 'Smelt 30 iron ingots per minute.',
  buildMaterials: [{ itemName: 'Iron Ore', requiredQuantity: 30 }],
  buildSteps: [{ title: 'Place two smelters' }],
  expectedOutputs: [{ kind: 'item', item: 'Iron Ingot', perMinute: 30 }],
};

beforeAll(async () => {
  db = await createTestDb();
  deps = { workOrders: new WorkOrderService(db.prisma), gameVersion: () => '1.2.3.0' };
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
  it('creates an order in the new state and stamps the game version', async () => {
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
