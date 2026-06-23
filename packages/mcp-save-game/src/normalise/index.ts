import type { RawObject, RawSave } from '../parser/types.js';
import { extractCollectibles } from './collectibles.js';
import { extractPlayer } from './player.js';
import { extractRecipes } from './recipes.js';
import { extractProgression } from './schematics.js';
import { extractStorage } from './storage.js';
import type { SaveState } from './types.js';
import { Warnings } from './util.js';

export { emptySaveState } from './types.js';
export type { SaveState } from './types.js';

/**
 * Converts a parsed save into the clean `SaveState` model. Walks every
 * World-Partition sublevel once — indexing objects by instance name and
 * collecting the per-level collected-actor references — then delegates to the
 * per-domain normalisers. Never throws: bad entries are skipped and recorded in
 * `warnings`, so a partial parse still yields a usable state.
 */
export function normaliseSave(
  raw: RawSave,
  parsedAt: string,
): { state: SaveState; warnings: string[] } {
  const warnings = new Warnings();

  const objects: RawObject[] = [];
  const byInstance = new Map<string, RawObject>();
  const collectablePaths: string[] = [];

  for (const level of Object.values(raw.levels ?? {})) {
    for (const obj of level?.objects ?? []) {
      objects.push(obj);
      if (obj.instanceName !== undefined) {
        byInstance.set(obj.instanceName, obj);
      }
    }
    for (const ref of level?.collectables ?? []) {
      if (typeof ref?.pathName === 'string' && ref.pathName.length > 0) {
        collectablePaths.push(ref.pathName);
      }
    }
  }

  const progression = extractProgression(objects, warnings);
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
    collectibles: extractCollectibles(collectablePaths),
    warnings: warnings.all(),
  };

  return { state, warnings: warnings.all() };
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
