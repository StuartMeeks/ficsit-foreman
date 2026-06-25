import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { McpGateway, ToolDefinition, ToolInvocationResult } from '../src/mcp/client.js';
import { SaveService } from '../src/services/saveService.js';
import { createTestDb, createTestPlaythrough, type TestDb } from './helpers.js';

/** A save-game MCP stub whose describe_save payload + game build are configurable. */
function fakeMcp(opts: {
  gameBuild?: number;
  describe?: Record<string, unknown>;
}): McpGateway {
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

  const upload = (mcp: McpGateway): SaveService => new SaveService(db.prisma, mcp, saveDir);
  const bytes = Buffer.from([1, 2, 3, 4]);

  it('persists parsed header identity on the save row', async () => {
    const playthroughId = await createTestPlaythrough(db.prisma);
    const svc = upload(
      fakeMcp({
        gameBuild: 495413,
        describe: {
          saveName: 'SAM Factory',
          version: 'build 495413 (save 6)',
          sessionName: 'SAM Factory',
          mapName: 'Persistent_Level',
          buildVersion: 495413,
          saveVersion: 6,
          playDurationSeconds: 1234,
        },
      }),
    );
    const { save, warnings } = await svc.upsertSave(playthroughId, { fileName: 'a.sav', bytes });
    expect(save.sessionName).toBe('SAM Factory');
    expect(save.mapName).toBe('Persistent_Level');
    expect(save.buildVersion).toBe(495413);
    expect(save.playDurationSeconds).toBe(1234);
    // Build matches the loaded game data → no warning.
    expect(warnings).toEqual([]);
  });

  it('warns when the save build differs from the game-data build', async () => {
    const playthroughId = await createTestPlaythrough(db.prisma);
    const svc = upload(fakeMcp({ gameBuild: 495413, describe: { buildVersion: 433351 } }));
    const { warnings } = await svc.upsertSave(playthroughId, { fileName: 'a.sav', bytes });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: 'build_mismatch',
      saveBuild: 433351,
      gameDataBuild: 495413,
    });
  });

  it('stays silent when either build is unknown (no false positive)', async () => {
    const playthroughId = await createTestPlaythrough(db.prisma);
    // Save build known, game-data build unknown.
    const a = upload(fakeMcp({ gameBuild: undefined, describe: { buildVersion: 433351 } }));
    expect((await a.upsertSave(playthroughId, { fileName: 'a.sav', bytes })).warnings).toEqual([]);
    // Game-data build known, save build unknown (e.g. MCP returned no identity).
    const b = upload(fakeMcp({ gameBuild: 495413, describe: {} }));
    expect((await b.upsertSave(playthroughId, { fileName: 'b.sav', bytes })).warnings).toEqual([]);
  });
});
