import {
  parseDocsFile,
  resolveDocsPath,
  type Building,
  type Recipe,
} from '@foreman/game-data-core';

import { logger } from './logger.js';

/**
 * The slice of parsed game data the save MCP joins against: a `className →
 * displayName` map (for upgrading inventory/recipe/building names from the
 * humanised fallback), plus recipes and buildings keyed by class (for theoretical
 * production rates, build power and extraction rates). Empty when no game data is
 * available.
 */
export interface GameDataIndex {
  displayNames: Map<string, string>;
  recipes: Record<string, Recipe>;
  buildings: Record<string, Building>;
}

function emptyIndex(): GameDataIndex {
  return { displayNames: new Map(), recipes: {}, buildings: {} };
}

/**
 * Loads the game-data index from `@foreman/game-data-core`'s parser + bundled
 * `en-US.json` (or a player-supplied install via SATISFACTORY_DOCS_PATH / GAME_DIR).
 * Best-effort: returns an empty index (humanised fallback, no rates) if no game
 * data is available, and never throws.
 *
 * Note: MAM/milestone *schematics* are not in the parsed game data, so those keep
 * the humanised fallback.
 */
export function loadGameDataIndex(): GameDataIndex {
  const { path: docsPath, warning } = resolveDocsPath();
  if (warning !== undefined) {
    logger.warn(warning);
  }
  if (docsPath === undefined) {
    logger.warn('No game data found — display names will fall back to humanised class names.');
    return emptyIndex();
  }
  try {
    const { gameData } = parseDocsFile(docsPath);
    const displayNames = new Map<string, string>();
    for (const entry of [
      ...Object.values(gameData.items),
      ...Object.values(gameData.resources),
      ...Object.values(gameData.recipes),
      ...Object.values(gameData.buildings),
    ]) {
      displayNames.set(entry.className, entry.displayName);
    }
    logger.info(`Loaded ${displayNames.size} display names from game data (${gameData.version}).`);
    return { displayNames, recipes: gameData.recipes, buildings: gameData.buildings };
  } catch (error) {
    logger.error('Failed to load game data; using humanised fallback:', error);
    return emptyIndex();
  }
}

/**
 * A `className → displayName` map (covers items, resources, recipes and buildings).
 * Thin wrapper over {@link loadGameDataIndex} for callers that only need names.
 */
export function loadDisplayNames(): Map<string, string> {
  return loadGameDataIndex().displayNames;
}
