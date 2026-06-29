import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runChat, type ChatDeps } from '../src/llm/chat.js';
import type { LlmProvider } from '../src/llm/provider.js';
import type { LlmRequest, LlmStreamEvent, LlmTurnResult } from '../src/llm/types.js';
import type { McpGateway, ToolDefinition, ToolInvocationResult } from '../src/mcp/client.js';
import { PlaythroughService } from '../src/services/playthroughService.js';
import { WorkOrderService } from '../src/services/workOrderService.js';
import type { WorkOrder } from '../src/types.js';
import { createTestDb, createTestForeman, createTestUser, type TestDb } from './helpers.js';

let db: TestDb;
let userId: string;

const validWorkOrderInput = {
  title: 'Establish Iron Plate Line',
  goal: 'Make 20 plates per minute.',
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
  userId = await createTestUser(db.prisma);
});

afterAll(async () => {
  await db.cleanup();
});

describe('runChat tool-use loop', () => {
  it('drives game-data and work-order tools, then returns the final text', async () => {
    const playthroughs = new PlaythroughService(db.prisma);
    const workOrders = new WorkOrderService(db.prisma);
    const mcp = fakeMcp();
    const foremanId = await createTestForeman(db.prisma, userId, 'Gruff');
    const playthrough = await playthroughs.create({
      userId,
      foremanId,
      pioneerProfile: 'Veteran',
    });
    await playthroughs.appendMessage(playthrough.id, 'user', 'Get me started on iron.');

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
      playthroughs,
      workOrders,
      mcp,
    };

    const textChunks: string[] = [];
    const toolNames: string[] = [];
    const orders: WorkOrder[] = [];
    const finalText = await runChat(
      {
        playthroughId: playthrough.id,
        promptContext: { personality: 'Gruff', pioneerProfile: 'Veteran' },
        provider,
        model: 'm',
        maxTokens: 1024,
      },
      deps,
      {
        text: (delta) => textChunks.push(delta),
        toolUse: (name) => toolNames.push(name),
        workOrder: (order) => orders.push(order),
      },
    );

    expect(finalText).toBe('Let me check the recipe. Order issued. Get to it.');
    expect(textChunks).toEqual(['Let me check the recipe. ', 'Order issued. Get to it.']);
    expect(toolNames).toEqual(['get_recipe', 'create_work_order']);
    expect(mcp.calls).toEqual([{ name: 'get_recipe', args: { name: 'Iron Plate' } }]);

    expect(orders).toHaveLength(1);
    const stored = await workOrders.list(playthrough.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.state).toBe('new');
    expect(stored[0]?.version).toBe('1.2.3.0');

    // Personality was substituted into the system prompt the provider received.
    expect(provider.requests[0]?.system).toContain('Gruff');
    expect(provider.requests[0]?.system).not.toContain('{{PERSONALITY}}');
  });

  it('proposes completion: emits the order over SSE and records the audit event, state unchanged', async () => {
    const playthroughs = new PlaythroughService(db.prisma);
    const workOrders = new WorkOrderService(db.prisma);
    const foremanId = await createTestForeman(db.prisma, userId, 'Gruff');
    const playthrough = await playthroughs.create({ userId, foremanId, pioneerProfile: 'Veteran' });
    // Arrange an active order for the foreman to propose completing.
    const order = await workOrders.create(playthrough.id, validWorkOrderInput, '1.2.3.0');
    await workOrders.transition(playthrough.id, order.id, 'Start', 'Pioneer');
    await playthroughs.appendMessage(playthrough.id, 'user', 'Is the iron line done?');

    // workOrderId omitted → the tool resolves the active order.
    const provider = new FakeLlmProvider([
      {
        text: '',
        toolCalls: [
          { id: 'p1', name: 'propose_completion', arguments: { note: 'Looks finished.' } },
        ],
        stopReason: 'tool_use',
      },
      { text: 'Looks done — confirm in-game to close it out.', toolCalls: [], stopReason: 'stop' },
    ]);

    const deps: ChatDeps = {
      systemPromptTemplate: 'Foreman {{PERSONALITY}} {{PIONEER_PROFILE}}',
      historyWindow: 20,
      playthroughs,
      workOrders,
      mcp: fakeMcp(),
    };

    const orders: WorkOrder[] = [];
    const toolNames: string[] = [];
    await runChat(
      {
        playthroughId: playthrough.id,
        promptContext: { personality: 'Gruff', pioneerProfile: 'Veteran' },
        provider,
        model: 'm',
        maxTokens: 1024,
      },
      deps,
      { text: () => {}, toolUse: (name) => toolNames.push(name), workOrder: (o) => orders.push(o) },
    );

    expect(toolNames).toEqual(['propose_completion']);
    // The proposal emits the (unchanged) order over SSE so the panel can refresh.
    expect(orders).toHaveLength(1);
    expect(orders[0]?.state).toBe('active'); // proposing never completes (Option A)
    // ...and it records a completion_proposed audit event — what drives the banner.
    const audit = await workOrders.getAuditTrail(playthrough.id, order.id);
    expect(
      audit.some((e) => e.eventType === 'completion_proposed' && e.note === 'Looks finished.'),
    ).toBe(true);
  });

  it('returns immediately when the first turn has no tool use', async () => {
    const playthroughs = new PlaythroughService(db.prisma);
    const workOrders = new WorkOrderService(db.prisma);
    const foremanId = await createTestForeman(db.prisma, userId);
    const playthrough = await playthroughs.create({ userId, foremanId });
    await playthroughs.appendMessage(playthrough.id, 'user', 'Hello.');

    const provider = new FakeLlmProvider([
      { text: 'Just chatting.', toolCalls: [], stopReason: 'stop' },
    ]);

    const deps: ChatDeps = {
      systemPromptTemplate: 'Prompt {{PERSONALITY}} {{PIONEER_PROFILE}}',
      historyWindow: 20,
      playthroughs,
      workOrders,
      mcp: fakeMcp(),
    };

    const finalText = await runChat(
      {
        playthroughId: playthrough.id,
        promptContext: { personality: '', pioneerProfile: '' },
        provider,
        model: 'm',
        maxTokens: 1024,
      },
      deps,
      {
        text: () => {},
        toolUse: () => {},
        workOrder: () => {},
      },
    );
    expect(finalText).toBe('Just chatting.');
    expect(provider.requests).toHaveLength(1);
  });
});
