/**
 * @foreman/sf-present — reusable Satisfactory presentation/formatting helpers.
 *
 * The edge of the stack (the MCP server, the app, or any community consumer)
 * turns raw, game-native data from the neutral `sf-*` data libraries into
 * pioneer-facing strings and units. Those helpers live here — not baked into the
 * data parsers/graphs (which stay faithful) and not stranded inside the MCP
 * server (so they are reusable without it). No runtime dependencies. See
 * `docs/component-architecture.md` → Presentation boundary.
 */

// Class-name humanising (cosmetic class → Title-Case fallback).
export { humaniseClassName } from './classRef.js';

// World-coordinate unit conversion + compass bearing (centimetres ↔ metres).
export { cmToMetres, metresToCm, compassBearing } from './units.js';
