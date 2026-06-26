/**
 * @foreman/sf-save-data — parses a Satisfactory `.sav` and normalises it into a
 * clean, game-data-agnostic `SaveState` model.
 *
 * The binary parse is delegated to `@etothepii/satisfactory-file-parser` behind a
 * single boundary (`parseSaveFile`); everything else here turns the raw object
 * graph into the typed `SaveState` (player, storage, recipes, milestones,
 * collectibles, production lines). It stores class-name strings only — joining to
 * recipe/building game data is a consumer's concern. See
 * `docs/component-architecture.md`.
 */

// Parser boundary + raw structural types + file reader.
export * from './parser/index.js';
export * from './parser/reader.js';
export * from './parser/types.js';

// Normalisation → SaveState model + its types + class-name helpers.
export * from './normalise/index.js';
export * from './normalise/types.js';
export * from './normalise/classRef.js';

// Satisfactory class-path / property matchers used across the normalise layer.
export * from './constants.js';
