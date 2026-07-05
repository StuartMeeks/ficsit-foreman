import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { McpGateway, ToolDefinition, ToolInvocationResult } from '../src/mcp/client.js';
import { SaveService } from '../src/services/saveService.js';
import { WorkOrderService } from '../src/services/workOrderService.js';
import { createTestDb, createTestPlaythrough, createTestUser, type TestDb } from './helpers.js';

/** A save-game MCP stub whose describe_save payload + game build are configurable. */
function fakeMcp(opts: { gameBuild?: number; describe?: Record<string, unknown> }): McpGateway {
  return {
    gameVersion: '1.2.3.1',
    gameBuild: opts.gameBuild,
    listTools: (): Promise<ToolDefinition[]> => Promise.resolve([]),
    callTool: (name): Promise<ToolInvocationResult> =>
      Promise.resolve(
        name === 'describe_save'
          ? { text: JSON.stringify(opts.describe ?? {}), isError: false }
          : { text: '(no output)', isError: false },
      ),
  };
}

describe('SaveService', () => {
  let db: TestDb;
  let saveDir: string;

  beforeEach(async () => {
    db = await createTestDb();
    saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-saves-'));
  });

  afterEach(async () => {
    await db.cleanup();
    fs.rmSync(saveDir, { recursive: true, force: true });
  });

  const svcWith = (mcp: McpGateway): SaveService =>
    new SaveService(db.prisma, mcp, saveDir, new WorkOrderService(db.prisma));
  const bytes = Buffer.from([1, 2, 3, 4]);
  const currentSaveId = async (id: string): Promise<string | null> =>
    (await db.prisma.playthrough.findUnique({ where: { id }, select: { currentSaveId: true } }))
      ?.currentSaveId ?? null;

  it('persists parsed header identity and makes the upload current', async () => {
    const playthroughId = await createTestPlaythrough(db.prisma);
    const svc = svcWith(
      fakeMcp({
        gameBuild: 495413,
        describe: {
          saveName: 'SAM Factory',
          sessionName: 'SAM Factory',
          mapName: 'Persistent_Level',
          buildVersion: 495413,
          saveVersion: 6,
          playDurationSeconds: 1234,
        },
      }),
    );
    const { save, warnings } = await svc.addVersion(playthroughId, { fileName: 'a.sav', bytes });
    expect(save.sessionName).toBe('SAM Factory');
    expect(save.buildVersion).toBe(495413);
    expect(save.playDurationSeconds).toBe(1234);
    expect(warnings).toEqual([]); // build matches → no warning
    expect(await currentSaveId(playthroughId)).toBe(save.id);
    expect(await svc.getSavePath(playthroughId)).toContain(`${playthroughId}/${save.id}.sav`);
  });

  it('warns when the save build differs from the game-data build', async () => {
    const playthroughId = await createTestPlaythrough(db.prisma);
    const svc = svcWith(fakeMcp({ gameBuild: 495413, describe: { buildVersion: 433351 } }));
    const { warnings } = await svc.addVersion(playthroughId, { fileName: 'a.sav', bytes });
    expect(warnings).toEqual([
      expect.objectContaining({ kind: 'build_mismatch', saveBuild: 433351, gameDataBuild: 495413 }),
    ]);
  });

  it('stays silent when either build is unknown (no false positive)', async () => {
    const playthroughId = await createTestPlaythrough(db.prisma);
    const a = svcWith(fakeMcp({ gameBuild: undefined, describe: { buildVersion: 433351 } }));
    expect((await a.addVersion(playthroughId, { fileName: 'a.sav', bytes })).warnings).toEqual([]);
    const b = svcWith(fakeMcp({ gameBuild: 495413, describe: {} }));
    expect((await b.addVersion(playthroughId, { fileName: 'b.sav', bytes })).warnings).toEqual([]);
  });

  it('keeps a version history, newest first, with the latest current', async () => {
    const playthroughId = await createTestPlaythrough(db.prisma);
    const svc = svcWith(fakeMcp({ describe: { playDurationSeconds: 100 } }));
    const first = await svc.addVersion(playthroughId, { fileName: 'a.sav', bytes });
    const second = await svc.addVersion(playthroughId, { fileName: 'b.sav', bytes });
    const history = await svc.listSaves(playthroughId);
    expect(history.map((s) => s.id)).toEqual([second.save.id, first.save.id]);
    expect(await currentSaveId(playthroughId)).toBe(second.save.id);
  });

  it('warns when a re-upload regresses play time', async () => {
    const playthroughId = await createTestPlaythrough(db.prisma);
    const ahead = svcWith(fakeMcp({ describe: { playDurationSeconds: 7200 } }));
    await ahead.addVersion(playthroughId, { fileName: 'late.sav', bytes });
    const behind = svcWith(fakeMcp({ describe: { playDurationSeconds: 3600 } }));
    const { warnings } = await behind.addVersion(playthroughId, { fileName: 'early.sav', bytes });
    expect(warnings).toEqual([expect.objectContaining({ kind: 'playtime_regressed' })]);
  });

  it('re-activates and deletes versions, promoting the newest on current delete', async () => {
    const playthroughId = await createTestPlaythrough(db.prisma);
    const svc = svcWith(fakeMcp({}));
    const v1 = (await svc.addVersion(playthroughId, { fileName: 'a.sav', bytes })).save;
    const v2 = (await svc.addVersion(playthroughId, { fileName: 'b.sav', bytes })).save;
    // Re-activate the older one.
    await svc.setCurrentSave(playthroughId, v1.id);
    expect(await currentSaveId(playthroughId)).toBe(v1.id);
    // Delete the current (v1) → newest remaining (v2) is promoted.
    await svc.deleteSave(playthroughId, v1.id);
    expect(await currentSaveId(playthroughId)).toBe(v2.id);
    expect((await svc.listSaves(playthroughId)).map((s) => s.id)).toEqual([v2.id]);
  });

  it('matches an existing playthrough of the same session+map on preview', async () => {
    const userId = await createTestUser(db.prisma);
    const existing = await createTestPlaythrough(db.prisma, { userId });
    const svc = svcWith(
      fakeMcp({ describe: { sessionName: 'SAM Factory', mapName: 'Persistent_Level' } }),
    );
    await svc.addVersion(existing, { fileName: 'a.sav', bytes });
    const { identity, matches } = await svc.preview(userId, bytes);
    expect(identity.sessionName).toBe('SAM Factory');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ playthroughId: existing, reason: 'session_map_match' });
  });
});
