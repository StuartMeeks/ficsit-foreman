import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PlaythroughService } from '../src/services/playthroughService.js';
import { createTestDb, createTestForeman, createTestUser, type TestDb } from './helpers.js';

let db: TestDb;
let service: PlaythroughService;
let userId: string;
let foremanId: string;

beforeAll(async () => {
  db = await createTestDb();
  service = new PlaythroughService(db.prisma);
  userId = await createTestUser(db.prisma);
  foremanId = await createTestForeman(db.prisma, userId, 'Gruff');
});

afterAll(async () => {
  await db.cleanup();
});

describe('PlaythroughService', () => {
  it('creates a playthrough with a generated id and stored fields', async () => {
    const playthrough = await service.create({
      userId,
      foremanId,
      name: 'Iron World',
      pioneerProfile: 'Veteran',
    });
    expect(playthrough.id).toMatch(/[0-9a-f-]{36}/);
    expect(playthrough.foremanId).toBe(foremanId);
    expect(playthrough.name).toBe('Iron World');
    expect(playthrough.pioneerProfile).toBe('Veteran');
  });

  it('honours a client-supplied id', async () => {
    const playthrough = await service.create({ userId, foremanId, id: 'fixed-id' });
    expect(playthrough.id).toBe('fixed-id');
    expect(await service.get('fixed-id')).toBeDefined();
  });

  it('updates the pioneer profile without clobbering the name', async () => {
    const created = await service.create({
      userId,
      foremanId,
      name: 'Run One',
      pioneerProfile: 'First playthrough',
    });
    const updated = await service.update(created.id, { pioneerProfile: 'Now min-maxing' });
    expect(updated?.pioneerProfile).toBe('Now min-maxing');
    expect(updated?.name).toBe('Run One');
  });

  it('swaps the attached foreman', async () => {
    const other = await createTestForeman(db.prisma, userId, 'Calm');
    const created = await service.create({ userId, foremanId });
    const updated = await service.update(created.id, { foremanId: other });
    expect(updated?.foremanId).toBe(other);
  });

  it('returns undefined when updating an unknown playthrough', async () => {
    expect(await service.update('nope', { pioneerProfile: 'x' })).toBeUndefined();
  });

  it('windows recent messages in chronological order', async () => {
    const playthrough = await service.create({ userId, foremanId });
    for (let i = 1; i <= 25; i += 1) {
      await service.appendMessage(playthrough.id, i % 2 === 1 ? 'user' : 'assistant', `msg-${i}`);
    }
    const recent = await service.recentMessages(playthrough.id, 20);
    expect(recent).toHaveLength(20);
    // The oldest five (msg-1..msg-5) drop out; the window is chronological.
    expect(recent[0]?.content).toBe('msg-6');
    expect(recent[recent.length - 1]?.content).toBe('msg-25');
  });
});
