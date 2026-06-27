import {
  CLOCK_SPEED_PROP,
  CURRENT_RECIPE_PROP,
  EXTRACTOR_BUILDING,
  MANUFACTURER_BUILDING,
  PRODUCTION_BOOST_PROP,
} from '../constants.js';
import type { RawObject } from '../parser/types.js';
import { classNameFromPath } from './classRef.js';
import type { ExtractorLine, ProducerLine, ProductionState } from './types.js';
import { numberField, propMap, refField, translation, type Warnings } from './util.js';

/**
 * Extracts the factory floor: recipe-running machines (Constructor → Manufacturer,
 * Refinery, Blender, …) and resource extractors (miners / pumps / fracking). Each
 * record captures the machine's *configuration* — building class, recipe class,
 * clock speed and somersloop boost — with no game-data join. Theoretical rates and
 * estimated power are derived later in the query layer (which has the recipe +
 * building game data). Never throws; an unconfigured machine (no `mCurrentRecipe`)
 * is still reported, with a warning.
 *
 * Clock speed and the sloop boost are saved only when not at their default, so an
 * absent property means 100% / no boost (→ default to 1). Whether a machine is
 * actually fed or powered is out of scope (see the actual-production graph issue).
 */
export function extractProduction(objects: RawObject[], warnings: Warnings): ProductionState {
  const producers: ProducerLine[] = [];
  const extractors: ExtractorLine[] = [];

  for (const obj of objects) {
    const typePath = obj.typePath ?? '';
    const props = propMap(obj);
    const buildingClass = classNameFromPath(typePath || (obj.instanceName ?? ''));

    if (MANUFACTURER_BUILDING.test(typePath)) {
      const recipeRef = refField(props, CURRENT_RECIPE_PROP);
      const recipeClass = recipeRef === undefined ? undefined : classNameFromPath(recipeRef);
      if (recipeClass === undefined) {
        warnings.add(`Manufacturer ${buildingClass} has no configured recipe; reporting as idle.`);
      }
      producers.push({
        buildingClass,
        recipeClass,
        clockSpeed: numberField(props, CLOCK_SPEED_PROP) ?? 1,
        productionBoost: numberField(props, PRODUCTION_BOOST_PROP) ?? 1,
        location: translation(obj),
      });
    } else if (EXTRACTOR_BUILDING.test(typePath)) {
      extractors.push({
        buildingClass,
        clockSpeed: numberField(props, CLOCK_SPEED_PROP) ?? 1,
        productionBoost: numberField(props, PRODUCTION_BOOST_PROP) ?? 1,
        location: translation(obj),
      });
    }
  }

  return { producers, extractors };
}
