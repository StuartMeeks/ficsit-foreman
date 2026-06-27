/**
 * @foreman/sf-game-data — the shared Satisfactory game-data foundation.
 *
 * Holds the hand-written `en-US.json` parser, the clean `GameData` types, the
 * docs-path/channel resolution, and (bundled under `data/`) the game data
 * itself. The unified `@foreman/sf-mcp` server consumes this package so
 * item/recipe class names and display names resolve identically across its tool
 * sets. The Kùzu graph layer lives in `@foreman/sf-game-data-graph`, not here —
 * this package's only runtime dependency is the shared kernel `@foreman/sf-core`.
 */

// Parser types.
export type {
  GameData,
  Item,
  Recipe,
  Building,
  Schematic,
  SchematicType,
  Ingredient,
  ItemForm,
  IngredientUnit,
  BuildCostLine,
  FuelFlow,
  GeneratorFuel,
  VariablePower,
  ParseResult,
  RawClass,
} from './parser/types.js';

// Parser entry points.
export { parseGameData, parseDocsFile, emptyGameData } from './parser/index.js';

// Reader (UTF-16 BOM decode + docs-file read).
export { readDocsFile } from './parser/reader.js';

// Class-name resolution helper (re-exported from the shared kernel). Humanising a
// class name is presentation, not identity — it lives in @foreman/sf-present.
export { extractClassNames } from '@foreman/sf-core';

// Fluid amount/unit helpers.
export { isFluid, toDisplayAmount, perMinute } from './parser/normalise/fluids.js';

// NativeClass → category mapping.
export { categoryFor, shortNameFromNativeClass, type Category } from './parser/classMap.js';

// Docs-path / channel resolution + bundled data location.
export type { GameChannel, DocsPathResolution } from './config.js';
export {
  GAME_CHANNELS,
  resolveDocsPath,
  bundledDataDir,
  channelDocsPath,
  expandHome,
} from './config.js';

// World-location dataset (collectibles + resource nodes) + loader.
export type {
  WorldLocations,
  WorldLocationsResolution,
  Collectible,
  ResourceNode,
  LootPickup,
  UnlockCost,
  CollectibleKind,
  ResourceNodeKind,
  Purity,
} from './world/types.js';
export {
  loadWorldLocations,
  emptyWorldLocations,
  channelWorldLocationsPath,
} from './world/index.js';
// Merged-dataset loaders (#161): the runtime loads pre-extracted `gameData` from
// `sf-game-data.json` instead of parsing `en-US.json`. `loadDataset` reads the
// merged file once and returns both halves; the two single-purpose loaders wrap it.
export { loadDataset, loadGameData } from './world/index.js';
export type { DatasetResolution, GameDataResolution } from './world/index.js';
// NOTE: world-coordinate presentation helpers (cm↔m unit conversion, compass
// bearing) deliberately do NOT live here. They are presentation, so they live at
// the edge (`@foreman/sf-mcp`); this neutral library returns raw, game-native
// data — centimetre coordinates and raw distances. See docs/component-architecture.md.

// Spatial queries over the bundled world dataset (nearest collectibles / resource
// nodes / loot, per-kind progress). Pure data queries — no graph engine.
export { WorldQueries } from './world/queries.js';
export type {
  Coord,
  ResourceRef,
  CollectibleHit,
  ResourceNodeHit,
  LootPickupHit,
  PartSummary,
} from './world/queries.js';
