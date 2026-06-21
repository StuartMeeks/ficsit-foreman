import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SummaryService, type SummaryClient } from '../src/anthropic/summary.js';
import { SessionService } from '../src/services/sessionService.js';
import { createTestDb, type TestDb } from './helpers.js';

let db: TestDb;
let sessions: SessionService;

const config = { summaryModel: 'claude-haiku-4-5', summaryMaxTokens: 512, historyWindow: 5 };

/** A fake client capturing the params and returning a canned summary. */
function fakeClient(): {
  client: SummaryClient;
  factory: () => SummaryClient;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  const client: SummaryClient = {
    messages: {
      create: async (params) => {
        calls.push(params);
        return { content: [{ type: 'text', text: 'A concise session summary.' }] };
      },
    },
  };
  return { client, factory: () => client, calls };
}

beforeAll(async () => {
  db = await createTestDb();
  sessions = new SessionService(db.prisma);
});

afterAll(async () => {
  await db.cleanup();
});

async function seedMessages(count: number): Promise<string> {
  const session = await sessions.create({});
  for (let i = 1; i <= count; i += 1) {
    await sessions.appendMessage(session.id, i % 2 === 1 ? 'user' : 'assistant', `msg-${i}`);
  }
  return session.id;
}

describe('SummaryService.shouldSummarise', () => {
  it('triggers only once the count exceeds twice the window', () => {
    const service = new SummaryService(sessions, config, fakeClient().factory);
    expect(service.shouldSummarise(config.historyWindow * 2)).toBe(false);
    expect(service.shouldSummarise(config.historyWindow * 2 + 1)).toBe(true);
  });
});

describe('SummaryService.summarise', () => {
  it('folds the prior summary and transcript into the request', async () => {
    const fake = fakeClient();
    const service = new SummaryService(sessions, config, fake.factory);
    const result = await service.summarise(
      'key',
      [
        { role: 'user', content: 'Build iron.' },
        { role: 'assistant', content: 'On it.' },
      ],
      'Earlier: set up power.',
    );
    expect(result).toBe('A concise session summary.');
    const params = fake.calls[0] as { model: string; system: string; messages: { content: string }[] };
    expect(params.model).toBe('claude-haiku-4-5');
    expect(params.system).toContain('Summarise this Satisfactory factory session');
    expect(params.messages[0]?.content).toContain('Earlier: set up power.');
    expect(params.messages[0]?.content).toContain('Pioneer: Build iron.');
    expect(params.messages[0]?.content).toContain('Foreman: On it.');
  });
});

describe('SummaryService.summariseIfNeeded', () => {
  it('does nothing below the threshold', async () => {
    const fake = fakeClient();
    const service = new SummaryService(sessions, config, fake.factory);
    const sessionId = await seedMessages(config.historyWindow * 2); // exactly 2x — not past
    await service.summariseIfNeeded(sessionId, 'key');
    expect(fake.calls).toHaveLength(0);
    expect((await sessions.get(sessionId))?.summary).toBeUndefined();
  });

  it('summarises and stores once past the threshold', async () => {
    const fake = fakeClient();
    const service = new SummaryService(sessions, config, fake.factory);
    const sessionId = await seedMessages(config.historyWindow * 2 + 2);
    await service.summariseIfNeeded(sessionId, 'key');
    expect(fake.calls).toHaveLength(1);
    // Only messages outside the window are summarised.
    const params = fake.calls[0] as { messages: { content: string }[] };
    expect(params.messages[0]?.content).toContain('msg-1');
    expect(params.messages[0]?.content).not.toContain(`msg-${config.historyWindow * 2 + 2}`);
    expect((await sessions.get(sessionId))?.summary).toBe('A concise session summary.');
  });

  it('never throws when the Anthropic call fails', async () => {
    const failing: SummaryClient = {
      messages: {
        create: async () => {
          throw new Error('boom');
        },
      },
    };
    const service = new SummaryService(sessions, config, () => failing);
    const sessionId = await seedMessages(config.historyWindow * 2 + 2);
    await expect(service.summariseIfNeeded(sessionId, 'key')).resolves.toBeUndefined();
    expect((await sessions.get(sessionId))?.summary).toBeUndefined();
  });
});
