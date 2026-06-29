import { describe, expect, it } from 'vitest';

import type { WorkOrderStep } from './api/types.js';
import { remainingCost, stepCost, totalCost } from './workOrderCost.js';

const steps: WorkOrderStep[] = [
  {
    id: 's1',
    title: 'Generators',
    order: 0,
    checked: false,
    buildables: [
      {
        id: 'b1',
        name: 'Coal Generator',
        requiredCount: 8,
        builtCount: 3,
        buildCost: [{ itemName: 'Concrete', itemClass: 'Desc_Cement_C', amount: 10 }],
      },
    ],
  },
  {
    id: 's2',
    title: 'Logistics',
    order: 1,
    checked: false,
    buildables: [
      {
        id: 'b2',
        name: 'Conveyor Splitter',
        requiredCount: 8,
        builtCount: 8,
        buildCost: [{ itemName: 'Iron Plate', itemClass: 'Desc_IronPlate_C', amount: 2 }],
      },
    ],
  },
];

describe('client workOrderCost', () => {
  it('computes per-step and total cost', () => {
    expect(stepCost(steps[0]!)).toEqual([
      { itemName: 'Concrete', itemClass: 'Desc_Cement_C', amount: 80 },
    ]);
    expect(totalCost(steps)).toEqual([
      { itemName: 'Concrete', itemClass: 'Desc_Cement_C', amount: 80 },
      { itemName: 'Iron Plate', itemClass: 'Desc_IronPlate_C', amount: 16 },
    ]);
  });

  it('reflects built progress in the remaining cost', () => {
    // Generators: 5 left × 10 = 50; splitters: 0 left.
    expect(remainingCost(steps)).toEqual([
      { itemName: 'Concrete', itemClass: 'Desc_Cement_C', amount: 50 },
    ]);
  });
});
