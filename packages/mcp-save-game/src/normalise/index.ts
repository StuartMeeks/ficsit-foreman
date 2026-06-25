import { LOOSE_CELL_DIAGONAL } from '../constants.js';
import type { RawObject, RawSave } from '../parser/types.js';
import { extractPlayer } from './player.js';
import { extractRecipes } from './recipes.js';
import { extractProgression } from './schematics.js';
import { extractStorage } from './storage.js';
import type { BoundingBox, Inventory, SaveState } from './types.js';
import { Warnings, translation } from './util.js';
import { computeCollectibleProgress, extractRemainingCollectibles } from './worldLocations.js';

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
  // Each save sublevel is a World-Partition cell; its objects cluster tightly.
  // Capture each cell's bounding box (the streamed/explored region) so a real
  // "collected" count can be scoped to where present/absent is meaningful.
  const streamedCellBoxes: BoundingBox[] = [];

  for (const level of Object.values(raw.levels ?? {})) {
    const levelObjects = level?.objects ?? [];
    for (const obj of levelObjects) {
      objects.push(obj);
      if (obj.instanceName !== undefined) {
        byInstance.set(obj.instanceName, obj);
      }
    }
    const box = cellBox(levelObjects);
    if (box !== undefined) {
      streamedCellBoxes.push(box);
    }
  }

  const progression = extractProgression(objects, warnings);
  const remainingCollectibles = extractRemainingCollectibles(objects);
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
    collectibleProgress: computeCollectibleProgress(remainingCollectibles),
    remainingCollectibles,
    streamedCellBoxes,
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

/**
 * The XY bounding box of a sublevel's positioned objects, treated as one
 * streamed World-Partition cell. Returns undefined for cells with too few
 * positioned objects to be meaningful, or for an outsized box (the persistent
 * level of globally-scattered actors, which would otherwise span the whole map).
 */
function cellBox(levelObjects: RawObject[]): BoundingBox | undefined {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let count = 0;
  for (const obj of levelObjects) {
    const t = translation(obj);
    if (t === undefined) {
      continue;
    }
    count += 1;
    x0 = Math.min(x0, t.x);
    x1 = Math.max(x1, t.x);
    y0 = Math.min(y0, t.y);
    y1 = Math.max(y1, t.y);
  }
  if (count < 3) {
    return undefined;
  }
  if (Math.hypot(x1 - x0, y1 - y0) > LOOSE_CELL_DIAGONAL) {
    return undefined;
  }
  return { x0, x1, y0, y1 };
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
