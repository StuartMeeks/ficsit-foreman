import type {
  Building,
  FuelFlow,
  GeneratorFuel,
  IngredientUnit,
  Item,
  RawClass,
} from '../types.js';
import { getNumber, getString, isRecord } from '../util.js';
import { humaniseClassName } from '@foreman/sf-core';

/** Lookup of every item/resource by class name, for fuel-rate derivation. */
export type ItemLookup = Map<string, Item>;

/** Rounds a per-minute rate to 4dp to keep float noise out of tool output. */
function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

function unitFor(item: Item | undefined): IngredientUnit {
  return item !== undefined && (item.form === 'liquid' || item.form === 'gas') ? 'm³' : 'items';
}

function displayFor(className: string, item: Item | undefined): string {
  return item?.displayName !== undefined && item.displayName !== ''
    ? item.displayName
    : humaniseClassName(className);
}

/**
 * Fuel consumed per minute. Power (MW) is MJ/s, so items/min = power·60 ÷ energy.
 * Fluid energy is stored per unit (1000 units = 1 m³), so dividing by an extra
 * 1000 yields m³/min. Returns 0 when the fuel item or its energy is unknown.
 */
function fuelRatePerMinute(powerProduction: number, item: Item | undefined): number {
  if (item === undefined || item.energyValue <= 0) {
    return 0;
  }
  const perUnit = (powerProduction * 60) / item.energyValue;
  return unitFor(item) === 'm³' ? perUnit / 1000 : perUnit;
}

function flow(className: string, item: Item | undefined, perMinute: number): FuelFlow {
  return {
    itemClassName: className,
    displayName: displayFor(className, item),
    perMinute: round4(perMinute),
    unit: unitFor(item),
  };
}

/**
 * Derives every fuel option (and its supplemental + byproduct flows) for a power
 * generator from its raw `mFuel` array. Returns undefined for non-generators.
 *
 * - Fuel rate:        power·60 ÷ energy (÷1000 again for fluids).
 * - Supplemental:     power · supplementalRatio · 60 ÷ 1000  (m³/min, e.g. water).
 * - Byproduct:        fuelRate · byproductAmount (per fuel item).
 */
function computeFuels(
  rawFuel: unknown,
  powerProduction: number,
  supplementalRatio: number,
  items: ItemLookup,
): GeneratorFuel[] | undefined {
  if (!Array.isArray(rawFuel)) {
    return undefined;
  }
  const fuels: GeneratorFuel[] = [];
  for (const entry of rawFuel) {
    if (!isRecord(entry)) {
      continue;
    }
    const fuelClass = getString(entry, 'mFuelClass');
    if (fuelClass === '') {
      continue;
    }
    const fuelItem = items.get(fuelClass);
    const fuelRate = fuelRatePerMinute(powerProduction, fuelItem);
    const result: GeneratorFuel = { fuel: flow(fuelClass, fuelItem, fuelRate) };

    const supplementalClass = getString(entry, 'mSupplementalResourceClass');
    if (supplementalClass !== '' && supplementalRatio > 0 && powerProduction > 0) {
      const supplementalItem = items.get(supplementalClass);
      const ratePerMinute = (powerProduction * supplementalRatio * 60) / 1000;
      result.supplemental = flow(supplementalClass, supplementalItem, ratePerMinute);
    }

    const byproductClass = getString(entry, 'mByproduct');
    const byproductAmount = getNumber(entry, 'mByproductAmount', 0);
    if (byproductClass !== '' && byproductAmount > 0) {
      const byproductItem = items.get(byproductClass);
      result.byproduct = flow(byproductClass, byproductItem, fuelRate * byproductAmount);
    }

    fuels.push(result);
  }
  return fuels.length > 0 ? fuels : undefined;
}

/**
 * Builds a `Building` from a raw `FGBuildable*` class. Build costs are attached
 * separately by the recipes extractor (they come from build-gun recipes, which
 * the docs file keeps distinct from production recipes).
 *
 * `shortName` is the originating `NativeClass` short name, used to derive a
 * coarse category (e.g. `FGBuildableManufacturer` → `Manufacturer`). For power
 * generators (`FGBuildableGenerator*`) the power output and fuel rates are
 * derived from `items` (which carry the fuel energy values).
 */
export function buildingFromRaw(raw: RawClass, shortName: string, items: ItemLookup): Building {
  const className = getString(raw, 'ClassName');
  const displayName = getString(raw, 'mDisplayName') || humaniseClassName(className);
  const building: Building = {
    className,
    displayName,
    description: getString(raw, 'mDescription'),
    category: shortName.replace(/^FGBuildable/, '').replace(/^FGBuilding/, '') || 'Building',
    powerConsumption: getNumber(raw, 'mPowerConsumption', 0),
    buildCost: [],
  };

  // Variable-power machines (Particle Accelerator, Quantum Encoder, Converter)
  // report 0 baseline draw and an estimated maximum instead.
  const maxPower = getNumber(raw, 'mEstimatedMaximumPowerConsumption', 0);
  if (maxPower > 0) {
    building.maxPowerConsumption = maxPower;
  }

  // Logistics throughput, surfaced for production-line costing (#66). Present
  // only on the relevant classes; absent fields stay undefined.
  const conveyorSpeed = getNumber(raw, 'mSpeed', 0); // belts: units are 2× items/min
  if (conveyorSpeed > 0) {
    building.conveyorSpeedPerMin = round4(conveyorSpeed / 2);
  }
  const flowLimit = getNumber(raw, 'mFlowLimit', 0); // pipes: m³/s
  if (flowLimit > 0) {
    building.pipeFlowPerMin = round4(flowLimit * 60);
  }
  const itemsPerCycle = getNumber(raw, 'mItemsPerCycle', 0); // miners / extractors
  const cycleTime = getNumber(raw, 'mExtractCycleTime', 0);
  if (itemsPerCycle > 0 && cycleTime > 0) {
    const perMin = (itemsPerCycle * 60) / cycleTime;
    // Fluid extractors store items in 1000-per-m³ units (water extractor 2000 → 120 m³/min).
    const isLiquid = getString(raw, 'mAllowedResourceForms').includes('RF_LIQUID');
    building.extractionRatePerMin = round4(isLiquid ? perMin / 1000 : perMin);
  }

  if (shortName.includes('Generator')) {
    const powerProduction = getNumber(raw, 'mPowerProduction', 0);
    const variableFactor = getNumber(raw, 'mVariablePowerProductionFactor', 0);
    if (powerProduction > 0) {
      building.powerProduction = powerProduction;
    } else if (variableFactor > 0) {
      // Geothermal: output varies with geyser purity, no fixed figure.
      building.variablePowerProduction = true;
    }
    const supplementalRatio = getNumber(raw, 'mSupplementalToPowerRatio', 0);
    const fuels = computeFuels(raw['mFuel'], powerProduction, supplementalRatio, items);
    if (fuels !== undefined) {
      building.fuels = fuels;
    }
  }

  return building;
}
