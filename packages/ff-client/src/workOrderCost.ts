/**
 * Client-side mirror of the server's work-order cost roll-ups (#62). A buildable's
 * `buildCost` is its PER-UNIT construction cost; a step's cost sums over its buildables
 * (requiredCount × buildCost), aggregated by item; the order total sums across steps;
 * "remaining" uses `requiredCount − builtCount`. Kept tiny + pure (the server owns the
 * authoritative copy; this is for display only).
 */
import type { BuildCostLine, Buildable, WorkOrderStep } from './api/types.js';

export interface CostLine {
  itemName: string;
  itemClass?: string;
  amount: number;
}

function scale(cost: BuildCostLine[], count: number): CostLine[] {
  return count <= 0 ? [] : cost.map((c) => ({ ...c, amount: c.amount * count }));
}

function aggregate(lines: CostLine[]): CostLine[] {
  const byKey = new Map<string, CostLine>();
  for (const line of lines) {
    const key = line.itemClass ?? line.itemName;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { ...line });
    } else {
      existing.amount += line.amount;
    }
  }
  return [...byKey.values()].sort((a, b) => a.itemName.localeCompare(b.itemName));
}

/** A step's total build cost (per-unit × requiredCount, aggregated by item). */
export function stepCost(step: { buildables: Buildable[] }): CostLine[] {
  return aggregate(step.buildables.flatMap((b) => scale(b.buildCost, b.requiredCount)));
}

/** The whole order's build cost. */
export function totalCost(steps: WorkOrderStep[]): CostLine[] {
  return aggregate(
    steps.flatMap((s) => s.buildables.flatMap((b) => scale(b.buildCost, b.requiredCount))),
  );
}

/** The build cost still outstanding (per-unit × remaining count), aggregated by item. */
export function remainingCost(steps: WorkOrderStep[]): CostLine[] {
  return aggregate(
    steps.flatMap((s) =>
      s.buildables.flatMap((b) => scale(b.buildCost, b.requiredCount - b.builtCount)),
    ),
  );
}
