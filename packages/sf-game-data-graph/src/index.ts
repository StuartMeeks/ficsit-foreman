/**
 * @foreman/sf-game-data-graph — the Kùzu production graph over Satisfactory game
 * data.
 *
 * Builds an in-memory recipe/item/building/schematic graph from the parsed
 * `GameData` (`@foreman/sf-game-data`) and answers relational queries: what a
 * recipe makes/consumes, full production lines + costs, alternate comparisons,
 * power generators, and a read-only Cypher escape hatch. Depends on `kuzu` (a
 * native addon) — kept here so parser-only consumers of `@foreman/sf-game-data`
 * don't pull it in. See `docs/component-architecture.md`.
 */

// Graph facade + builder.
export { GraphDB, initGraph, type CypherResult } from './graph/index.js';

// Query response shapes.
export * from './graph/types.js';
