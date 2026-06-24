import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runChat, type ChatDeps } from '../src/llm/chat.js';
import type { LlmProvider } from '../src/llm/provider.js';
import type { LlmRequest, LlmStreamEvent, LlmTurnResult } from '../src/llm/types.js';
import type { McpGateway, ToolDefinition, ToolInvocationResult } from '../src/mcp/client.js';
import { SessionService } from '../src/services/sessionService.js';
import { WorkOrderService } from '../src/services/workOrderService.js';
import type { WorkOrder } from '../src/types.js';
import { createTestDb, type TestDb } from './helpers.js';

let db: TestDb;

const validWorkOrderInput = {
  title: 'Establish Iron Plate Line',
  goal: 'Make 20 plates per minute.',
  buildMaterials: [{ itemName: 'Iron Ingot', requiredQuantity: 30 }],
  buildSteps: [{ title: 'Place constructors' }],
  expectedOutputs: [{ kind: 'item', item: 'Iron Plate', perMinute: 20 }],
};

/** A scripted provider: returns queued turns, emitting their text as a delta. */
class FakeLlmProvider implements LlmProvider {
  public readonly requests: LlmRequest[] = [];
  public constructor(private readonly queue: LlmTurnResult[]) {}
  public async runTurn(
    req: LlmRequest,
    onEvent: (event: LlmStreamEvent) => void,
  ): Promise<LlmTurnResult> {
    this.requests.push(req);
    const result = this.queue.shift();
    if (result === undefined) {
      throw new Error('FakeLlmProvider: no scripted turn left');
    }
    if (result.text.length > 0) {
      onEvent({ type: 'text', delta: result.text });
    }
    return result;
  }
  public async complete(): Promise<string> {
    return '';
  }
}

function fakeMcp(): McpGateway & { calls: { name: string; args: Record<string, unknown> }[] } {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    gameVersion: '1.2.3.0',
    calls,
    listTools: async (): Promise<ToolDefinition[]> => [
      { name: 'get_recipe', description: 'recipe', inputSchema: { type: 'object' } },
    ],
    callTool: async (name, args): Promise<ToolInvocationResult> => {
      calls.push({ name, args });
      return { text: 'Iron Plate: 1 Iron Ingot → 1 plate.', isError: false };
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
    const sessions = new SessionService(db.prisma);
    const workOrders = new WorkOrderService(db.prisma);
    const mcp = fakeMcp();
    const session = await sessions.create({ personality: 'Gruff', pioneerProfile: 'Veteran' });
    await sessions.appendMessage(session.id, 'user', 'Get me started on iron.');

    const provider = new FakeLlmProvider([
      {
        text: 'Let me check the recipe. ',
        toolCalls: [{ id: 't1', name: 'get_recipe', arguments: { name: 'Iron Plate' } }],
        stopReason: 'tool_use',
      },
      {
        text: '',
        toolCalls: [{ id: 't2', name: 'create_work_order', arguments: validWorkOrderInput }],
        stopReason: 'tool_use',
      },
      { text: 'Order issued. Get to it.', toolCalls: [], stopReason: 'stop' },
    ]);

    const deps: ChatDeps = {
      systemPromptTemplate:
        'You are the Foreman. <p>{{PERSONALITY}}</p> <q>{{PIONEER_PROFILE}}</q>',
      historyWindow: 20,
      sessions,
      workOrders,
      mcp,
    };

    const textChunks: string[] = [];
    const toolNames: string[] = [];
    const orders: WorkOrder[] = [];
    const finalText = await runChat({ session, provider, model: 'm', maxTokens: 1024 }, deps, {
      text: (delta) => textChunks.push(delta),
      toolUse: (name) => toolNames.push(name),
      workOrder: (order) => orders.push(order),
    });

    expect(finalText).toBe('Let me check the recipe. Order issued. Get to it.');
    expect(textChunks).toEqual(['Let me check the recipe. ', 'Order issued. Get to it.']);
    expect(toolNames).toEqual(['get_recipe', 'create_work_order']);
    expect(mcp.calls).toEqual([{ name: 'get_recipe', args: { name: 'Iron Plate' } }]);

    expect(orders).toHaveLength(1);
    const stored = await workOrders.list(session.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.state).toBe('new');
    expect(stored[0]?.version).toBe('1.2.3.0');

    // Personality was substituted into the system prompt the provider received.
    expect(provider.requests[0]?.system).toContain('Gruff');
    expect(provider.requests[0]?.system).not.toContain('{{PERSONALITY}}');
  });

  it('returns immediately when the first turn has no tool use', async () => {
    const sessions = new SessionService(db.prisma);
    const workOrders = new WorkOrderService(db.prisma);
    const session = await sessions.create({});
    await sessions.appendMessage(session.id, 'user', 'Hello.');

    const provider = new FakeLlmProvider([
      { text: 'Just chatting.', toolCalls: [], stopReason: 'stop' },
    ]);

    const deps: ChatDeps = {
      systemPromptTemplate: 'Prompt {{PERSONALITY}} {{PIONEER_PROFILE}}',
      historyWindow: 20,
      sessions,
      workOrders,
      mcp: fakeMcp(),
    };

    const finalText = await runChat({ session, provider, model: 'm', maxTokens: 1024 }, deps, {
      text: () => {},
      toolUse: () => {},
      workOrder: () => {},
    });
    expect(finalText).toBe('Just chatting.');
    expect(provider.requests).toHaveLength(1);
  });
});
