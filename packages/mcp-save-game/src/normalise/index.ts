import type { RawObject, RawSave } from '../parser/types.js';
import { extractPlayer } from './player.js';
import { extractRecipes } from './recipes.js';
import { extractScannable } from './scannable.js';
import { extractProgression } from './schematics.js';
import { extractStorage } from './storage.js';
import type { Inventory, SaveState } from './types.js';
import { Warnings } from './util.js';

export { emptySaveState } from './types.js';
export type { SaveState } from './types.js';

/**
 * Converts a parsed save into the clean `SaveState` model. Walks every
 * World-Partition sublevel once — indexing objects by instance name — then
 * delegates to the per-domain normalisers. Never throws: bad entries are skipped
 * and recorded in `warnings`, so a partial parse still yields a usable state.
 *
 * `displayNames` (className → display name, from the parsed game data) upgrades
 * inventory/storage/depot, unlocked-recipe and storage-container display names
 * from the humanised fallback to the real in-game names. Optional: an empty map
 * keeps the humanised fallback.
 */
export function normaliseSave(
  raw: RawSave,
  parsedAt: string,
  displayNames: Map<string, string> = new Map(),
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
  const scannable = extractScannable(objects);
  const state: SaveState = {
    version: detectVersion(raw),
    saveName: detectSaveName(raw),
    playDurationSeconds: raw.header?.playDurationSeconds,
    parsedAt,
    player: extractPlayer(objects, byInstance, warnings),
    storage: extractStorage(objects, byInstance, warnings),
    recipes: extractRecipes(objects, warnings),
    milestones: progression.milestones,
    mamResearch: progression.mamResearch,
    assemblyPhase: progression.assemblyPhase,
    collectedPickupGuids: scannable.collectedPickupGuids,
    lootedDropPodGuids: scannable.lootedDropPodGuids,
    warnings: warnings.all(),
  };

  applyDisplayNames(state, displayNames);
  return { state, warnings: warnings.all() };
}

/**
 * Rewrites display names from the real game data where available: inventory and
 * storage item stacks, unlocked recipes, and storage-container building names.
 * (MAM/milestone schematics are not in the game data, so they keep the humanised
 * fallback.)
 */
function applyDisplayNames(state: SaveState, names: Map<string, string>): void {
  if (names.size === 0) {
    return;
  }
  const renameStacks = (inventory: Inventory): void => {
    for (const stack of inventory) {
      stack.displayName = names.get(stack.itemClass) ?? stack.displayName;
    }
  };
  renameStacks(state.player.inventory);
  renameStacks(state.storage.dimensionalDepot);
  for (const container of state.storage.containers) {
    renameStacks(container.inventory);
    container.displayName = names.get(container.buildingClass) ?? container.displayName;
  }
  for (const recipe of state.recipes) {
    recipe.displayName = names.get(recipe.recipeClass) ?? recipe.displayName;
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
