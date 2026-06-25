import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SummaryService } from '../src/llm/summary.js';
import type { LlmCompletionRequest, LlmRuntimeConfig } from '../src/llm/types.js';
import type { LlmProvider, LlmProviderFactory } from '../src/llm/provider.js';
import { PlaythroughService } from '../src/services/playthroughService.js';
import { createTestDb, createTestForeman, createTestUser, type TestDb } from './helpers.js';

let db: TestDb;
let playthroughs: PlaythroughService;
let userId: string;
let foremanId: string;

const config = { historyWindow: 5 };

const llm: LlmRuntimeConfig = {
  providerKind: 'anthropic',
  model: 'claude-sonnet-4-6',
  summaryModel: 'claude-haiku-4-5',
  maxTokens: 1024,
  summaryMaxTokens: 512,
  apiKey: 'k',
};

/** A fake provider factory capturing the completion requests it receives. */
function fakeFactory(text = 'A concise playthrough summary.'): {
  factory: LlmProviderFactory;
  calls: LlmCompletionRequest[];
} {
  const calls: LlmCompletionRequest[] = [];
  const provider: LlmProvider = {
    runTurn: async () => ({ text: '', toolCalls: [], stopReason: 'stop' }),
    complete: async (req) => {
      calls.push(req);
      return text;
    },
  };
  return { factory: () => provider, calls };
}

beforeAll(async () => {
  db = await createTestDb();
  playthroughs = new PlaythroughService(db.prisma);
  userId = await createTestUser(db.prisma);
  foremanId = await createTestForeman(db.prisma, userId);
});

afterAll(async () => {
  await db.cleanup();
});

async function seedMessages(count: number): Promise<string> {
  const playthrough = await playthroughs.create({ userId, foremanId });
  for (let i = 1; i <= count; i += 1) {
    await playthroughs.appendMessage(
      playthrough.id,
      i % 2 === 1 ? 'user' : 'assistant',
      `msg-${i}`,
    );
  }
  return playthrough.id;
}

describe('SummaryService.shouldSummarise', () => {
  it('triggers only once the count exceeds twice the window', () => {
    const service = new SummaryService(playthroughs, config, fakeFactory().factory);
    expect(service.shouldSummarise(config.historyWindow * 2)).toBe(false);
    expect(service.shouldSummarise(config.historyWindow * 2 + 1)).toBe(true);
  });
});

describe('SummaryService.summarise', () => {
  it('uses the summary model and folds prior summary + transcript', async () => {
    const fake = fakeFactory();
    const service = new SummaryService(playthroughs, config, fake.factory);
    const provider = fake.factory(llm);
    const result = await service.summarise(
      provider,
      llm,
      [
        { role: 'user', content: 'Build iron.' },
        { role: 'assistant', content: 'On it.' },
      ],
      'Earlier: set up power.',
    );
    expect(result).toBe('A concise playthrough summary.');
    const req = fake.calls[0];
    expect(req?.model).toBe('claude-haiku-4-5');
    expect(req?.system).toContain('Summarise this Satisfactory factory session');
    expect(req?.userText).toContain('Earlier: set up power.');
    expect(req?.userText).toContain('Pioneer: Build iron.');
    expect(req?.userText).toContain('Foreman: On it.');
  });
});

describe('SummaryService.summariseIfNeeded', () => {
  it('does nothing below the threshold', async () => {
    const fake = fakeFactory();
    const service = new SummaryService(playthroughs, config, fake.factory);
    const playthroughId = await seedMessages(config.historyWindow * 2);
    await service.summariseIfNeeded(playthroughId, llm);
    expect(fake.calls).toHaveLength(0);
    expect((await playthroughs.get(playthroughId))?.summary).toBeUndefined();
  });

  it('summarises and stores once past the threshold', async () => {
    const fake = fakeFactory();
    const service = new SummaryService(playthroughs, config, fake.factory);
    const playthroughId = await seedMessages(config.historyWindow * 2 + 2);
    await service.summariseIfNeeded(playthroughId, llm);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.userText).toContain('msg-1');
    expect(fake.calls[0]?.userText).not.toContain(`msg-${config.historyWindow * 2 + 2}`);
    expect((await playthroughs.get(playthroughId))?.summary).toBe('A concise playthrough summary.');
  });

  it('never throws when the provider fails', async () => {
    const failing: LlmProviderFactory = () => ({
      runTurn: async () => ({ text: '', toolCalls: [], stopReason: 'stop' }),
      complete: async () => {
        throw new Error('boom');
      },
    });
    const service = new SummaryService(playthroughs, config, failing);
    const playthroughId = await seedMessages(config.historyWindow * 2 + 2);
    await expect(service.summariseIfNeeded(playthroughId, llm)).resolves.toBeUndefined();
    expect((await playthroughs.get(playthroughId))?.summary).toBeUndefined();
  });
});
