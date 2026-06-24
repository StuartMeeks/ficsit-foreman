import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
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
// Cookie for the default signed-in user; threaded through every request.
let cookie: string;

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

/** Joins a response's Set-Cookie headers into a single Cookie request header. */
function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

/** Creates an account and returns its session cookie. */
async function signUp(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Test Pioneer', email, password: 'password1234' }),
  });
  expect(res.status).toBe(200);
  return cookieFrom(res);
}

function authHeaders(c: string = cookie): Record<string, string> {
  return { 'content-type': 'application/json', cookie: c };
}

beforeAll(async () => {
  db = await createTestDb();
  const sessions = new SessionService(db.prisma);
  const stubFactory: LlmProviderFactory = () => ({
    runTurn: async () => ({ text: '', toolCalls: [], stopReason: 'stop' }),
    complete: async () => '',
  });
  const deps: AppDeps = {
    config: resolveServerConfig({}),
    auth: createAuth(db.prisma),
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
  cookie = await signUp('default@example.com');
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.cleanup();
});

async function createSession(body: unknown = {}, c: string = cookie): Promise<{ id: string }> {
  const res = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: authHeaders(c),
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return res.json() as Promise<{ id: string }>;
}

describe('HTTP routes', () => {
  it('reports health without authentication', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; gameVersion: string };
    expect(body.status).toBe('ok');
    expect(body.gameVersion).toBe('1.2.3.0');
  });

  it('rejects unauthenticated API access with 401', async () => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });


  it('creates and updates a session', async () => {
    const session = await createSession({ personality: 'Calm' });
    const res = await fetch(`${baseUrl}/api/sessions/${session.id}`, {
      method: 'PATCH',
      headers: authHeaders(),
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
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("forbids access to another user's session with 403", async () => {
    const session = await createSession();
    const otherCookie = await signUp('intruder@example.com');
    const res = await fetch(`${baseUrl}/api/sessions/${session.id}`, {
      headers: authHeaders(otherCookie),
    });
    expect(res.status).toBe(403);
  });

  it('claims a pre-accounts anonymous session on first login', async () => {
    // A session left behind before accounts existed has a null owner.
    const anon = await db.prisma.session.create({ data: { id: 'anon-claim-1' } });
    const claim = await fetch(`${baseUrl}/api/sessions/${anon.id}/claim`, {
      method: 'POST',
      headers: authHeaders(),
    });
    expect(claim.status).toBe(200);
    // Now owned: a plain read succeeds.
    const read = await fetch(`${baseUrl}/api/sessions/${anon.id}`, { headers: authHeaders() });
    expect(read.status).toBe(200);
  });

  it('refuses to claim a session owned by another user with 403', async () => {
    const session = await createSession();
    const otherCookie = await signUp('claimant@example.com');
    const claim = await fetch(`${baseUrl}/api/sessions/${session.id}/claim`, {
      method: 'POST',
      headers: authHeaders(otherCookie),
    });
    expect(claim.status).toBe(403);
  });

  it('creates a new order, lists it, then starts it to become active', async () => {
    const session = await createSession();
    const create = await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders`, {
      method: 'POST',
      headers: authHeaders(),
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

    const list = await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders`, {
      headers: authHeaders(),
    });
    expect(((await list.json()) as unknown[]).length).toBe(1);

    const start = await fetch(
      `${baseUrl}/api/sessions/${session.id}/work-orders/${order.id}/transitions`,
      {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'Start', actor: 'Pioneer' }),
      },
    );
    expect(start.status).toBe(200);

    const active = await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders/active`, {
      headers: authHeaders(),
    });
    expect(active.status).toBe(200);
    expect(((await active.json()) as { state: string }).state).toBe('active');
  });

  it('does not supersede the previous order on a second create (one active max)', async () => {
    const session = await createSession();
    const post = async (title: string): Promise<{ id: string }> => {
      const res = await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ ...workOrderBody, title }),
      });
      return res.json() as Promise<{ id: string }>;
    };
    const first = await post('First');
    await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders/${first.id}/transitions`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action: 'Start', actor: 'Pioneer' }),
    });
    await post('Second');

    // First is still active (not superseded); Second sits in `new`.
    const active = await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders/active`, {
      headers: authHeaders(),
    });
    expect(((await active.json()) as { title: string }).title).toBe('First');
    const list = (await (
      await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders`, { headers: authHeaders() })
    ).json()) as {
      state: string;
    }[];
    expect(list).toHaveLength(2);
    expect(list.filter((o) => o.state === 'active')).toHaveLength(1);
  });

  it('404s the active endpoint when nothing is active', async () => {
    const session = await createSession();
    const res = await fetch(`${baseUrl}/api/sessions/${session.id}/work-orders/active`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it('404s work orders for an unknown session', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/does-not-exist/work-orders`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});
