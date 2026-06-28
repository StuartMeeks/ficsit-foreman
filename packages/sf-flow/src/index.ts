/**
 * @foreman/sf-flow — a pure steady-state material-flow solver.
 *
 * Given an abstract flow network (nodes with per-item supply/demand, edges with
 * throughput caps + optional item filters), {@link solveFlow} reconciles the actual
 * delivered rate at every input and the throughput each producer can sustain, with
 * contention, capacity limits, splitter filters and starvation feedback all resolved to
 * a fixed point. No game data, no save types, no I/O — the `sf-mcp` adapter maps the
 * save graph + effective game data onto this model (and applies fluid head-lift limits
 * as zeroed edge capacities). See `docs/flow-solver.md`.
 */
export { solveFlow } from './solve.js';
export type {
  FlowNetwork,
  FlowNode,
  FlowEdge,
  FlowResult,
  RateMap,
  SolveOptions,
} from './types.js';
