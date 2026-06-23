import { COLLECTIBLE_KIND, WORLD_COLLECTIBLE_TOTALS } from '../constants.js';
import { classNameFromPath } from './classRef.js';
import type { Collectibles } from './types.js';

const NOTE =
  'Collected counts come from the save’s per-level collected-actor registry. ' +
  'Alien-artifact and power-slug TOTALS are reliable; the Mercer/Somersloop split, ' +
  'and drop-pod/hard-drive counts, are approximate (the registry does not record ' +
  'collectible type or location). Exact per-type counts and locations require the ' +
  'world-location dataset (game-data v3). Figures reflect what this save records.';

/**
 * Summarises collected collectibles from the flattened per-level `collectables`
 * (destroyed-actor) references. Classifies by instance-name heuristic; see the
 * note for the reliability caveats established by calibration against real saves.
 */
export function extractCollectibles(collectablePaths: string[]): Collectibles {
  let alienArtifacts = 0;
  let somersloops = 0;
  let powerSlugs = 0;
  let dropPods = 0;

  for (const path of collectablePaths) {
    const name = classNameFromPath(path);
    if (COLLECTIBLE_KIND.alienArtifact.test(name)) {
      alienArtifacts += 1;
      if (COLLECTIBLE_KIND.somersloop.test(name)) {
        somersloops += 1;
      }
    }
    if (COLLECTIBLE_KIND.powerSlug.test(name)) {
      powerSlugs += 1;
    }
    if (COLLECTIBLE_KIND.dropPod.test(name)) {
      dropPods += 1;
    }
  }

  return {
    totalCollected: collectablePaths.length,
    reliable: { alienArtifacts, powerSlugs },
    approximate: {
      mercerSpheres: Math.max(0, alienArtifacts - somersloops),
      somersloops,
      dropPodsOrHardDrives: dropPods,
    },
    worldTotals: { ...WORLD_COLLECTIBLE_TOTALS },
    precise: false,
    note: NOTE,
  };
}
