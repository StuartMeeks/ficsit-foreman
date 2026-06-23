import { parseDocsFile, resolveDocsPath } from '@foreman/game-data-core';

import { logger } from './logger.js';

/**
 * Loads a `className → displayName` map for items and raw resources from the
 * game data (`@foreman/game-data-core`'s parser + bundled `en-US.json`, or a
 * player-supplied install via SATISFACTORY_DOCS_PATH / GAME_DIR). Used to upgrade
 * save inventory/storage display names from the humanised fallback to real
 * in-game names. Best-effort: returns an empty map (humanised fallback) if no
 * game data is available, and never throws.
 */
export function loadItemNames(): Map<string, string> {
  const names = new Map<string, string>();
  const { path: docsPath, warning } = resolveDocsPath();
  if (warning !== undefined) {
    logger.warn(warning);
  }
  if (docsPath === undefined) {
    logger.warn('No game data found — item display names will fall back to humanised class names.');
    return names;
  }
  try {
    const { gameData } = parseDocsFile(docsPath);
    for (const item of [...Object.values(gameData.items), ...Object.values(gameData.resources)]) {
      names.set(item.className, item.displayName);
    }
    logger.info(`Loaded ${names.size} item display names from game data (${gameData.version}).`);
  } catch (error) {
    logger.error('Failed to load game-data item names; using humanised fallback:', error);
  }
  return names;
}
