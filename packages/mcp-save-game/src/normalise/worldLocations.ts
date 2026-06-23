import { COLLECTIBLE_ACTORS, WORLD_TOTALS, type CollectibleKind } from '../constants.js';
import type { RawObject } from '../parser/types.js';
import type { CollectibleCount, RemainingCollectible } from './types.js';
import { translation } from './util.js';

/**
 * Finds every un-collected collectible still present in the save and classifies
 * it by its actor `typePath` (Mercer Sphere, Somersloop, blue/yellow/purple
 * power slug, hard-drive crash site). Collected ones are destroyed and absent,
 * so this is the set still out there to grab. Each carries its world location.
 */
export function extractRemainingCollectibles(objects: RawObject[]): RemainingCollectible[] {
  const out: RemainingCollectible[] = [];
  for (const obj of objects) {
    const typePath = obj.typePath ?? '';
    for (const matcher of COLLECTIBLE_ACTORS) {
      if (matcher.typePath.test(typePath)) {
        out.push({ kind: matcher.kind, label: matcher.label, location: translation(obj) });
        break;
      }
    }
  }
  return out;
}

/**
 * Per-type collection progress: `collected = max(0, worldTotal − remaining)`.
 * One row per collectible kind, in `COLLECTIBLE_ACTORS` order, even when none
 * remain (so the full picture is always reported).
 */
export function computeCollectibleProgress(remaining: RemainingCollectible[]): CollectibleCount[] {
  const remainingByKind = new Map<CollectibleKind, number>();
  for (const item of remaining) {
    remainingByKind.set(item.kind, (remainingByKind.get(item.kind) ?? 0) + 1);
  }
  return COLLECTIBLE_ACTORS.map((matcher) => {
    const worldTotal = WORLD_TOTALS[matcher.kind];
    const remainingCount = remainingByKind.get(matcher.kind) ?? 0;
    return {
      kind: matcher.kind,
      label: matcher.label,
      worldTotal,
      remaining: remainingCount,
      collected: Math.max(0, worldTotal - remainingCount),
    };
  });
}
