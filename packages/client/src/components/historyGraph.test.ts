import { describe, expect, it } from 'vitest';

import type { WorkOrder } from '../api/types.js';
import { buildHistoryGraph } from './historyGraph.js';

/** Minimal WorkOrder for layout tests — only the fields the graph reads matter. */
function order(partial: Partial<WorkOrder> & { id: string; createdAt: string }): WorkOrder {
  return {
    sequenceNumber: 0,
    version: '1',
    title: partial.id,
    goal: '',
    machines: [],
    buildMaterials: [],
    recipes: [],
    expectedOutputs: [],
    buildSteps: [],
    state: 'completed',
    currentRevision: 1,
    hasUnacknowledgedRevision: false,
    childWorkOrderIds: [],
    updatedAt: partial.createdAt,
    ...partial,
  };
}

describe('buildHistoryGraph', () => {
  it('returns an empty graph with one lane for no orders', () => {
    expect(buildHistoryGraph([])).toEqual({ rows: [], laneCount: 1 });
  });

  it('orders newest-first and draws a single-lane trunk for roots only', () => {
    const graph = buildHistoryGraph([
      order({ id: 'a', sequenceNumber: 1, createdAt: '2026-01-01T00:00:00Z' }),
      order({ id: 'b', sequenceNumber: 2, createdAt: '2026-01-02T00:00:00Z' }),
      order({ id: 'c', sequenceNumber: 3, createdAt: '2026-01-03T00:00:00Z' }),
    ]);
    expect(graph.laneCount).toBe(1);
    // Newest (c) at the top.
    expect(graph.rows.map((r) => r.order.id)).toEqual(['c', 'b', 'a']);
    // Every node in lane 0; trunk is continuous (top has down, bottom has up).
    expect(graph.rows.every((r) => r.lane === 0 && r.cells[0]!.node)).toBe(true);
    expect(graph.rows[0]!.cells[0]).toMatchObject({ up: false, down: true });
    expect(graph.rows[1]!.cells[0]).toMatchObject({ up: true, down: true });
    expect(graph.rows[2]!.cells[0]).toMatchObject({ up: true, down: false });
  });

  it('forks a child into lane 1 with an elbow back to its parent', () => {
    // Parent created first (older, lower); child created later (newer, top).
    const graph = buildHistoryGraph([
      order({
        id: 'parent',
        sequenceNumber: 1,
        createdAt: '2026-01-01T00:00:00Z',
        state: 'blocked',
      }),
      order({
        id: 'child',
        sequenceNumber: 2,
        createdAt: '2026-01-02T00:00:00Z',
        parentWorkOrderId: 'parent',
        relationshipToParent: 'hard_drive_hunt',
      }),
    ]);
    expect(graph.laneCount).toBe(2);
    const [top, bottom] = graph.rows;
    expect(top!.order.id).toBe('child');
    expect(bottom!.order.id).toBe('parent');
    // Child node sits in lane 1, with the relationship label.
    expect(top!.lane).toBe(1);
    expect(top!.cells[1]!.node).toBe(true);
    expect(top!.relationshipLabel).toBe('hard-drive hunt');
    // The child lane runs down to the parent row, then elbows left into lane 0.
    expect(top!.cells[1]).toMatchObject({ down: true });
    expect(bottom!.cells[1]).toMatchObject({ up: true, left: true });
    expect(bottom!.cells[0]).toMatchObject({ node: true, right: true });
  });

  it('draws a child-lane through-line across an unrelated order between parent and child', () => {
    const graph = buildHistoryGraph([
      order({
        id: 'child',
        sequenceNumber: 3,
        createdAt: '2026-01-03T00:00:00Z',
        parentWorkOrderId: 'parent',
      }),
      order({ id: 'other', sequenceNumber: 2, createdAt: '2026-01-02T00:00:00Z' }),
      order({ id: 'parent', sequenceNumber: 1, createdAt: '2026-01-01T00:00:00Z' }),
    ]);
    // Rows: child (0), other (1), parent (2). Lane 1 spans rows 0..2.
    const middle = graph.rows[1]!;
    expect(middle.order.id).toBe('other');
    expect(middle.cells[1]).toMatchObject({ up: true, down: true });
  });

  it('clamps deep nesting to the max lane', () => {
    // A chain a → b → c → d → e (each parent of the next), depth 0..4.
    const chain: WorkOrder[] = [];
    let parentId: string | undefined;
    for (let i = 0; i < 5; i += 1) {
      const id = `n${i}`;
      chain.push(
        order({
          id,
          sequenceNumber: i,
          createdAt: `2026-01-0${i + 1}T00:00:00Z`,
          parentWorkOrderId: parentId,
        }),
      );
      parentId = id;
    }
    const graph = buildHistoryGraph(chain);
    // MAX_LANE is 3, so the deepest two nodes share lane 3.
    expect(Math.max(...graph.rows.map((r) => r.lane))).toBe(3);
  });
});
