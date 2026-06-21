import type { Item, ItemForm, RawClass } from '../types.js';
import { getNumber, getString } from '../util.js';

const FORM_MAP: Record<string, ItemForm> = {
  RF_SOLID: 'solid',
  RF_LIQUID: 'liquid',
  RF_GAS: 'gas',
  RF_INVALID: 'invalid',
};

/** Stack-size enum → count, used when `mCachedStackSize` is absent. */
const STACK_SIZE_MAP: Record<string, number> = {
  SS_ONE: 1,
  SS_SMALL: 50,
  SS_MEDIUM: 100,
  SS_BIG: 200,
  SS_HUGE: 500,
  SS_FLUID: 0,
};

export function mapForm(raw: string): ItemForm {
  return FORM_MAP[raw] ?? 'invalid';
}

function resolveStackSize(raw: RawClass): number {
  // `mCachedStackSize` is the resolved integer when present; prefer it.
  const cached = getNumber(raw, 'mCachedStackSize', Number.NaN);
  if (Number.isFinite(cached) && cached > 0) {
    return cached;
  }
  const enumValue = getString(raw, 'mStackSize');
  return STACK_SIZE_MAP[enumValue] ?? 0;
}

/**
 * Builds an `Item` from a raw item/resource class. `isResource` distinguishes
 * raw resources (leaf nodes) from manufactured items.
 */
export function itemFromRaw(raw: RawClass, isResource: boolean): Item {
  return {
    className: getString(raw, 'ClassName'),
    displayName: getString(raw, 'mDisplayName'),
    description: getString(raw, 'mDescription'),
    stackSize: resolveStackSize(raw),
    form: mapForm(getString(raw, 'mForm')),
    sinkPoints: getNumber(raw, 'mResourceSinkPoints', 0),
    isResource,
  };
}
