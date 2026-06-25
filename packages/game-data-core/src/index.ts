/**
 * @foreman/game-data-core — the shared Satisfactory game-data foundation.
 *
 * Holds the hand-written `en-US.json` parser, the clean `GameData` types, the
 * docs-path/channel resolution, and (bundled under `data/`) the game data
 * itself. Both MCP servers consume this package so item/recipe class names and
 * display names resolve identically across them. The Kùzu graph layer lives in
 * `@foreman/mcp-game-data`, not here — this package has no runtime dependencies.
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

// Class-name resolution helpers.
export { humaniseClassName, extractClassNames } from './parser/normalise/classRef.js';

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
  CollectibleKind,
  ResourceNodeKind,
  Purity,
} from './world/types.js';
export {
  loadWorldLocations,
  emptyWorldLocations,
  channelWorldLocationsPath,
} from './world/index.js';
export { cmToMetres, metresToCm, compassBearing } from './world/units.js';
