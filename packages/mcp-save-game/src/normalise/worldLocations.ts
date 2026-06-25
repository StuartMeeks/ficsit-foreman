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
 * Per-type collectible visibility: how many un-collected collectibles of each
 * kind are actually present in the save (i.e. in streamed-in World-Partition
 * cells), alongside the fixed world total. One row per kind, in
 * `COLLECTIBLE_ACTORS` order, even when none are present.
 *
 * Deliberately does NOT derive a "collected" count: absence means *either*
 * collected *or* in a cell not yet streamed, and the two cannot be told apart
 * from the save (see the tool's coverage note).
 */
export function computeCollectibleProgress(present: RemainingCollectible[]): CollectibleCount[] {
  const presentByKind = new Map<CollectibleKind, number>();
  for (const item of present) {
    presentByKind.set(item.kind, (presentByKind.get(item.kind) ?? 0) + 1);
  }
  return COLLECTIBLE_ACTORS.map((matcher) => ({
    kind: matcher.kind,
    label: matcher.label,
    worldTotal: WORLD_TOTALS[matcher.kind],
    presentInSave: presentByKind.get(matcher.kind) ?? 0,
  }));
}
