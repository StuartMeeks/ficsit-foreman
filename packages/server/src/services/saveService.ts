import fs from 'node:fs';
import path from 'node:path';

import type { PrismaClient } from '@prisma/client';

import { logger } from '../logger.js';
import type { McpGateway } from '../mcp/client.js';
import type { SaveUploadResult, SaveWarning } from '../types.js';
import { rowToSave } from './playthroughService.js';

/** An uploaded file's bytes + metadata, as handed over by the upload route. */
export interface UploadedSave {
  fileName: string;
  bytes: Buffer;
}

/** Metadata parsed from a `.sav` header (best-effort; absent if unparsable). */
interface SaveMetadata {
  saveName?: string;
  version?: string;
  sessionName?: string;
  mapName?: string;
  buildVersion?: number;
  saveVersion?: number;
  playDurationSeconds?: number;
}

/**
 * Stores the current `.sav` for a playthrough and tracks its metadata. The bytes
 * live on a data volume at `<saveDataDir>/<playthroughId>.sav` (latest-only:
 * re-uploading replaces the file and the row — version history is #76). Metadata
 * (in-game save name + version) is read via the save-game MCP's `describe_save`
 * tool, which reads the same shared volume by absolute path; if that MCP is not
 * configured the upload still succeeds, just without parsed metadata.
 */
export class SaveService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly mcp: McpGateway,
    private readonly saveDataDir: string,
  ) {}

  /**
   * Absolute on-disk path for a playthrough's save (whether or not it exists).
   *
   * The playthrough id can originate from a client (it may be supplied when
   * claiming a pre-accounts playthrough), so it is untrusted input flowing into
   * a filesystem path. Resolve against the data directory and require the result
   * to stay directly within it, rejecting any traversal (`..`) or separators —
   * defence-in-depth alongside the filename-safe id validation at the route.
   */
  public savePathFor(playthroughId: string): string {
    const root = path.resolve(this.saveDataDir);
    const resolved = path.resolve(root, `${playthroughId}.sav`);
    if (path.dirname(resolved) !== root || !resolved.startsWith(root + path.sep)) {
      throw new Error(`Unsafe save path for playthrough id '${playthroughId}'.`);
    }
    return resolved;
  }

  /** The save path if a save is attached to the playthrough, else undefined. */
  public async getSavePath(playthroughId: string): Promise<string | undefined> {
    const row = await this.prisma.save.findUnique({
      where: { playthroughId },
      select: { id: true },
    });
    return row === null ? undefined : this.savePathFor(playthroughId);
  }

  /**
   * Stores (or replaces) the playthrough's save: writes the bytes, parses
   * metadata, upserts the Save row, and — when the playthrough has no name yet —
   * seeds its name from the save. Returns the stored save's API shape.
   */
  public async upsertSave(playthroughId: string, file: UploadedSave): Promise<SaveUploadResult> {
    fs.mkdirSync(this.saveDataDir, { recursive: true });
    const filePath = this.savePathFor(playthroughId);
    fs.writeFileSync(filePath, file.bytes);

    const metadata = await this.describe(filePath);
    const data = {
      fileName: file.fileName,
      saveName: metadata.saveName ?? null,
      version: metadata.version ?? null,
      sessionName: metadata.sessionName ?? null,
      mapName: metadata.mapName ?? null,
      buildVersion: metadata.buildVersion ?? null,
      saveVersion: metadata.saveVersion ?? null,
      playDurationSeconds: metadata.playDurationSeconds ?? null,
      sizeBytes: file.bytes.length,
    };

    const row = await this.prisma.save.upsert({
      where: { playthroughId },
      create: { playthroughId, ...data },
      update: { ...data, uploadedAt: new Date() },
    });

    // Default the playthrough's name from the save's in-game name when unset.
    if (metadata.saveName !== undefined && metadata.saveName.length > 0) {
      const playthrough = await this.prisma.playthrough.findUnique({
        where: { id: playthroughId },
        select: { name: true },
      });
      if (playthrough !== null && (playthrough.name === null || playthrough.name.length === 0)) {
        await this.prisma.playthrough.update({
          where: { id: playthroughId },
          data: { name: metadata.saveName },
        });
      }
    }

    return { save: rowToSave(row), warnings: this.versionWarnings(metadata) };
  }

  /**
   * Advisory warnings for an uploaded save. For now: the save's build vs the
   * loaded game-data build. Only warns when BOTH are known and differ — an
   * unknown build (older data, MCP unreachable) is silent rather than a false
   * positive.
   */
  private versionWarnings(metadata: SaveMetadata): SaveWarning[] {
    const saveBuild = metadata.buildVersion;
    const gameDataBuild = this.mcp.gameBuild;
    if (saveBuild === undefined || gameDataBuild === undefined || saveBuild === gameDataBuild) {
      return [];
    }
    return [
      {
        kind: 'build_mismatch',
        saveBuild,
        gameDataBuild,
        message:
          `This save is from Satisfactory build ${saveBuild}, but the foreman's game ` +
          `data is build ${gameDataBuild}. Recipes or build costs may not match — ` +
          `update the game data, or expect occasional discrepancies.`,
      },
    ];
  }

  /** Removes the stored save file for a playthrough (best-effort). */
  public removeSaveFile(playthroughId: string): void {
    try {
      fs.rmSync(this.savePathFor(playthroughId), { force: true });
    } catch (error) {
      logger.warn(`Could not remove save file for playthrough '${playthroughId}':`, error);
    }
  }

  /**
   * Asks the save-game MCP to read the header and return name + version. Never
   * throws — a missing/unreachable save MCP just yields empty metadata.
   */
  private async describe(savePath: string): Promise<SaveMetadata> {
    try {
      const result = await this.mcp.callTool('describe_save', { savePath });
      if (result.isError) {
        return {};
      }
      const parsed = JSON.parse(result.text) as Partial<SaveMetadata>;
      const metadata: SaveMetadata = {};
      if (typeof parsed.saveName === 'string' && parsed.saveName.length > 0) {
        metadata.saveName = parsed.saveName;
      }
      if (typeof parsed.version === 'string' && parsed.version.length > 0) {
        metadata.version = parsed.version;
      }
      if (typeof parsed.sessionName === 'string' && parsed.sessionName.length > 0) {
        metadata.sessionName = parsed.sessionName;
      }
      if (typeof parsed.mapName === 'string' && parsed.mapName.length > 0) {
        metadata.mapName = parsed.mapName;
      }
      if (typeof parsed.buildVersion === 'number') {
        metadata.buildVersion = parsed.buildVersion;
      }
      if (typeof parsed.saveVersion === 'number') {
        metadata.saveVersion = parsed.saveVersion;
      }
      if (typeof parsed.playDurationSeconds === 'number') {
        metadata.playDurationSeconds = parsed.playDurationSeconds;
      }
      return metadata;
    } catch (error) {
      logger.warn('Could not parse save metadata via describe_save:', error);
      return {};
    }
  }
}
