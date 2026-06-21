import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SessionService } from '../src/services/sessionService.js';
import { createTestDb, type TestDb } from './helpers.js';

let db: TestDb;
let service: SessionService;

beforeAll(async () => {
  db = await createTestDb();
  service = new SessionService(db.prisma);
});

afterAll(async () => {
  await db.cleanup();
});

describe('SessionService', () => {
  it('creates a session with a generated id and stored strings', async () => {
    const session = await service.create({ personality: 'Gruff', pioneerProfile: 'Veteran' });
    expect(session.id).toMatch(/[0-9a-f-]{36}/);
    expect(session.personality).toBe('Gruff');
    expect(session.pioneerProfile).toBe('Veteran');
  });

  it('honours a client-supplied id', async () => {
    const session = await service.create({ id: 'fixed-id' });
    expect(session.id).toBe('fixed-id');
    expect(await service.get('fixed-id')).toBeDefined();
  });

  it('updates personality without clobbering the profile', async () => {
    const created = await service.create({ personality: 'Calm', pioneerProfile: 'First playthrough' });
    const updated = await service.update(created.id, { personality: 'Drill sergeant' });
    expect(updated?.personality).toBe('Drill sergeant');
    expect(updated?.pioneerProfile).toBe('First playthrough');
  });

  it('returns undefined when updating an unknown session', async () => {
    expect(await service.update('nope', { personality: 'x' })).toBeUndefined();
  });

  it('windows recent messages in chronological order', async () => {
    const session = await service.create({});
    for (let i = 1; i <= 25; i += 1) {
      await service.appendMessage(session.id, i % 2 === 1 ? 'user' : 'assistant', `msg-${i}`);
    }
    const recent = await service.recentMessages(session.id, 20);
    expect(recent).toHaveLength(20);
    // The oldest five (msg-1..msg-5) drop out; the window is chronological.
    expect(recent[0]?.content).toBe('msg-6');
    expect(recent[recent.length - 1]?.content).toBe('msg-25');
  });
});
