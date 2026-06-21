import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  WorkOrderService,
  formatWorkOrderLabel,
  type CreateWorkOrderInput,
} from '../src/services/workOrderService.js';
import { createTestDb, type TestDb } from './helpers.js';

let db: TestDb;
let service: WorkOrderService;

async function seedSession(): Promise<string> {
  const id = randomUUID();
  await db.prisma.session.create({ data: { id } });
  return id;
}

function sampleInput(title: string): CreateWorkOrderInput {
  return {
    title,
    objective: 'Stand up a line.',
    tier: 2,
    estimatedDuration: '20–30 minutes',
    requiredItems: [{ item: 'Iron Ingot', quantity: 30, unit: 'per minute' }],
    buildSteps: ['Place constructors', 'Connect belts'],
    expectedOutput: [{ item: 'Iron Plate', perMinute: 20 }],
  };
}

beforeAll(async () => {
  db = await createTestDb();
  service = new WorkOrderService(db.prisma);
});

afterAll(async () => {
  await db.cleanup();
});

describe('WorkOrderService', () => {
  it('numbers orders sequentially per session', async () => {
    const session = await seedSession();
    const first = await service.create(session, sampleInput('First'), '1.0.0');
    const second = await service.create(session, sampleInput('Second'), '1.0.0');
    expect(first.sequenceNumber).toBe(1);
    expect(second.sequenceNumber).toBe(2);
    expect(formatWorkOrderLabel(second.sequenceNumber)).toBe('WO-002');
  });

  it('abandons the existing active order when a new one is issued', async () => {
    const session = await seedSession();
    const first = await service.create(session, sampleInput('First'), '1.0.0');
    await service.create(session, sampleInput('Second'), '1.0.0');

    const reloadedFirst = await service.get(session, first.id);
    const active = await service.getActive(session);
    expect(reloadedFirst?.status).toBe('abandoned');
    expect(reloadedFirst?.completedAt).toBeDefined();
    expect(active?.title).toBe('Second');
    const allActive = (await service.list(session)).filter((order) => order.status === 'active');
    expect(allActive).toHaveLength(1);
  });

  it('round-trips JSON-encoded fields through the database', async () => {
    const session = await seedSession();
    const created = await service.create(session, sampleInput('Round trip'), '1.2.3.0');
    const fetched = await service.get(session, created.id);
    expect(fetched?.requiredItems).toEqual([{ item: 'Iron Ingot', quantity: 30, unit: 'per minute' }]);
    expect(fetched?.buildSteps).toEqual(['Place constructors', 'Connect belts']);
    expect(fetched?.expectedOutput).toEqual([{ item: 'Iron Plate', perMinute: 20 }]);
    expect(fetched?.version).toBe('1.2.3.0');
  });

  it('completes the active order with summary and feedback', async () => {
    const session = await seedSession();
    await service.create(session, sampleInput('To complete'), '1.0.0');
    const completed = await service.completeActive(session, {
      completionSummary: 'Line is up and feeding storage.',
      adaptations: ['Added a second miner after a shortfall.'],
      pioneerFeedback: { enjoyedAspects: ['Watching numbers climb'], didNotEnjoy: ['Belt routing'] },
    });
    expect(completed?.status).toBe('completed');
    expect(completed?.completedAt).toBeDefined();
    expect(completed?.completionSummary).toContain('Line is up');
    expect(completed?.adaptations).toHaveLength(1);
    expect(completed?.pioneerFeedback?.enjoyedAspects).toContain('Watching numbers climb');
    expect(await service.getActive(session)).toBeUndefined();
  });

  it('returns undefined when completing with no active order', async () => {
    const session = await seedSession();
    const result = await service.completeActive(session, { completionSummary: 'Nothing to close.' });
    expect(result).toBeUndefined();
  });
});
