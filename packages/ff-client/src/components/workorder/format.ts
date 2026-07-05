// Small pure display helpers shared by the work-order views (live panel and,
// later, the revision-snapshot view).
import type {
  BuildableDef,
  CollectibleKind,
  Coordinates,
  ExpectedOutput,
} from '../../api/types.js';
import type { CostLine } from '../../workOrderCost.js';

/** Distances arrive in centimetres (Unreal units); shown in metres. */
export const metres = (cm: number): string => `${Math.round(cm / 100)}m`;

/** "(−120, 3088, 15) m" — map coordinates (cm) shown in whole metres. */
export function fmtCoords(c: Coordinates): string {
  const m = (v: number): string => `${Math.round(v / 100)}`;
  const parts = [m(c.x), m(c.y), ...(c.z !== undefined ? [m(c.z)] : [])];
  return `(${parts.join(', ')}) m`;
}

/** "12 Iron Plate, 4 Cable" — compact cost summary for display. */
export function fmtCost(lines: CostLine[]): string {
  return lines.map((l) => `${l.amount} ${l.itemName}`).join(', ');
}

/** A single buildable's extended build cost (per-unit × requiredCount). */
export function buildableCostLines(b: BuildableDef): CostLine[] {
  return b.buildCost.map((c) => ({ ...c, amount: c.amount * b.requiredCount }));
}

/** "2 Jul 2026" — compact date for header metadata and revision rows. */
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "2 Jul 18:20" — compact date+time for the operational timestamps strip. */
export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const COLLECTIBLE_LABEL: Record<CollectibleKind, string> = {
  mercerSphere: 'Mercer Sphere',
  somersloop: 'Somersloop',
  powerSlugBlue: 'Power Slug (Blue)',
  powerSlugYellow: 'Power Slug (Yellow)',
  powerSlugPurple: 'Power Slug (Purple)',
  hardDrive: 'Hard Drive',
  helmet: 'Customizer Helmet',
  mtape: 'Mixtape',
};

export function outputLine(out: ExpectedOutput): { label: string; value: string } {
  switch (out.kind) {
    case 'item':
      return { label: out.item, value: `${out.perMinute} ${out.unit ?? '/min'}` };
    case 'power':
      return { label: 'Power', value: `${out.megawatts} MW` };
    case 'unlock':
      return { label: 'Unlock', value: out.schematic };
    case 'infrastructure':
      return { label: 'Infrastructure', value: out.description };
    default:
      return { label: '', value: '' };
  }
}

/** Renders a diff value compactly: scalars as-is, arrays/objects as a count/blurb. */
export function summarise(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? '' : 's'}`;
  }
  if (typeof value === 'object') {
    return 'changed';
  }
  return String(value);
}
