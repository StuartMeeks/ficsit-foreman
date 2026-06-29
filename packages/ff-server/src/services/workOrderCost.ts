/**
 * Pure cost roll-ups over the work-order step → buildable → buildCost hierarchy.
 * A buildable's `buildCost` is its PER-UNIT construction cost; a step's cost is the
 * sum over its buildables of `requiredCount × buildCost`, aggregated by item. The
 * order total aggregates across all steps. "Remaining" uses `requiredCount −
 * builtCount` so the figure shrinks as the Pioneer builds. Shared by the API
 * response shape and (duplicated) the client; kept dependency-free for reuse + tests.
 */
import type { Buildable, BuildableDef, BuildCostLine, WorkOrderStep } from '../types.js';

/** An aggregated cost line: total quantity of one item across some buildables. */
export interface CostLine {
  itemName: string;
  itemClass?: string;
  amount: number;
}

/** Multiplies a buildable's per-unit cost by a count (e.g. requiredCount or remaining). */
function scaleCost(cost: BuildCostLine[], count: number): CostLine[] {
  return count <= 0 ? [] : cost.map((c) => ({ ...c, amount: c.amount * count }));
}

/** Aggregates cost lines by item (itemClass preferred as the key, else itemName). */
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

/** Total build cost of one buildable (per-unit × requiredCount). */
export function buildableCost(b: BuildableDef): CostLine[] {
  return aggregate(scaleCost(b.buildCost, b.requiredCount));
}

/** Total build cost of a step (sum over its buildables, aggregated by item). */
export function stepCost(step: { buildables: BuildableDef[] }): CostLine[] {
  return aggregate(step.buildables.flatMap((b) => scaleCost(b.buildCost, b.requiredCount)));
}

/** Total build cost of a whole work order (sum over all steps). */
export function workOrderCost(steps: { buildables: BuildableDef[] }[]): CostLine[] {
  return aggregate(
    steps.flatMap((s) => s.buildables.flatMap((b) => scaleCost(b.buildCost, b.requiredCount))),
  );
}

/**
 * The build cost still outstanding — per-unit × (requiredCount − builtCount),
 * floored at 0 per buildable — aggregated across all steps. Needs the live
 * (execution) shape, since it reads `builtCount`.
 */
export function remainingCost(steps: WorkOrderStep[]): CostLine[] {
  return aggregate(
    steps.flatMap((s) =>
      s.buildables.flatMap((b: Buildable) =>
        scaleCost(b.buildCost, b.requiredCount - b.builtCount),
      ),
    ),
  );
}
