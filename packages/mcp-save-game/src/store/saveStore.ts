import path from 'node:path';

import { loadItemNames } from '../gameData.js';
import { logger } from '../logger.js';
import { emptySaveState, normaliseSave, type SaveState } from '../normalise/index.js';
import { parseSaveFile } from '../parser/index.js';
import { statMtimeMs } from '../parser/reader.js';

/** Injectable seams so the store can be unit-tested without real file I/O. */
export interface SaveStoreDeps {
  statMtime?: (filePath: string) => number;
  load?: (filePath: string) => SaveState;
  now?: () => string;
  /** Override the className→displayName map (tests); otherwise loaded lazily. */
  itemNames?: Map<string, string>;
}

/**
 * Holds the current normalised `SaveState` and re-parses lazily when the save
 * file's mtime changes, so the foreman sees progress as the pioneer plays
 * without a restart. If parsing fails it keeps the previous state. With no save
 * path configured it serves an empty state (never crashes).
 */
export class SaveStore {
  private current: SaveState;
  private loadedMtimeMs = Number.NaN;
  private readonly statMtime: (filePath: string) => number;
  private readonly load: (filePath: string) => SaveState;
  private readonly now: () => string;

  public constructor(
    private readonly savePath: string | undefined,
    deps: SaveStoreDeps = {},
  ) {
    this.statMtime = deps.statMtime ?? statMtimeMs;
    this.now = deps.now ?? (() => new Date().toISOString());
    // Item display names from the game data, loaded once on the first real parse
    // (lazy so tests that inject `load` never trigger the game-data read).
    let itemNames = deps.itemNames;
    this.load =
      deps.load ??
      ((filePath: string): SaveState => {
        itemNames ??= loadItemNames();
        return normaliseSave(
          parseSaveFile(filePath, path.basename(filePath)),
          this.now(),
          itemNames,
        ).state;
      });
    this.current = emptySaveState(
      'unknown',
      savePath === undefined ? 'none' : path.basename(savePath),
      this.now(),
    );
    this.refresh();
  }

  /** Builds a store directly from a state — for tests and fixtures (no I/O). */
  public static fromState(state: SaveState): SaveStore {
    const store = new SaveStore(undefined);
    store.current = state;
    return store;
  }

  public get version(): string {
    return this.current.version;
  }

  public get saveName(): string {
    return this.current.saveName;
  }

  /** The current state, re-parsing first if the save file changed on disk. */
  public getState(): SaveState {
    this.refresh();
    return this.current;
  }

  private refresh(): void {
    if (this.savePath === undefined) {
      return;
    }
    let mtime: number;
    try {
      mtime = this.statMtime(this.savePath);
    } catch (error) {
      logger.error(`Could not stat save file '${this.savePath}':`, error);
      return;
    }
    if (mtime === this.loadedMtimeMs) {
      return;
    }
    try {
      this.current = this.load(this.savePath);
      this.loadedMtimeMs = mtime;
      logger.info(
        `Loaded save '${this.current.saveName}' (${this.current.version}); ` +
          `${this.current.warnings.length} parse warning(s).`,
      );
    } catch (error) {
      logger.error(`Failed to parse save file '${this.savePath}' — keeping previous state:`, error);
    }
  }
}
