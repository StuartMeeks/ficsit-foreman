/**
 * Parser output types. These describe clean `GameData` with all Unreal Engine
 * string noise already resolved — nothing downstream should ever see a raw
 * `((ItemClass=...))` string or an `RF_SOLID` enum.
 *
 * British English is used throughout comments and documentation.
 */

export type ItemForm = 'solid' | 'liquid' | 'gas' | 'invalid';

/** Display unit for an ingredient/product amount. Fluids are reported in m³. */
export type IngredientUnit = 'items' | 'm³';

export interface Item {
  className: string;
  displayName: string;
  description: string;
  stackSize: number;
  form: ItemForm;
  sinkPoints: number;
  /**
   * Energy content in MJ. For solids this is MJ per item; for fluids it is MJ
   * per unit (1000 units = 1 m³). 0 for non-fuel items. Used to derive generator
   * fuel-burn rates.
   */
  energyValue: number;
  /** True for raw resources (iron ore, water, …) that no recipe produces. */
  isResource: boolean;
}

export interface Ingredient {
  itemClassName: string;
  /** The item's authored display name; empty when the source has none — the edge humanises. */
  displayName: string;
  /** Per craft. Fluid amounts are already converted to m³ (raw units ÷ 1000). */
  amount: number;
  /** Computed at parse time: amount * 60 / craftTime. */
  perMinute: number;
  unit: IngredientUnit;
}

/** MW range for buildings whose power draw varies by recipe. */
export interface VariablePower {
  min: number;
  max: number;
}

export interface Recipe {
  className: string;
  displayName: string;
  isAlternate: boolean;
  /** Seconds, parsed from `mManufactoringDuration` (deliberate source typo). */
  craftTime: number;
  ingredients: Ingredient[];
  products: Ingredient[];
  /** Display names of the production machines this recipe runs in. */
  producedIn: string[];
  /** Class names of the production machines (resolves to Building nodes). */
  producedInClasses: string[];
  inBuildGun: boolean;
  inWorkshop: boolean;
  /** Present only for variable-power recipes (Particle Accelerator, etc.). */
  variablePower?: VariablePower;
}

export interface BuildCostLine {
  itemClassName: string;
  amount: number;
}

/** A per-minute flow of an item into or out of a generator. */
export interface FuelFlow {
  itemClassName: string;
  displayName: string;
  perMinute: number;
  unit: IngredientUnit;
}

/**
 * One fuel option for a power generator, with all derived per-minute rates: the
 * fuel burned, any supplemental resource (e.g. water), and any byproduct (e.g.
 * nuclear waste).
 */
export interface GeneratorFuel {
  fuel: FuelFlow;
  supplemental?: FuelFlow;
  byproduct?: FuelFlow;
}

export interface Building {
  className: string;
  displayName: string;
  description: string;
  category: string;
  /** Constant MW draw. 0 for generators and variable-power machines. */
  powerConsumption: number;
  /**
   * Estimated maximum MW draw for variable-power machines (Particle Accelerator,
   * Quantum Encoder, Converter). Present only when the machine's draw varies.
   */
  maxPowerConsumption?: number;
  /** MW generated. Present only for power generators. */
  powerProduction?: number;
  /** True when output is variable/geyser-dependent (Geothermal Generator). */
  variablePowerProduction?: boolean;
  /** Fuel options and their derived rates. Present only for fuel generators. */
  fuels?: GeneratorFuel[];
  /** Conveyor throughput in items/min (`mSpeed / 2`). Present only for belts. */
  conveyorSpeedPerMin?: number;
  /** Pipe throughput in m³/min (`mFlowLimit * 60`). Present only for pipelines. */
  pipeFlowPerMin?: number;
  /** Pump design head lift in metres (`mDesignPressure`). Present only for pipeline pumps. */
  headLiftMetres?: number;
  /**
   * Base extraction rate at a normal-purity node, in the resource's native unit
   * (items/min for solids, m³/min for fluids). Present only for miners /
   * water + oil extractors. Scale by node purity (impure 0.5 / normal 1 / pure 2).
   */
  extractionRatePerMin?: number;
  buildCost: BuildCostLine[];
}

export type SchematicType =
  'milestone' | 'mam' | 'awesome_shop' | 'hard_drive' | 'tutorial' | 'other';

export interface Schematic {
  className: string;
  displayName: string;
  type: SchematicType;
  tier: number;
  cost: Ingredient[];
  unlocksRecipes: string[];
  unlocksBuildings: string[];
  unlocksItems: string[];
}

export interface GameData {
  /** Detected from the install context, or 'unknown'. */
  version: string;
  /**
   * Satisfactory changelist/build number this data was extracted from (stamped
   * into the dataset by the extractor), or undefined when unknown. A save file's
   * `buildVersion` is this same integer, so the two can be compared.
   */
  build?: number;
  /** ISO timestamp of when the parse ran. */
  parsedAt: string;
  /** Manufactured/inventory items, keyed by class name. Excludes raw resources. */
  items: Record<string, Item>;
  /** Raw resources, keyed by class name. Leaf nodes in the production graph. */
  resources: Record<string, Item>;
  recipes: Record<string, Recipe>;
  buildings: Record<string, Building>;
  schematics: Record<string, Schematic>;
}

export interface ParseResult {
  gameData: GameData;
  /** Non-fatal issues logged during the parse. Never thrown. */
  parseWarnings: string[];
}

/** A single raw class entry from the docs file, before any normalisation. */
export type RawClass = Record<string, unknown>;
