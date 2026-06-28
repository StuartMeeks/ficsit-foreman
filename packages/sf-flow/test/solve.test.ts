import { describe, expect, it } from 'vitest';

import { solveFlow, type FlowNetwork } from '../src/index.js';

const near = (a: number, b: number, tol = 1e-3): boolean => Math.abs(a - b) <= tol;

describe('solveFlow — chains & starvation', () => {
  it('runs a producer at full throughput when its input is over-supplied', () => {
    const net: FlowNetwork = {
      nodes: [
        { id: 'src', supply: { ore: 60 } },
        { id: 'mac', demand: { ore: 30 } },
      ],
      edges: [{ from: 'src', to: 'mac', capacity: Infinity }],
    };
    const r = solveFlow(net);
    expect(r.throughput.mac).toBe(1);
    expect(near(r.delivered.mac?.ore ?? 0, 60)).toBe(true);
  });

  it('starves a producer in proportion to its under-supplied input', () => {
    const net: FlowNetwork = {
      nodes: [
        { id: 'src', supply: { ore: 15 } },
        { id: 'mac', demand: { ore: 30 } },
      ],
      edges: [{ from: 'src', to: 'mac', capacity: Infinity }],
    };
    const r = solveFlow(net);
    expect(near(r.delivered.mac?.ore ?? 0, 15)).toBe(true);
    expect(near(r.throughput.mac ?? 0, 0.5)).toBe(true);
  });
});

describe('solveFlow — contention & capacity', () => {
  it('splits a shared source between competing consumers by demand', () => {
    const net: FlowNetwork = {
      nodes: [
        { id: 'src', supply: { ore: 60 } },
        { id: 'split' },
        { id: 'a', demand: { ore: 60 } },
        { id: 'b', demand: { ore: 60 } },
      ],
      edges: [
        { from: 'src', to: 'split', capacity: Infinity },
        { from: 'split', to: 'a', capacity: Infinity },
        { from: 'split', to: 'b', capacity: Infinity },
      ],
    };
    const r = solveFlow(net);
    expect(near(r.delivered.a?.ore ?? 0, 30)).toBe(true);
    expect(near(r.delivered.b?.ore ?? 0, 30)).toBe(true);
    expect(near(r.throughput.a ?? 0, 0.5)).toBe(true);
  });

  it('caps delivery at the belt throughput limit', () => {
    const net: FlowNetwork = {
      nodes: [
        { id: 'src', supply: { ore: 120 } },
        { id: 'mac', demand: { ore: 120 } },
      ],
      edges: [{ from: 'src', to: 'mac', capacity: 60 }],
    };
    const r = solveFlow(net);
    expect(near(r.delivered.mac?.ore ?? 0, 60)).toBe(true);
    expect(near(r.throughput.mac ?? 0, 0.5)).toBe(true);
  });
});

describe('solveFlow — splitter filters & overflow', () => {
  it('routes each item only down an edge that allows it (smart splitter)', () => {
    const net: FlowNetwork = {
      nodes: [
        { id: 'src', supply: { x: 60, y: 60 } },
        { id: 'split' },
        { id: 'a', demand: { x: 60 } },
        { id: 'b', demand: { y: 60 } },
      ],
      edges: [
        { from: 'src', to: 'split', capacity: Infinity },
        { from: 'split', to: 'a', capacity: Infinity, allow: ['x'] },
        { from: 'split', to: 'b', capacity: Infinity, allow: ['y'] },
      ],
    };
    const r = solveFlow(net);
    expect(near(r.delivered.a?.x ?? 0, 60)).toBe(true);
    expect(r.delivered.a?.y ?? 0).toBe(0); // y filtered out of A's branch
    expect(near(r.delivered.b?.y ?? 0, 60)).toBe(true);
    expect(r.throughput.a).toBe(1);
    expect(r.throughput.b).toBe(1);
  });

  it('spills a capacity-limited output to its overflow sibling', () => {
    const net: FlowNetwork = {
      nodes: [
        { id: 'src', supply: { ore: 120 } },
        { id: 'split' },
        { id: 'a', demand: { ore: 200 } }, // wants everything, but its belt caps at 60
        { id: 'b', demand: { ore: 200 } },
      ],
      edges: [
        { from: 'src', to: 'split', capacity: Infinity },
        { from: 'split', to: 'a', capacity: 60 },
        { from: 'split', to: 'b', capacity: Infinity, overflow: true },
      ],
    };
    const r = solveFlow(net);
    expect(near(r.delivered.a?.ore ?? 0, 60)).toBe(true); // capped
    expect(near(r.delivered.b?.ore ?? 0, 60)).toBe(true); // the 60 A could not take
  });
});

describe('solveFlow — feedback & cycles', () => {
  it('propagates a starved producer’s reduced output to its own consumer', () => {
    const net: FlowNetwork = {
      nodes: [
        { id: 'src', supply: { ore: 15 } },
        { id: 'p1', demand: { ore: 30 }, supply: { plate: 60 } }, // half-fed → half output
        { id: 'p2', demand: { plate: 60 } },
      ],
      edges: [
        { from: 'src', to: 'p1', capacity: Infinity },
        { from: 'p1', to: 'p2', capacity: Infinity },
      ],
    };
    const r = solveFlow(net);
    expect(near(r.throughput.p1 ?? 0, 0.5)).toBe(true);
    expect(near(r.delivered.p2?.plate ?? 0, 30)).toBe(true); // 60 × 0.5
    expect(near(r.throughput.p2 ?? 0, 0.5)).toBe(true);
  });

  it('reports nodes on a directed cycle rather than looping forever', () => {
    const net: FlowNetwork = {
      nodes: [
        { id: 'a', demand: { x: 10 }, supply: { x: 10 } },
        { id: 'b', demand: { x: 10 }, supply: { x: 10 } },
      ],
      edges: [
        { from: 'a', to: 'b', capacity: Infinity },
        { from: 'b', to: 'a', capacity: Infinity },
      ],
    };
    const r = solveFlow(net);
    expect(r.cyclic.sort()).toEqual(['a', 'b']);
  });
});
