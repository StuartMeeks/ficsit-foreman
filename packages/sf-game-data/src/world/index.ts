import fs from 'node:fs';
import path from 'node:path';

import { GAME_CHANNELS, bundledDataDir, expandHome, type GameChannel } from '../config.js';
import type { WorldLocations, WorldLocationsResolution } from './types.js';

export type {
  WorldLocations,
  WorldLocationsResolution,
  Collectible,
  ResourceNode,
  LootPickup,
  UnlockCost,
  CollectibleKind,
  ResourceNodeKind,
  Purity,
} from './types.js';

const WORLD_FILENAME = 'world-locations.json';
const DEFAULT_CHANNEL: GameChannel = 'stable';

/** An empty dataset, used when none is resolvable so callers never crash. */
export function emptyWorldLocations(version = 'unknown'): WorldLocations {
  return {
    gameVersion: version,
    build: 0,
    source: 'none',
    counts: {},
    collectibles: [],
    resourceNodes: [],
    lootPickups: [],
  };
}

/** Path to a channel's bundled world-locations file (whether or not it exists). */
export function channelWorldLocationsPath(dataDir: string, channel: GameChannel): string {
  return path.join(dataDir, channel, WORLD_FILENAME);
}

/**
 * Resolves and loads the world-location dataset, in priority order:
 *   1. WORLD_LOCATIONS_PATH — full path to a `world-locations.json`.
 *   2. Bundled channel data under `<sf-game-data>/data/<channel>/`, selected by
 *      SATISFACTORY_GAME_CHANNEL (default `stable`, falling back to the other
 *      channel if the requested one has no dataset).
 *   3. None available → an empty dataset plus a warning.
 *
 * Loading never throws: a missing or malformed file degrades to an empty
 * dataset with a warning, mirroring `resolveDocsPath`.
 */
export function loadWorldLocations(
  env: NodeJS.ProcessEnv = process.env,
  dataDir: string = bundledDataDir(),
): WorldLocationsResolution {
  const warnings: string[] = [];

  const direct = env['WORLD_LOCATIONS_PATH']?.trim();
  if (direct !== undefined && direct !== '') {
    const resolved = expandHome(direct);
    if (fs.existsSync(resolved)) {
      return read(resolved);
    }
    warnings.push(`WORLD_LOCATIONS_PATH is set to '${resolved}' but no file exists there.`);
  }

  const rawChannel = env['SATISFACTORY_GAME_CHANNEL']?.trim().toLowerCase();
  const requested = GAME_CHANNELS.find((channel) => channel === rawChannel) ?? DEFAULT_CHANNEL;
  const preference: GameChannel[] = [requested, ...GAME_CHANNELS.filter((c) => c !== requested)];
  for (const channel of preference) {
    const candidate = channelWorldLocationsPath(dataDir, channel);
    if (fs.existsSync(candidate)) {
      const result = read(candidate);
      const prefix = warnings.length > 0 ? `${warnings.join(' ')} ` : '';
      const note = channel === requested ? '' : ` (requested '${requested}' has no dataset)`;
      const loaded = result.warning ?? `Using bundled ${channel} world locations${note}.`;
      return { ...result, warning: `${prefix}${loaded}` };
    }
  }

  warnings.push(
    `No world-location dataset available: set WORLD_LOCATIONS_PATH or add one under packages/sf-game-data/data/{${GAME_CHANNELS.join(',')}}/${WORLD_FILENAME}. World-location tools will return empty results.`,
  );
  return { world: emptyWorldLocations(), warning: warnings.join(' ') };
}

/** Reads and minimally validates a dataset file; degrades to empty on any fault. */
function read(filePath: string): WorldLocationsResolution {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isWorldLocations(parsed)) {
      return {
        world: emptyWorldLocations(),
        path: filePath,
        warning: `World-location dataset at '${filePath}' is malformed; using an empty dataset.`,
      };
    }
    // Tolerate datasets predating lootPickups: default the array so callers needn't guard.
    const world: WorldLocations = { ...parsed, lootPickups: parsed.lootPickups ?? [] };
    return { world, path: filePath };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      world: emptyWorldLocations(),
      path: filePath,
      warning: `Failed to read world-location dataset at '${filePath}': ${detail}. Using an empty dataset.`,
    };
  }
}

/** Structural guard — confirms the two location arrays are present. */
function isWorldLocations(value: unknown): value is WorldLocations {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate['collectibles']) && Array.isArray(candidate['resourceNodes']);
}
