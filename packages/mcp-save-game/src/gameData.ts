import { parseDocsFile, resolveDocsPath } from '@foreman/game-data-core';

import { logger } from './logger.js';

/**
 * Loads a `className → displayName` map from the game data
 * (`@foreman/game-data-core`'s parser + bundled `en-US.json`, or a player-supplied
 * install via SATISFACTORY_DOCS_PATH / GAME_DIR). Covers items, raw resources,
 * recipes and buildings, so save inventory/storage *and* unlocked recipes /
 * storage-container names can be upgraded from the humanised fallback to real
 * in-game names (e.g. `Recipe_Alternate_Screw_C` → "Cast Screw"). Best-effort:
 * returns an empty map (humanised fallback) if no game data is available, and
 * never throws.
 *
 * Note: MAM/milestone *schematics* are not in the parsed game data, so those keep
 * the humanised fallback.
 */
export function loadDisplayNames(): Map<string, string> {
  const names = new Map<string, string>();
  const { path: docsPath, warning } = resolveDocsPath();
  if (warning !== undefined) {
    logger.warn(warning);
  }
  if (docsPath === undefined) {
    logger.warn('No game data found — display names will fall back to humanised class names.');
    return names;
  }
  try {
    const { gameData } = parseDocsFile(docsPath);
    for (const entry of [
      ...Object.values(gameData.items),
      ...Object.values(gameData.resources),
      ...Object.values(gameData.recipes),
      ...Object.values(gameData.buildings),
    ]) {
      names.set(entry.className, entry.displayName);
    }
    logger.info(`Loaded ${names.size} display names from game data (${gameData.version}).`);
  } catch (error) {
    logger.error('Failed to load game-data display names; using humanised fallback:', error);
  }
  return names;
}
