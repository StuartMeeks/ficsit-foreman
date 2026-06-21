import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Shared scripting state for the mocked Anthropic SDK. `queue` holds the
// sequence of final messages the fake client returns, one per stream() call.
const state = vi.hoisted(() => ({
  queue: [] as Array<{ stop_reason: string; content: unknown[] }>,
  streamParams: [] as unknown[],
}));

vi.mock('@anthropic-ai/sdk', () => {
  class FakeStream {
    private textListener: ((delta: string, snapshot: string) => void) | undefined;
    public constructor(private readonly message: { stop_reason: string; content: unknown[] }) {}
    public on(event: string, listener: (delta: string, snapshot: string) => void): this {
      if (event === 'text') {
        this.textListener = listener;
      }
      return this;
    }
    public async finalMessage(): Promise<{ stop_reason: string; content: unknown[] }> {
      for (const block of this.message.content) {
        const typed = block as { type: string; text?: string };
        if (typed.type === 'text' && typed.text !== undefined && this.textListener !== undefined) {
          this.textListener(typed.text, typed.text);
        }
      }
      return this.message;
    }
  }
  class FakeAnthropic {
    public messages = {
      stream: (params: unknown): FakeStream => {
        state.streamParams.push(params);
        const message = state.queue.shift();
        if (message === undefined) {
          throw new Error('FakeAnthropic: no scripted message left');
        }
        return new FakeStream(message);
      },
    };
    public constructor(public readonly opts: unknown) {}
  }
  return { default: FakeAnthropic };
});

import { runChat, type ChatDeps } from '../src/anthropic/chat.js';
import type { McpGateway, ToolDefinition, ToolInvocationResult } from '../src/mcp/client.js';
import { SessionService } from '../src/services/sessionService.js';
import { WorkOrderService } from '../src/services/workOrderService.js';
import type { WorkOrder } from '../src/types.js';
import { createTestDb, type TestDb } from './helpers.js';

let db: TestDb;

const validWorkOrderInput = {
  title: 'Establish Iron Plate Line',
  objective: 'Make 20 plates per minute.',
  tier: 1,
  estimatedDuration: '15 minutes',
  requiredItems: [{ item: 'Iron Ingot', quantity: 30, unit: 'per minute' }],
  buildSteps: ['Place constructors'],
  expectedOutput: [{ item: 'Iron Plate', perMinute: 20 }],
};

function fakeMcp(): McpGateway & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    gameVersion: '1.2.3.0',
    calls,
    listTools: async (): Promise<ToolDefinition[]> => [
      { name: 'get_recipe', description: 'recipe', inputSchema: { type: 'object' } },
    ],
    callTool: async (name, args): Promise<ToolInvocationResult> => {
      calls.push({ name, args });
      return { text: 'Iron Plate: 1 Iron Ingot → 1 plate (per recipe).', isError: false };
    },
  };
}

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.cleanup();
});

describe('runChat tool-use loop', () => {
  it('drives game-data and work-order tools, then returns the final text', async () => {
    state.queue = [
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me check the recipe. ' },
          { type: 'tool_use', id: 't1', name: 'get_recipe', input: { name: 'Iron Plate' } },
        ],
      },
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 't2', name: 'create_work_order', input: validWorkOrderInput },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Order issued. Get to it.' }] },
    ];
    state.streamParams = [];

    const sessions = new SessionService(db.prisma);
    const workOrders = new WorkOrderService(db.prisma);
    const mcp = fakeMcp();
    const session = await sessions.create({ personality: 'Gruff', pioneerProfile: 'Veteran' });
    await sessions.appendMessage(session.id, 'user', 'Get me started on iron.');

    const deps: ChatDeps = {
      model: 'claude-sonnet-4-6',
      maxTokens: 1024,
      systemPromptTemplate: 'You are the Foreman. <p>{{PERSONALITY}}</p> <q>{{PIONEER_PROFILE}}</q>',
      historyWindow: 20,
      sessions,
      workOrders,
      mcp,
    };

    const textChunks: string[] = [];
    const toolNames: string[] = [];
    const orders: WorkOrder[] = [];
    const finalText = await runChat({ session, apiKey: 'test-key' }, deps, {
      text: (delta) => textChunks.push(delta),
      toolUse: (name) => toolNames.push(name),
      workOrder: (order) => orders.push(order),
    });

    // Streamed text spans both text-bearing turns.
    expect(finalText).toBe('Let me check the recipe. Order issued. Get to it.');
    expect(textChunks).toEqual(['Let me check the recipe. ', 'Order issued. Get to it.']);

    // Both tools were invoked, in order.
    expect(toolNames).toEqual(['get_recipe', 'create_work_order']);
    expect(mcp.calls).toEqual([{ name: 'get_recipe', args: { name: 'Iron Plate' } }]);

    // The work order was persisted and surfaced.
    expect(orders).toHaveLength(1);
    const stored = await workOrders.list(session.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.status).toBe('active');
    expect(stored[0]?.version).toBe('1.2.3.0');

    // The personality was substituted into the system prompt sent to Anthropic.
    const firstCall = state.streamParams[0] as { system: string };
    expect(firstCall.system).toContain('Gruff');
    expect(firstCall.system).not.toContain('{{PERSONALITY}}');
  });

  it('returns immediately when the first response has no tool use', async () => {
    state.queue = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Just chatting.' }] }];
    state.streamParams = [];

    const sessions = new SessionService(db.prisma);
    const workOrders = new WorkOrderService(db.prisma);
    const session = await sessions.create({});
    await sessions.appendMessage(session.id, 'user', 'Hello.');

    const deps: ChatDeps = {
      model: 'claude-sonnet-4-6',
      maxTokens: 1024,
      systemPromptTemplate: 'Prompt {{PERSONALITY}} {{PIONEER_PROFILE}}',
      historyWindow: 20,
      sessions,
      workOrders,
      mcp: fakeMcp(),
    };

    const finalText = await runChat({ session, apiKey: 'k' }, deps, {
      text: () => {},
      toolUse: () => {},
      workOrder: () => {},
    });
    expect(finalText).toBe('Just chatting.');
    expect(state.streamParams).toHaveLength(1);
  });
});
