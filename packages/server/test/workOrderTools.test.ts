import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WorkOrderService } from '../src/services/workOrderService.js';
import {
  CREATE_WORK_ORDER,
  COMPLETE_WORK_ORDER,
  handleWorkOrderTool,
  isWorkOrderTool,
  workOrderToolDefinitions,
  type WorkOrderToolDeps,
} from '../src/tools/workOrderTools.js';
import { createTestDb, type TestDb } from './helpers.js';

let db: TestDb;
let deps: WorkOrderToolDeps;

async function seedSession(): Promise<string> {
  const id = randomUUID();
  await db.prisma.session.create({ data: { id } });
  return id;
}

const validCreateInput = {
  title: 'Establish Iron Ingot Line',
  objective: 'Smelt 30 iron ingots per minute.',
  tier: 1,
  estimatedDuration: '15 minutes',
  requiredItems: [{ item: 'Iron Ore', quantity: 30, unit: 'per minute' }],
  buildSteps: ['Place two smelters'],
  expectedOutput: [{ item: 'Iron Ingot', perMinute: 30 }],
};

beforeAll(async () => {
  db = await createTestDb();
  deps = { workOrders: new WorkOrderService(db.prisma), gameVersion: () => '1.2.3.0' };
});

afterAll(async () => {
  await db.cleanup();
});

describe('work-order tool registry', () => {
  it('recognises the two server-local tools and nothing else', () => {
    expect(isWorkOrderTool(CREATE_WORK_ORDER)).toBe(true);
    expect(isWorkOrderTool(COMPLETE_WORK_ORDER)).toBe(true);
    expect(isWorkOrderTool('get_recipe')).toBe(false);
  });

  it('exposes valid Anthropic tool definitions', () => {
    const defs = workOrderToolDefinitions();
    expect(defs.map((d) => d.name).sort()).toEqual([COMPLETE_WORK_ORDER, CREATE_WORK_ORDER].sort());
    for (const def of defs) {
      expect(def.inputSchema['type']).toBe('object');
      expect(def.description.length).toBeGreaterThan(0);
    }
  });
});

describe('handleWorkOrderTool', () => {
  it('creates an order and stamps the game version', async () => {
    const session = await seedSession();
    const outcome = await handleWorkOrderTool(session, CREATE_WORK_ORDER, validCreateInput, deps);
    expect(outcome.isError).toBe(false);
    expect(outcome.workOrder?.sequenceNumber).toBe(1);
    expect(outcome.workOrder?.version).toBe('1.2.3.0');
    expect(outcome.text).toContain('WO-001');
  });

  it('reports the supersession when an order is already active', async () => {
    const session = await seedSession();
    await handleWorkOrderTool(session, CREATE_WORK_ORDER, validCreateInput, deps);
    const outcome = await handleWorkOrderTool(
      session,
      CREATE_WORK_ORDER,
      { ...validCreateInput, title: 'Pivot to copper' },
      deps,
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toContain('WO-002');
    expect(outcome.text).toMatch(/[Ss]upersed/);
    expect(outcome.text).toContain('WO-001');
  });

  it('rejects invalid create input without persisting', async () => {
    const session = await seedSession();
    const outcome = await handleWorkOrderTool(session, CREATE_WORK_ORDER, { title: '' }, deps);
    expect(outcome.isError).toBe(true);
    expect(outcome.workOrder).toBeUndefined();
    expect(await deps.workOrders.list(session)).toHaveLength(0);
  });

  it('completes the active order', async () => {
    const session = await seedSession();
    await handleWorkOrderTool(session, CREATE_WORK_ORDER, validCreateInput, deps);
    const outcome = await handleWorkOrderTool(
      session,
      COMPLETE_WORK_ORDER,
      { completionSummary: 'Done and feeding storage.' },
      deps,
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.workOrder?.status).toBe('completed');
    expect(outcome.text).toContain('completed');
  });

  it('errors when completing with no active order', async () => {
    const session = await seedSession();
    const outcome = await handleWorkOrderTool(
      session,
      COMPLETE_WORK_ORDER,
      { completionSummary: 'Nothing to close.' },
      deps,
    );
    expect(outcome.isError).toBe(true);
  });
});
