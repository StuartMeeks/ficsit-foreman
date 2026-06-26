/**
 * Parses the custom Unreal Engine encoding used by `mIngredients`, `mProduct`
 * and schematic `mCost`:
 *
 *   ((ItemClass="…'/Game/…/Desc_IronPlate.Desc_IronPlate_C'",Amount=100),(…))
 *
 * Returns the raw class name and integer amount for each entry. Fluid scaling
 * (÷1000) and per-minute rates are applied later, once item forms are known.
 */

export interface RawItemAmount {
  className: string;
  amount: number;
}

const CLASS_IN_ENTRY = /[^']+'[^.]+\.(\w+)'/;
const AMOUNT_IN_ENTRY = /Amount=(\d+)/;

export function parseItemAmountList(raw: string): RawItemAmount[] {
  if (!raw) {
    return [];
  }
  const trimmed = raw.trim();
  // Outer wrapper is `(( … ))`; strip the first and last two characters.
  if (trimmed.length < 4 || !trimmed.startsWith('((') || !trimmed.endsWith('))')) {
    return [];
  }
  const inner = trimmed.slice(2, -2);
  if (inner.trim() === '') {
    return [];
  }
  return inner
    .split('),(')
    .map((entry): RawItemAmount => {
      const classMatch = entry.match(CLASS_IN_ENTRY);
      const amountMatch = entry.match(AMOUNT_IN_ENTRY);
      return {
        className: classMatch?.[1] ?? '',
        amount: Number.parseInt(amountMatch?.[1] ?? '0', 10),
      };
    })
    .filter((item) => item.className !== '');
}
