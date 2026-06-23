import type { IngredientUnit } from '@foreman/game-data-core';

/** A single ingredient/product line as returned by recipe queries. */
export interface IngredientView {
  item: string;
  itemClassName: string;
  amount: number;
  perMinute: number;
  unit: IngredientUnit;
}

export interface RecipeView {
  className: string;
  displayName: string;
  isAlternate: boolean;
  craftTime: number;
  producedIn: string[];
  ingredients: IngredientView[];
  products: IngredientView[];
  variablePower?: { min: number; max: number };
}

/** One item in a flattened production breakdown (every tier). */
export interface ProductionComponent {
  item: string;
  itemClassName: string;
  perMinute: number;
  unit: IngredientUnit;
  isRaw: boolean;
  /** Recipe used to produce this item; absent for raw resources. */
  recipe?: string;
  machine?: string;
  machineCount?: number;
}

export interface IngredientTreeResult {
  item: string;
  itemClassName: string;
  targetPerMinute: number;
  unit: IngredientUnit;
  recipe: string;
  machine?: string;
  machineCount?: number;
  /** Flat list of every input across all tiers, aggregated by item. */
  components: ProductionComponent[];
  warnings: string[];
}

export interface RawInput {
  item: string;
  itemClassName: string;
  perMinute: number;
  unit: IngredientUnit;
}

export interface AlternateComparisonRow {
  recipe: string;
  className: string;
  isAlternate: boolean;
  machine: string | null;
  craftTime: number;
  outputPerMinute: number;
  ingredients: IngredientView[];
}

export interface AlternateComparison {
  item: string;
  itemClassName: string;
  recipes: AlternateComparisonRow[];
}
