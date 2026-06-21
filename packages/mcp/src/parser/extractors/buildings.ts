import type { Building, RawClass } from '../types.js';
import { getNumber, getString } from '../util.js';
import { humaniseClassName } from '../normalise/classRef.js';

/**
 * Builds a `Building` from a raw `FGBuildable*` class. Build costs are attached
 * separately by the recipes extractor (they come from build-gun recipes, which
 * the docs file keeps distinct from production recipes).
 *
 * `shortName` is the originating `NativeClass` short name, used to derive a
 * coarse category (e.g. `FGBuildableManufacturer` → `Manufacturer`).
 */
export function buildingFromRaw(raw: RawClass, shortName: string): Building {
  const className = getString(raw, 'ClassName');
  const displayName = getString(raw, 'mDisplayName') || humaniseClassName(className);
  return {
    className,
    displayName,
    description: getString(raw, 'mDescription'),
    category: shortName.replace(/^FGBuildable/, '').replace(/^FGBuilding/, '') || 'Building',
    powerConsumption: getNumber(raw, 'mPowerConsumption', 0),
    buildCost: [],
  };
}
