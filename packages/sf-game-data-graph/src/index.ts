/**
 * @foreman/sf-game-data-graph — the in-memory production graph over Satisfactory
 * game data.
 *
 * Builds a recipe/item/building/schematic query facade from the parsed `GameData`
 * (`@foreman/sf-game-data`) and answers relational queries: what a recipe
 * makes/consumes, full production lines + costs, alternate comparisons, and power
 * generators. Relationship queries read two precomputed item→recipe adjacency
 * maps; there is no database dependency. See `docs/component-architecture.md`.
 */

// Graph facade + builder.
export { GraphDB, initGraph } from './graph/index.js';

// Query response shapes.
export * from './graph/types.js';
