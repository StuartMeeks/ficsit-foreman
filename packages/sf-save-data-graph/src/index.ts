/**
 * @foreman/sf-save-data-graph — the save-game connection graph.
 *
 * Reconstructs a Satisfactory factory's connectivity (conveyor + pipe links and
 * pre-grouped power circuits) from a parsed `.sav` (`@foreman/sf-save-data`) into an
 * in-memory, game-data-agnostic graph keyed by raw `Build_*` class names. It is the
 * substrate every *relational* save question queries: power (#68), production
 * feed-tracing and bottlenecks (#126), logistics and map adjacency.
 *
 * Strictly downward: depends on the parser package only; no game-data and no app
 * concerns. Cross-domain enrichment (resolving class names to display names) is the
 * consumer's job at the edge (`sf-mcp`). See `docs/component-architecture.md`.
 */

// Graph builder + query facade.
export { buildSaveGraph, ownerOf } from './build.js';
export { SaveGraph } from './graph.js';

// Model + query-result shapes.
export * from './types.js';
