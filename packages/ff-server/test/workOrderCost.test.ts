import { describe, expect, it } from 'vitest';

import type { WorkOrderStep } from '../src/types.js';
import { remainingCost, stepCost, workOrderCost } from '../src/services/workOrderCost.js';

/** Two steps: 8 generators (10 concrete each) + 8 splitters (2 iron plate each). */
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
        builtCount: 0,
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
        builtCount: 0,
        buildCost: [{ itemName: 'Iron Plate', itemClass: 'Desc_IronPlate_C', amount: 2 }],
      },
    ],
  },
];

describe('workOrderCost roll-ups', () => {
  it('computes per-step cost (per-unit × requiredCount)', () => {
    expect(stepCost(steps[0]!)).toEqual([
      { itemName: 'Concrete', itemClass: 'Desc_Cement_C', amount: 80 },
    ]);
    expect(stepCost(steps[1]!)).toEqual([
      { itemName: 'Iron Plate', itemClass: 'Desc_IronPlate_C', amount: 16 },
    ]);
  });

  it('computes the order total, aggregating by item', () => {
    expect(workOrderCost(steps)).toEqual([
      { itemName: 'Concrete', itemClass: 'Desc_Cement_C', amount: 80 },
      { itemName: 'Iron Plate', itemClass: 'Desc_IronPlate_C', amount: 16 },
    ]);
  });

  it('aggregates the same item across buildables/steps into one line', () => {
    const sameItem: WorkOrderStep[] = [
      {
        ...steps[0]!,
        buildables: [
          {
            ...steps[0]!.buildables[0]!,
            buildCost: [{ itemName: 'Iron Plate', itemClass: 'Desc_IronPlate_C', amount: 1 }],
          },
        ],
      },
      steps[1]!,
    ];
    // 8×1 + 8×2 = 24 iron plate, one line.
    expect(workOrderCost(sameItem)).toEqual([
      { itemName: 'Iron Plate', itemClass: 'Desc_IronPlate_C', amount: 24 },
    ]);
  });

  it('shrinks remaining cost as buildables are built (requiredCount − builtCount)', () => {
    const partly: WorkOrderStep[] = [
      { ...steps[0]!, buildables: [{ ...steps[0]!.buildables[0]!, builtCount: 3 }] }, // 5 left ×10 = 50
      { ...steps[1]!, buildables: [{ ...steps[1]!.buildables[0]!, builtCount: 8 }] }, // 0 left
    ];
    expect(remainingCost(partly)).toEqual([
      { itemName: 'Concrete', itemClass: 'Desc_Cement_C', amount: 50 },
    ]);
  });
});
