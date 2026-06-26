/**
 * @foreman/sf-core — the shared structural/identity kernel for the Satisfactory
 * data packages.
 *
 * Game-agnostic helpers that both the game-data and save-data domains need, with
 * no game-data semantics and no runtime dependencies. The data parsers, graphs,
 * and MCP layers depend on this; it depends on nothing. See
 * `docs/component-architecture.md`.
 */

// Class-name resolution helpers.
export { humaniseClassName, extractClassNames } from './classRef.js';
