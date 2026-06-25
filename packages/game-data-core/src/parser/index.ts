import fs from 'node:fs';
import path from 'node:path';

import type { GameData, Item, ItemForm, ParseResult, RawClass } from './types.js';
import { Warnings, isRecord } from './util.js';
import { categoryFor, shortNameFromNativeClass } from './classMap.js';
import { readDocsFile } from './reader.js';
import { itemFromRaw } from './extractors/items.js';
import { buildingFromRaw } from './extractors/buildings.js';
import {
  extractBuildRecipe,
  extractRecipe,
  isBuildGunRecipe,
  type RecipeLookups,
} from './extractors/recipes.js';
import { extractSchematic, type SchematicLookups } from './extractors/schematics.js';

/** Raw class entries grouped by their resolved category. */
interface Buckets {
  items: RawClass[];
  resources: RawClass[];
  buildings: { raw: RawClass; shortName: string }[];
  recipes: RawClass[];
  schematics: RawClass[];
}

export function emptyGameData(version: string, build?: number): GameData {
  return {
    version,
    build,
    parsedAt: new Date().toISOString(),
    items: {},
    resources: {},
    recipes: {},
    buildings: {},
    schematics: {},
  };
}

function bucketRawClasses(raw: unknown, warnings: Warnings): Buckets {
  const buckets: Buckets = {
    items: [],
    resources: [],
    buildings: [],
    recipes: [],
    schematics: [],
  };
  if (!Array.isArray(raw)) {
    warnings.add('Docs file root is not an array; no data extracted.');
    return buckets;
  }

  const skipped = new Map<string, number>();
  for (const group of raw) {
    if (!isRecord(group) || typeof group['NativeClass'] !== 'string') {
      continue;
    }
    const shortName = shortNameFromNativeClass(group['NativeClass']);
    const classes = group['Classes'];
    if (!Array.isArray(classes)) {
      continue;
    }
    const category = categoryFor(shortName);
    if (category === undefined) {
      skipped.set(shortName, (skipped.get(shortName) ?? 0) + classes.length);
      continue;
    }
    for (const entry of classes) {
      if (!isRecord(entry)) {
        continue;
      }
      switch (category) {
        case 'item':
          buckets.items.push(entry);
          break;
        case 'resource':
          buckets.resources.push(entry);
          break;
        case 'building':
          buckets.buildings.push({ raw: entry, shortName });
          break;
        case 'recipe':
          buckets.recipes.push(entry);
          break;
        case 'schematic':
          buckets.schematics.push(entry);
          break;
      }
    }
  }

  for (const [shortName, count] of skipped) {
    warnings.add(
      `Skipped ${count} entr${count === 1 ? 'y' : 'ies'} of unrecognised class '${shortName}'.`,
    );
  }
  return buckets;
}

/** Looks for a community-convention `GameVersion.txt` next to the docs file. */
function detectVersion(filePath: string): string {
  try {
    const dir = path.dirname(filePath);
    // 1. Foreman's own metadata sidecar (used by the bundled channel data).
    const metaPath = path.join(dir, 'meta.json');
    if (fs.existsSync(metaPath)) {
      const meta: unknown = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (isRecord(meta) && typeof meta['gameVersion'] === 'string' && meta['gameVersion'] !== '') {
        return meta['gameVersion'];
      }
    }
    // 2. Legacy community convention: a GameVersion.txt next to the docs file.
    const candidates = [path.join(dir, 'GameVersion.txt'), path.join(dir, '..', 'GameVersion.txt')];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        const version = fs.readFileSync(candidate, 'utf8').trim();
        if (version !== '') {
          return version;
        }
      }
    }
  } catch {
    // Version detection is best-effort; fall through to 'unknown'.
  }
  return 'unknown';
}

/**
 * The Satisfactory changelist/build number from the channel `meta.json` sidecar
 * (`build`), or undefined when absent/unparsable. Best-effort, like
 * `detectVersion`. A save's `buildVersion` is this same integer.
 */
function detectBuild(filePath: string): number | undefined {
  try {
    const metaPath = path.join(path.dirname(filePath), 'meta.json');
    if (fs.existsSync(metaPath)) {
      const meta: unknown = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (isRecord(meta) && typeof meta['build'] === 'number') {
        return meta['build'];
      }
    }
  } catch {
    // Best-effort; fall through to undefined.
  }
  return undefined;
}

/**
 * Parses the docs file into clean `GameData`. Never throws on bad entries —
 * problems are collected into `parseWarnings`. The only throwing path is an
 * unreadable file or invalid JSON, which the caller handles.
 */
export function parseGameData(raw: unknown, version: string, build?: number): ParseResult {
  const warnings = new Warnings();
  const buckets = bucketRawClasses(raw, warnings);
  const gameData = emptyGameData(version, build);

  // 1. Items and resources first — recipes need item forms for fluid scaling.
  for (const rawItem of buckets.items) {
    const item = itemFromRaw(rawItem, false);
    if (item.className !== '') {
      gameData.items[item.className] = item;
    }
  }
  for (const rawResource of buckets.resources) {
    const resource = itemFromRaw(rawResource, true);
    if (resource.className !== '') {
      gameData.resources[resource.className] = resource;
    }
  }

  // Combined item lookups (manufactured items + raw resources).
  const itemForm = new Map<string, ItemForm>();
  const itemDisplay = new Map<string, string>();
  const itemClasses = new Set<string>();
  const itemsByClass = new Map<string, Item>();
  for (const item of [...Object.values(gameData.items), ...Object.values(gameData.resources)]) {
    itemForm.set(item.className, item.form);
    itemDisplay.set(item.className, item.displayName);
    itemClasses.add(item.className);
    itemsByClass.set(item.className, item);
  }

  // 2. Buildings (need item energy values to derive generator fuel rates).
  for (const { raw: rawBuilding, shortName } of buckets.buildings) {
    const building = buildingFromRaw(rawBuilding, shortName, itemsByClass);
    if (building.className !== '') {
      gameData.buildings[building.className] = building;
    }
  }
  const buildingDisplay = new Map<string, string>();
  const buildingClasses = new Set<string>();
  for (const building of Object.values(gameData.buildings)) {
    buildingDisplay.set(building.className, building.displayName);
    buildingClasses.add(building.className);
  }

  const recipeLookups: RecipeLookups = { itemForm, itemDisplay, buildingDisplay, buildingClasses };

  // 3. Recipes — split build-gun (build costs) from production recipes.
  const buildRecipeToBuilding = new Map<string, string>();
  let unlinkedBuildCosts = 0;
  for (const rawRecipe of buckets.recipes) {
    if (isBuildGunRecipe(rawRecipe)) {
      const build = extractBuildRecipe(rawRecipe);
      const recipeClassName =
        typeof rawRecipe['ClassName'] === 'string' ? rawRecipe['ClassName'] : '';
      if (build === undefined) {
        continue;
      }
      const building = gameData.buildings[build.buildingClassName];
      if (building !== undefined) {
        building.buildCost = build.cost;
        if (recipeClassName !== '') {
          buildRecipeToBuilding.set(recipeClassName, build.buildingClassName);
        }
      } else {
        unlinkedBuildCosts += 1;
      }
      continue;
    }
    const recipe = extractRecipe(rawRecipe, recipeLookups);
    if (recipe.className !== '') {
      gameData.recipes[recipe.className] = recipe;
    }
  }
  if (unlinkedBuildCosts > 0) {
    warnings.add(
      `${unlinkedBuildCosts} build recipe(s) could not be linked to a building by name heuristic.`,
    );
  }

  // 4. Schematics (need production recipe + build recipe maps).
  const productionRecipeClasses = new Set(Object.keys(gameData.recipes));
  const schematicLookups: SchematicLookups = {
    itemForm,
    itemDisplay,
    itemClasses,
    productionRecipeClasses,
    buildRecipeToBuilding,
  };
  for (const rawSchematic of buckets.schematics) {
    const schematic = extractSchematic(rawSchematic, schematicLookups);
    if (schematic.className !== '') {
      gameData.schematics[schematic.className] = schematic;
    }
  }

  warnings.add(
    `Parsed ${count(gameData.items)} items, ${count(gameData.resources)} resources, ` +
      `${count(gameData.recipes)} recipes, ${count(gameData.buildings)} buildings, ` +
      `${count(gameData.schematics)} schematics (version: ${version}).`,
  );

  return { gameData, parseWarnings: warnings.all() };
}

function count(record: Record<string, unknown>): number {
  return Object.keys(record).length;
}

/** Public API: read, decode and parse the docs file at `filePath`. */
export function parseDocsFile(filePath: string): ParseResult {
  const version = detectVersion(filePath);
  const build = detectBuild(filePath);
  const raw = readDocsFile(filePath);
  return parseGameData(raw, version, build);
}

export type { GameData, Item, Recipe, Building, ParseResult } from './types.js';
