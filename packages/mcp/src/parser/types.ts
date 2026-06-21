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
  /** True for raw resources (iron ore, water, …) that no recipe produces. */
  isResource: boolean;
}

export interface Ingredient {
  itemClassName: string;
  /** Resolved at parse time; falls back to a humanised class name if unknown. */
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

export interface Building {
  className: string;
  displayName: string;
  description: string;
  category: string;
  /** MW baseline. 0 when the building consumes no power. */
  powerConsumption: number;
  buildCost: BuildCostLine[];
}

export type SchematicType =
  | 'milestone'
  | 'mam'
  | 'awesome_shop'
  | 'hard_drive'
  | 'tutorial'
  | 'other';

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
