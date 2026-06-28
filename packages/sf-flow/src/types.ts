/**
 * The abstract flow network the solver reconciles. It is deliberately game-agnostic:
 * nodes carry per-item supply/demand rates and edges carry throughput caps + optional
 * item filters — all plain numbers. The `sf-mcp` adapter builds this from the save graph
 * (connectivity, splitter rules) and the effective game data (recipe rates, belt/pipe
 * caps, pump head lift); fluid head-lift limits are applied by the adapter as a zeroed
 * edge capacity, so the solver itself never needs geometry.
 */

/** A rate map: item class → units per minute. */
export type RateMap = Record<string, number>;

export interface FlowNode {
  id: string;
  /**
   * Items this node emits **at full throughput** (a producer's recipe outputs, an
   * extractor's resource), per minute. A node's actual output scales by its solved
   * throughput. Omit for pure consumers and pass-through nodes.
   */
  supply?: RateMap;
  /**
   * Items this node consumes **at full throughput** (a producer's recipe inputs), per
   * minute. Drives the throughput it can sustain. Omit for sources and pass-throughs.
   */
  demand?: RateMap;
}

export interface FlowEdge {
  /** Upstream node id (flow leaves here). */
  from: string;
  /** Downstream node id (flow arrives here). */
  to: string;
  /** Throughput cap across all items on this edge, per minute. Use `Infinity` if uncapped. */
  capacity: number;
  /**
   * Item classes permitted on this edge; `undefined` means any (a plain belt). Used to
   * model a smart/programmable splitter output filter, resolved by the adapter.
   */
  allow?: string[];
  /**
   * An overflow output: it only carries what its non-overflow siblings at the same
   * source cannot absorb (a smart-splitter `overflow` rule).
   */
  overflow?: boolean;
}

export interface FlowNetwork {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface SolveOptions {
  /** Fixed-point iteration cap (default 100). */
  maxIterations?: number;
  /** Convergence threshold on the largest per-node throughput change (default 1e-4). */
  epsilon?: number;
}

export interface FlowResult {
  /** delivered[nodeId][item] = units/min actually arriving at that node's input. */
  delivered: Record<string, RateMap>;
  /** throughput[nodeId] = 0..1, the fraction of full rate the node can sustain. */
  throughput: Record<string, number>;
  /**
   * Node ids that sit on a directed cycle, so flow to/through them could not be ordered
   * and their delivered/throughput is unreliable. Callers must treat these as *unknown*,
   * never as a negative verdict.
   */
  cyclic: string[];
}
