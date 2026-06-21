import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { resolveServerConfig } from '../src/config.js';
import type { AppDeps } from '../src/deps.js';
import type { McpGateway } from '../src/mcp/client.js';
import { SessionService } from '../src/services/sessionService.js';
import { WorkOrderService } from '../src/services/workOrderService.js';
import { createTestDb, type TestDb } from './helpers.js';

let db: TestDb;
let server: Server;
let baseUrl: string;

const stubMcp: McpGateway = {
  gameVersion: '1.2.3.0',
  listTools: async () => [],
  callTool: async () => ({ text: '', isError: false }),
};

const workOrderBody = {
  title: 'Iron Plate Line',
  objective: 'Make plates.',
  tier: 1,
  estimatedDuration: '15 minutes',
  requiredItems: [{ item: 'Iron Ingot', quantity: 30, unit: 'per minute' }],
  buildSteps: ['Place constructors'],
  expectedOutput: [{ item: 'Iron Plate', perMinute: 20 }],
};

beforeAll(async () => {
  db = await createTestDb();
  const deps: AppDeps = {
    config: resolveServerConfig({}),
    sessions: new SessionService(db.prisma),
    workOrders: new WorkOrderService(db.prisma),
    mcp: stubMcp,
    systemPromptTemplate: 'Prompt {{PERSONALITY}} {{PIONEER_PROFILE}}',
  };
  const app = buildApp(deps);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.cleanup();
});

async function createSession(body: unknown = {}): Promise<{ id: string }> {
  const res = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return res.json() as Promise<{ id: string }>;
}

describe('HTTP routes', () => {
  it('reports health', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; gameVersion: string };
    expect(body.status).toBe('ok');
    expect(body.gameVersion).toBe('1.2.3.0');
  });

  it('creates and updates a session', async () => {
    const session = await createSession({ personality: 'Calm' });
    const res = await fetch(`${baseUrl}/api/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pioneerProfile: 'Veteran' }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { personality: string; pioneerProfile: string };
    expect(updated.personality).toBe('Calm');
    expect(updated.pioneerProfile).toBe('Veteran');
  });

  it('rejects an empty session update', async () => {
    const session = await createSession();
    const res = await fetch(`${baseUrl}/api/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('creates, lists, and reads the active work order', async () => {
    const session = await createSession();
    const create = await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(workOrderBody),
    });
    expect(create.status).toBe(201);
    const order = (await create.json()) as { sequenceNumber: number; version: string };
    expect(order.sequenceNumber).toBe(1);
    expect(order.version).toBe('1.2.3.0');

    const list = await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders`);
    expect(((await list.json()) as unknown[]).length).toBe(1);

    const active = await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders/active`);
    expect(active.status).toBe(200);
    expect(((await active.json()) as { status: string }).status).toBe('active');
  });

  it('supersedes the active order on a second create', async () => {
    const session = await createSession();
    const post = async (title: string): Promise<void> => {
      await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...workOrderBody, title }),
      });
    };
    await post('First');
    await post('Second');
    const active = await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders/active`);
    expect(((await active.json()) as { title: string }).title).toBe('Second');
    const list = (await (await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders`)).json()) as {
      status: string;
    }[];
    expect(list.filter((o) => o.status === 'active')).toHaveLength(1);
  });

  it('404s the active endpoint when nothing is active', async () => {
    const session = await createSession();
    const res = await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders/active`);
    expect(res.status).toBe(404);
  });

  it('404s work orders for an unknown session', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/does-not-exist/work-orders`);
    expect(res.status).toBe(404);
  });
});
