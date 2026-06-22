import type { IngredientUnit, ItemForm } from '../types.js';

/** Fluid amounts in the docs file are in units where 1000 = 1 m³. */
const FLUID_UNITS_PER_CUBIC_METRE = 1000;

export function isFluid(form: ItemForm): boolean {
  return form === 'liquid' || form === 'gas';
}

/**
 * Converts a raw per-craft amount into its display amount and unit. Fluids and
 * gases are reported in m³ (raw ÷ 1000); solids are reported as item counts.
 */
export function toDisplayAmount(
  rawAmount: number,
  form: ItemForm,
): { amount: number; unit: IngredientUnit } {
  if (isFluid(form)) {
    return { amount: rawAmount / FLUID_UNITS_PER_CUBIC_METRE, unit: 'm³' };
  }
  return { amount: rawAmount, unit: 'items' };
}

/** Per-minute rate: `amount * 60 / craftTime`. Guards against zero duration. */
export function perMinute(displayAmount: number, craftTimeSeconds: number): number {
  if (craftTimeSeconds <= 0) {
    return 0;
  }
  return (displayAmount * 60) / craftTimeSeconds;
}
