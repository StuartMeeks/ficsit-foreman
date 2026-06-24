import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { resolveServerConfig } from '../src/config.js';
import type { AppDeps } from '../src/deps.js';
import type { McpGateway } from '../src/mcp/client.js';
import { SummaryService } from '../src/llm/summary.js';
import type { LlmProviderFactory } from '../src/llm/provider.js';
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
  goal: 'Make 20 plates per minute.',
  buildMaterials: [{ itemName: 'Iron Ingot', requiredQuantity: 30 }],
  buildSteps: [{ title: 'Place constructors' }],
  expectedOutputs: [{ kind: 'item', item: 'Iron Plate', perMinute: 20 }],
};

beforeAll(async () => {
  db = await createTestDb();
  const sessions = new SessionService(db.prisma);
  const stubFactory: LlmProviderFactory = () => ({
    runTurn: async () => ({ text: '', toolCalls: [], stopReason: 'stop' }),
    complete: async () => '',
  });
  const deps: AppDeps = {
    config: resolveServerConfig({}),
    sessions,
    workOrders: new WorkOrderService(db.prisma),
    mcp: stubMcp,
    summary: new SummaryService(sessions, { historyWindow: 20 }, stubFactory),
    llmProviderFactory: stubFactory,
    systemPromptTemplate: 'Prompt {{PERSONALITY}} {{PIONEER_PROFILE}} {{SESSION_SUMMARY}}',
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

  it('creates a new order, lists it, then starts it to become active', async () => {
    const session = await createSession();
    const create = await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(workOrderBody),
    });
    expect(create.status).toBe(201);
    const order = (await create.json()) as {
      id: string;
      sequenceNumber: number;
      version: string;
      state: string;
    };
    expect(order.sequenceNumber).toBe(1);
    expect(order.version).toBe('1.2.3.0');
    expect(order.state).toBe('new');

    const list = await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders`);
    expect(((await list.json()) as unknown[]).length).toBe(1);

    const start = await fetch(
      `${baseUrl}/api/sessions/${session.id}/work-orders/${order.id}/transitions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'Start', actor: 'Pioneer' }),
      },
    );
    expect(start.status).toBe(200);

    const active = await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders/active`);
    expect(active.status).toBe(200);
    expect(((await active.json()) as { state: string }).state).toBe('active');
  });

  it('does not supersede the previous order on a second create (one active max)', async () => {
    const session = await createSession();
    const post = async (title: string): Promise<{ id: string }> => {
      const res = await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...workOrderBody, title }),
      });
      return res.json() as Promise<{ id: string }>;
    };
    const first = await post('First');
    await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders/${first.id}/transitions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'Start', actor: 'Pioneer' }),
    });
    await post('Second');

    // First is still active (not superseded); Second sits in `new`.
    const active = await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders/active`);
    expect(((await active.json()) as { title: string }).title).toBe('First');
    const list = (await (
      await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders`)
    ).json()) as {
      state: string;
    }[];
    expect(list).toHaveLength(2);
    expect(list.filter((o) => o.state === 'active')).toHaveLength(1);
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
