import type { RawObject, RawSave } from '../parser/types.js';
import { extractPlayer } from './player.js';
import { extractRecipes } from './recipes.js';
import { extractProgression } from './schematics.js';
import { extractStorage } from './storage.js';
import type { Inventory, SaveState } from './types.js';
import { Warnings } from './util.js';
import { computeCollectibleProgress, extractRemainingCollectibles } from './worldLocations.js';

export { emptySaveState } from './types.js';
export type { SaveState } from './types.js';

/**
 * Converts a parsed save into the clean `SaveState` model. Walks every
 * World-Partition sublevel once — indexing objects by instance name — then
 * delegates to the per-domain normalisers. Never throws: bad entries are skipped
 * and recorded in `warnings`, so a partial parse still yields a usable state.
 *
 * `itemNames` (className → display name, from the parsed game data) upgrades
 * inventory/storage/depot display names from the humanised fallback to the real
 * in-game names. Optional: an empty map keeps the humanised fallback.
 */
export function normaliseSave(
  raw: RawSave,
  parsedAt: string,
  itemNames: Map<string, string> = new Map(),
): { state: SaveState; warnings: string[] } {
  const warnings = new Warnings();

  const objects: RawObject[] = [];
  const byInstance = new Map<string, RawObject>();

  for (const level of Object.values(raw.levels ?? {})) {
    for (const obj of level?.objects ?? []) {
      objects.push(obj);
      if (obj.instanceName !== undefined) {
        byInstance.set(obj.instanceName, obj);
      }
    }
  }

  const progression = extractProgression(objects, warnings);
  const remainingCollectibles = extractRemainingCollectibles(objects);
  const state: SaveState = {
    version: detectVersion(raw),
    saveName: detectSaveName(raw),
    parsedAt,
    player: extractPlayer(objects, byInstance, warnings),
    storage: extractStorage(objects, byInstance, warnings),
    recipes: extractRecipes(objects, warnings),
    milestones: progression.milestones,
    mamResearch: progression.mamResearch,
    assemblyPhase: progression.assemblyPhase,
    collectibleProgress: computeCollectibleProgress(remainingCollectibles),
    remainingCollectibles,
    warnings: warnings.all(),
  };

  applyItemNames(state, itemNames);
  return { state, warnings: warnings.all() };
}

/** Rewrites item display names from the real game data where available. */
function applyItemNames(state: SaveState, itemNames: Map<string, string>): void {
  if (itemNames.size === 0) {
    return;
  }
  const rename = (inventory: Inventory): void => {
    for (const stack of inventory) {
      stack.displayName = itemNames.get(stack.itemClass) ?? stack.displayName;
    }
  };
  rename(state.player.inventory);
  rename(state.storage.dimensionalDepot);
  for (const container of state.storage.containers) {
    rename(container.inventory);
  }
}

function detectVersion(raw: RawSave): string {
  const build = raw.header?.buildVersion;
  const save = raw.header?.saveVersion;
  if (build === undefined && save === undefined) {
    return 'unknown';
  }
  return `build ${build ?? '?'} (save ${save ?? '?'})`;
}

function detectSaveName(raw: RawSave): string {
  return raw.header?.sessionName ?? raw.header?.saveName ?? 'unknown';
}
