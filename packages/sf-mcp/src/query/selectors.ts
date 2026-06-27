import {
  type Building,
  type Collectible,
  type CollectibleKind as WorldCollectibleKind,
  type IngredientUnit,
  type LootPickup,
  type Purity,
  type Recipe,
  type ResourceNode,
  type UnlockCost,
  type WorldLocations,
} from '@foreman/sf-game-data';
import { cmToMetres, compassBearing, humaniseClassName } from '@foreman/sf-present';

import { WATER_EXTRACTOR, WATER_ITEM_CLASS } from '@foreman/sf-save-data';
import type { GameDataIndex, NameResolver } from '../gameData.js';
import type {
  AssemblyPhase,
  ExtractorLine,
  Inventory,
  MilestoneKind,
  ProducerLine,
  SaveState,
  Vec3,
} from '@foreman/sf-save-data';

/** Convert a centimetre position to the metres the pioneer sees in-game (2dp). */
function vecToMetres(v: Vec3): Vec3 {
  return { x: cmToMetres(v.x), y: cmToMetres(v.y), z: cmToMetres(v.z) };
}

/**
 * The save model carries raw class names only; these tool-facing shapes add the
 * resolved display name at the edge (game-data authored name, or humanised
 * fallback). The output field stays named `displayName` for response stability.
 */
export interface NamedStack {
  itemClass: string;
  displayName: string;
  quantity: number;
}

export interface NamedRecipe {
  recipeClass: string;
  displayName: string;
  isAlternate: boolean;
}

export interface NamedMilestone {
  schematicClass: string;
  displayName: string;
  tier?: number;
  kind: MilestoneKind;
}

export interface NamedContainer {
  buildingClass: string;
  displayName: string;
  location?: Vec3;
  inventory: NamedStack[];
  distance?: number;
}

/** Resolve a save inventory's item classes to display-named stacks. */
function nameStacks(inventory: Inventory, resolve: NameResolver): NamedStack[] {
  return inventory.map((s) => ({
    itemClass: s.itemClass,
    displayName: resolve(s.itemClass),
    quantity: s.quantity,
  }));
}

/** Strips the "BPD Research Tree" / "Research Tree" prefix from a humanised name. */
function cleanResearchTreeName(name: string): string {
  return name.replace(/^(?:BPD\s+)?Research Tree\s+/i, '').trim();
}

/**
 * Pure, tool-facing read functions over a `SaveState`. These shape the computed
 * answers the MCP tools return; keeping them here keeps `tools/index.ts` thin and
 * makes the logic directly unit-testable.
 */

export interface PlayerSummary {
  location?: Vec3;
  hubLocation?: Vec3;
  /** Total in-game play time in seconds, if the save header carries it. */
  playDurationSeconds?: number;
  /** The same play time formatted as "Xh Ym", for convenience. */
  playTime?: string;
  itemCount: number;
  inventory: NamedStack[];
}

export function playerSummary(state: SaveState, resolve: NameResolver): PlayerSummary {
  return {
    location: state.player.location === undefined ? undefined : vecToMetres(state.player.location),
    hubLocation:
      state.player.hubLocation === undefined ? undefined : vecToMetres(state.player.hubLocation),
    playDurationSeconds: state.playDurationSeconds,
    playTime: formatDuration(state.playDurationSeconds),
    itemCount: state.player.inventory.length,
    inventory: nameStacks(state.player.inventory, resolve),
  };
}

/** Formats a duration in seconds as "Xh Ym" (e.g. 45296 → "12h 34m"). */
function formatDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return undefined;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export interface RecipeSummary {
  total: number;
  standardCount: number;
  alternateCount: number;
  standard: NamedRecipe[];
  alternates: NamedRecipe[];
}

export function unlockedRecipes(state: SaveState, resolve: NameResolver): RecipeSummary {
  const named: NamedRecipe[] = state.recipes
    .map((r) => ({
      recipeClass: r.recipeClass,
      displayName: resolve(r.recipeClass),
      isAlternate: r.isAlternate,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const standard = named.filter((r) => !r.isAlternate);
  const alternates = named.filter((r) => r.isAlternate);
  return {
    total: named.length,
    standardCount: standard.length,
    alternateCount: alternates.length,
    standard,
    alternates,
  };
}

export interface MilestoneSummary {
  assemblyPhase?: AssemblyPhase;
  milestonesByTier: { tier: number; milestones: NamedMilestone[] }[];
  tutorials: NamedMilestone[];
  other: NamedMilestone[];
  mamResearch: string[];
}

export function milestones(state: SaveState, resolve: NameResolver): MilestoneSummary {
  const byTier = new Map<number, NamedMilestone[]>();
  const tutorials: NamedMilestone[] = [];
  const other: NamedMilestone[] = [];
  for (const m of state.milestones) {
    const named: NamedMilestone = {
      schematicClass: m.schematicClass,
      displayName: resolve(m.schematicClass),
      tier: m.tier,
      kind: m.kind,
    };
    if (m.kind === 'tutorial') {
      tutorials.push(named);
    } else if (m.kind === 'milestone' && m.tier !== undefined) {
      const bucket = byTier.get(m.tier) ?? [];
      bucket.push(named);
      byTier.set(m.tier, bucket);
    } else {
      other.push(named);
    }
  }
  return {
    assemblyPhase: state.assemblyPhase,
    milestonesByTier: [...byTier.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([tier, list]) => ({ tier, milestones: list })),
    tutorials,
    other,
    // Research trees aren't in game data, so resolve() humanises; trim the verbose
    // "BPD Research Tree X" prefix to the bare tree name and re-sort alphabetically.
    mamResearch: state.mamResearch
      .map((cls) => cleanResearchTreeName(resolve(cls)))
      .sort((a, b) => a.localeCompare(b)),
  };
}

export interface StorageView {
  containerCount: number;
  containers: NamedContainer[];
  dimensionalDepot: NamedStack[];
}

/**
 * Storage containers and the dimensional depot, with container locations in
 * metres. When a `location` (in metres, e.g. from get_player_state) is given,
 * containers are annotated with distance to it and sorted nearest-first.
 */
export function storageView(state: SaveState, resolve: NameResolver, location?: Vec3): StorageView {
  const containers: NamedContainer[] = state.storage.containers.map((container) => {
    const locM = container.location === undefined ? undefined : vecToMetres(container.location);
    return {
      buildingClass: container.buildingClass,
      displayName: resolve(container.buildingClass),
      location: locM,
      inventory: nameStacks(container.inventory, resolve),
      distance: location !== undefined && locM !== undefined ? distance(location, locM) : undefined,
    };
  });
  if (location !== undefined) {
    containers.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }
  return {
    containerCount: state.storage.containers.length,
    containers,
    dimensionalDepot: nameStacks(state.storage.dimensionalDepot, resolve),
  };
}

const COLLECTIBLE_KINDS: WorldCollectibleKind[] = [
  'mercerSphere',
  'somersloop',
  'powerSlugBlue',
  'powerSlugYellow',
  'powerSlugPurple',
  'hardDrive',
  'helmet',
  'mtape',
];

const COVERAGE_NOTE =
  "Exact per-kind counts. collected is read from the save's own collected record " +
  "(FGScannableSubsystem), matched to the world dataset by each collectible's GUID, so it is " +
  'accurate at any exploration level — never an estimate. remaining = worldTotal − collected ' +
  '(still out there); use get_nearby for the locations of those remaining ones.';

export interface CollectibleProgress {
  kind: WorldCollectibleKind;
  label: string;
  /** Fixed map-wide total for this kind. */
  worldTotal: number;
  /** Exactly how many the pioneer has collected (from the save's GUID record). */
  collected: number;
  /** Still out there to grab (worldTotal − collected). */
  remaining: number;
}

export interface CollectibleProgressView {
  perType: CollectibleProgress[];
  note: string;
}

/**
 * Exact per-kind collectible progress. The save's `FGScannableSubsystem` records
 * the GUID of every collected pickup (spheres/sloops/slugs) and looted hard-drive
 * pod; matching those against each world-dataset collectible's GUID gives an exact
 * collected count at any progression — no exploration-based estimation.
 */
export function collectibleProgressView(
  state: SaveState,
  world: WorldLocations,
): CollectibleProgressView {
  const collectedSet = collectedGuidSet(state);
  const unlockedSchematics = unlockedSchematicSet(state);
  const totals = new Map<string, number>();
  const collected = new Map<string, number>();
  for (const c of world.collectibles) {
    totals.set(c.kind, (totals.get(c.kind) ?? 0) + 1);
    if (isCollected(c, collectedSet, unlockedSchematics)) {
      collected.set(c.kind, (collected.get(c.kind) ?? 0) + 1);
    }
  }
  const perType: CollectibleProgress[] = COLLECTIBLE_KINDS.map((kind) => {
    const worldTotal = totals.get(kind) ?? 0;
    const got = collected.get(kind) ?? 0;
    return {
      kind,
      label: KIND_LABELS[kind] ?? kind,
      worldTotal,
      collected: got,
      remaining: worldTotal - got,
    };
  });
  return { perType, note: COVERAGE_NOTE };
}

/** Every collected-collectible GUID (pickups + looted pods) as one lookup set. */
export function collectedGuidSet(state: SaveState): Set<string> {
  return new Set([...state.collectedPickupGuids, ...state.lootedDropPodGuids]);
}

/**
 * Instance names of loose crash-site parts the save records as collected (from each
 * sublevel's `collectables` list). Matched against `lootPickups[].id` to drop
 * already-grabbed parts — loose parts are tracked here, not in `mDestroyedPickups`.
 */
export function collectedLootIdSet(state: SaveState): Set<string> {
  return new Set(state.collectedLootIds);
}

/**
 * The classes of every schematic the pioneer has unlocked. Customizer pickups
 * (helmet/tapes) carry no pickup GUID — picking one up unlocks a cosmetic
 * schematic, so this is how their collected status is determined.
 */
export function unlockedSchematicSet(state: SaveState): Set<string> {
  return new Set(state.milestones.map((m) => m.schematicClass));
}

/**
 * Whether a collectible has been collected: GUID-keyed kinds match the save's
 * destroyed-pickup record; schematic-keyed customizer kinds match the unlocked
 * schematics.
 */
export function isCollected(
  c: Collectible,
  collectedGuids: Set<string>,
  unlockedSchematics: Set<string>,
): boolean {
  if (c.guid !== undefined) {
    return collectedGuids.has(c.guid);
  }
  if (c.schematic !== undefined) {
    return unlockedSchematics.has(c.schematic);
  }
  return false;
}

/** A drop-pod unlock cost with the item descriptor resolved to a display name. */
export interface ResolvedUnlock {
  item?: { itemClass: string; name: string; amount: number };
  powerMW?: number;
}

/** Resolve a dataset unlock cost, upgrading the item class to a display name. */
function resolveUnlock(u: UnlockCost, itemName?: (className: string) => string): ResolvedUnlock {
  const out: ResolvedUnlock = {};
  if (u.item !== undefined) {
    out.item = {
      itemClass: u.item.itemClass,
      name: itemName?.(u.item.itemClass) ?? humaniseClassName(u.item.itemClass),
      amount: u.item.amount,
    };
  }
  if (u.powerMW !== undefined) {
    out.powerMW = u.powerMW;
  }
  return out;
}

export interface NearbyItem {
  kind: WorldCollectibleKind;
  label: string;
  /** World position in metres. */
  location: Vec3;
  /** Straight-line distance from the origin, in metres. */
  distance: number;
  /** 8-point compass direction from the origin (N, NE, E, …). */
  bearing: string;
  /** For hard-drive crash sites: what the pod requires to open (item and/or power). */
  unlock?: ResolvedUnlock;
}

export interface NearbyOptions {
  kinds?: WorldCollectibleKind[];
  radius?: number;
  limit?: number;
}

export interface NearbyResult {
  origin: Vec3;
  radius?: number;
  /** Total matches (before the limit was applied). */
  matchCount: number;
  items: NearbyItem[];
  /** Honest caveat: positions are from the static world dataset. */
  note: string;
}

const DEFAULT_NEARBY_LIMIT = 20;

const KIND_LABELS: Record<WorldCollectibleKind, string> = {
  mercerSphere: 'Mercer Sphere',
  somersloop: 'Somersloop',
  powerSlugBlue: 'Blue Power Slug',
  powerSlugYellow: 'Yellow Power Slug',
  powerSlugPurple: 'Purple Power Slug',
  hardDrive: 'Hard Drive (crash site)',
  helmet: 'Customizer Helmet',
  mtape: 'Tape',
};

const NEARBY_NOTE =
  'Un-collected collectibles only: positions are from the static world dataset, with the ' +
  'ones the save records as already collected (by GUID) removed — so these are genuinely ' +
  'still out there to grab. Locations + distances are in metres; bearing is the compass ' +
  'direction from you (N/NE/E/…).';

/**
 * Un-collected collectibles near a world location, nearest-first, in metres.
 * `origin` is in metres (e.g. from get_player_state) and `radius` in metres.
 * Positions come from the static world-location dataset (complete and accurate);
 * collectibles the save records as collected (by GUID, via `excludeGuids`) are
 * removed, so the result is exactly what is still grabbable. Each item carries a
 * compass bearing from the origin. Capped by `limit` (default 20).
 */
export function nearbyFromWorld(
  collectibles: Collectible[],
  origin: Vec3,
  options: NearbyOptions = {},
  excludeGuids?: Set<string>,
  excludeSchematics?: Set<string>,
  itemName?: (className: string) => string,
): NearbyResult {
  const limit = options.limit ?? DEFAULT_NEARBY_LIMIT;
  const collected = (c: Collectible): boolean =>
    (c.guid !== undefined && excludeGuids?.has(c.guid) === true) ||
    (c.schematic !== undefined && excludeSchematics?.has(c.schematic) === true);
  let items: NearbyItem[] = collectibles
    .filter((c) => (options.kinds === undefined || options.kinds.includes(c.kind)) && !collected(c))
    .map((c) => {
      const location = vecToMetres({ x: c.x, y: c.y, z: c.z });
      return {
        kind: c.kind,
        label: KIND_LABELS[c.kind] ?? c.kind,
        location,
        distance: distance(origin, location),
        bearing: compassBearing(origin, location),
        ...(c.unlock !== undefined ? { unlock: resolveUnlock(c.unlock, itemName) } : {}),
      };
    })
    .sort((a, b) => a.distance - b.distance);
  if (options.radius !== undefined) {
    const radius = options.radius;
    items = items.filter((i) => i.distance <= radius);
  }
  return {
    origin,
    radius: options.radius,
    matchCount: items.length,
    items: items.slice(0, limit),
    note: NEARBY_NOTE,
  };
}

/** Straight-line distance between two points (same units in, same units out; exact). */
export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export interface NearbyPart {
  /** Item display name. */
  item: string;
  /** Item descriptor class (e.g. Desc_Computer_C). */
  itemClass: string;
  /** Stack size at this pickup. */
  amount: number;
  /** World position in metres. */
  location: Vec3;
  /** Straight-line distance from the origin, in metres. */
  distance: number;
  /** 8-point compass direction from the origin. */
  bearing: string;
}

export interface NearbyPartsOptions {
  /** Filter to items whose class or display name contains this (case-insensitive). */
  item?: string;
  /** Cap matches to within this many metres of the origin. */
  radius?: number;
  limit?: number;
}

export interface NearbyPartsResult {
  origin: Vec3;
  radius?: number;
  matchCount: number;
  items: NearbyPart[];
  note: string;
}

const PARTS_NOTE =
  'Un-grabbed loose crash-site parts: positions are from the complete static world dataset ' +
  '(the corrected 1.2 loot — every spawn, map-wide), with the ones the save records as already ' +
  'picked up removed, so these are genuinely still out there to grab. Locations + distances are ' +
  'in metres; bearing is the compass direction from you. (A save that began before 1.2 may show ' +
  'a few different in-world items than listed here, due to a since-fixed game bug.)';

/**
 * Un-grabbed loose crash-site parts near a world location, nearest-first, in metres.
 * `origin`/`radius` are in metres. Positions come from the complete static world dataset;
 * parts the save records as collected (by instance id, via `excludeIds` — the per-sublevel
 * `collectables` record, NOT `mDestroyedPickups`) are removed, so the result is exactly what
 * is still grabbable. `itemName` upgrades the item descriptor class to a display name.
 */
export function nearbyParts(
  loot: LootPickup[],
  origin: Vec3,
  options: NearbyPartsOptions = {},
  excludeIds?: Set<string>,
  itemName?: (className: string) => string,
): NearbyPartsResult {
  const limit = options.limit ?? DEFAULT_NEARBY_LIMIT;
  const needle = options.item?.trim().toLowerCase();
  const label = (cls: string): string => itemName?.(cls) ?? humaniseClassName(cls);
  let items: NearbyPart[] = loot
    .filter((p) => excludeIds?.has(p.id) !== true)
    .filter(
      (p) =>
        needle === undefined ||
        needle === '' ||
        p.itemClass.toLowerCase().includes(needle) ||
        label(p.itemClass).toLowerCase().includes(needle),
    )
    .map((p) => {
      const location = vecToMetres({ x: p.x, y: p.y, z: p.z });
      return {
        item: label(p.itemClass),
        itemClass: p.itemClass,
        amount: p.amount,
        location,
        distance: distance(origin, location),
        bearing: compassBearing(origin, location),
      };
    })
    .sort((a, b) => a.distance - b.distance);
  if (options.radius !== undefined) {
    const radius = options.radius;
    items = items.filter((i) => i.distance <= radius);
  }
  return {
    origin,
    radius: options.radius,
    matchCount: items.length,
    items: items.slice(0, limit),
    note: PARTS_NOTE,
  };
}

// ── Production (theoretical capability) ──────────────────────────────────────

/**
 * What the factory *can* produce, given how every machine is configured. This is
 * theoretical capacity — recipe × clock × somersloop boost (× node purity for
 * extractors) — NOT measured output: it does not know whether a line is actually
 * fed (belts/splitters/pipes) or powered. That is tracked separately by the
 * actual-production graph. All figures are derived in-process from the game data.
 */

/** Output-rate multiplier per node purity (impure 0.5 / normal 1 / pure 2). */
const PURITY_MULTIPLIER: Record<Purity, number> = { impure: 0.5, normal: 1, pure: 2 };

/**
 * Satisfactory's overclock power exponent: power scales as `clock^1.321928`.
 * Somersloop production amplification scales power by `boost²` on top.
 */
const OVERCLOCK_POWER_EXPONENT = 1.321928;

/**
 * A miner / oil pump / fracking extractor snaps onto its node, so it sits within a
 * few hundred cm of the node centre. Keep the match tight (≈20 m) so an extractor is
 * never mis-resolved to a different, unrelated node nearby.
 */
const NODE_MATCH_CM = 2000;

/** Cap on individually-listed machines (when filtered by item), to bound tokens. */
const MAX_MACHINE_DETAIL = 100;

const PRODUCTION_NOTE =
  'Theoretical capacity, aggregated by output item: effective = recipe rate × clock × ' +
  'somersloop boost (× node purity for extractors), summed across machines. This is what the ' +
  'machines are CONFIGURED to make at full tilt — NOT measured output. It does not account for ' +
  'whether lines are actually fed (belts/splitters/pipes) or powered; that is tracked ' +
  'separately. Power figures are estimates. Pass `item` to also list the individual machines ' +
  '(with locations, in metres).';

export interface RateFlow {
  itemClass: string;
  name: string;
  /** Recipe rate at 100% clock, no boost. */
  basePerMinute: number;
  /** base × clock × boost (× purity for extractors). */
  effectivePerMinute: number;
  unit: IngredientUnit;
}

/** One machine's configuration + theoretical output (used for the detail listing). */
interface MachineLine {
  kind: 'manufacturer' | 'extractor';
  buildingClass: string;
  building: string;
  recipeClass?: string;
  recipe?: string;
  resourceClass?: string;
  resource?: string;
  purity?: Purity | 'unknown';
  clock: number;
  boost: number;
  location?: Vec3;
  outputs: RateFlow[];
  powerMW?: number;
}

/** A machine in the detail listing (compact; coordinates in metres). */
export interface MachineDetail {
  building: string;
  recipe?: string;
  resource?: string;
  purity?: Purity | 'unknown';
  clockPercent: number;
  productionBoost: number;
  location?: Vec3;
  outputs: RateFlow[];
  estimatedPowerMW?: number;
}

/** Per-recipe (or per-extractor) contribution to one output item. */
export interface ProductionSource {
  label: string;
  machineCount: number;
  effectivePerMinute: number;
}

/** Aggregated theoretical output of one item across the whole factory. */
export interface ProductionItem {
  item: string;
  itemClass: string;
  unit: IngredientUnit;
  /** Summed effective output per minute across every machine making this item. */
  effectivePerMinute: number;
  /** How many machines contribute to this item. */
  machineCount: number;
  /** Breakdown by recipe / extractor, largest first. */
  sources: ProductionSource[];
}

export interface ProductionView {
  producerCount: number;
  extractorCount: number;
  /** Estimated total power draw of all production lines, MW (an estimate). */
  estimatedPowerMW: number;
  /** Theoretical output per item, largest effective rate first. */
  items: ProductionItem[];
  /** Individual machines — present only when filtered by `item`, capped. */
  machines?: MachineDetail[];
  /** True when the machine listing was capped at {@link MAX_MACHINE_DETAIL}. */
  machinesTruncated?: boolean;
  note: string;
}

function round(n: number, dp = 3): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Estimated MW draw at the line's clock + boost (undefined for generators/unknown). */
function estimatePower(
  building: Building | undefined,
  recipe: Recipe | undefined,
  clock: number,
  boost: number,
): number | undefined {
  if (building === undefined) {
    return undefined;
  }
  let base = building.powerConsumption;
  if (!(base > 0)) {
    if (recipe?.variablePower !== undefined) {
      base = (recipe.variablePower.min + recipe.variablePower.max) / 2;
    } else if (building.maxPowerConsumption !== undefined) {
      base = building.maxPowerConsumption;
    } else {
      return undefined;
    }
  }
  const factor = clock ** OVERCLOCK_POWER_EXPONENT * (boost > 1 ? boost * boost : 1);
  return round(base * factor, 1);
}

/** Build one manufacturer's theoretical line from its config + the recipe/building data. */
function manufacturerLine(line: ProducerLine, game: GameDataIndex): MachineLine {
  const recipe = line.recipeClass === undefined ? undefined : game.recipes[line.recipeClass];
  const building = game.buildings[line.buildingClass];
  const scale = line.clockSpeed * line.productionBoost;
  const outputs: RateFlow[] =
    recipe?.products.map((p) => ({
      itemClass: p.itemClassName,
      name: game.displayNames.get(p.itemClassName) ?? humaniseClassName(p.itemClassName),
      basePerMinute: round(p.perMinute),
      effectivePerMinute: round(p.perMinute * scale),
      unit: p.unit,
    })) ?? [];
  return {
    kind: 'manufacturer',
    buildingClass: line.buildingClass,
    building: game.displayNames.get(line.buildingClass) ?? humaniseClassName(line.buildingClass),
    recipeClass: line.recipeClass,
    recipe:
      line.recipeClass === undefined
        ? undefined
        : (recipe?.displayName ?? humaniseClassName(line.recipeClass)),
    clock: line.clockSpeed,
    boost: line.productionBoost,
    location: line.location === undefined ? undefined : vecToMetres(line.location),
    outputs,
    powerMW: estimatePower(building, recipe, line.clockSpeed, line.productionBoost),
  };
}

/**
 * Resolve what an extractor produces and its purity multiplier. Water extractors
 * draw Water from a volume (no node, no purity); everything else snaps onto a
 * resource node, so we read the resource + purity from the node it sits on.
 */
function resolveExtraction(
  line: ExtractorLine,
  world: WorldLocations,
): { resourceClass?: string; purity?: Purity | 'unknown'; purityMul: number } {
  if (WATER_EXTRACTOR.test(line.buildingClass)) {
    return { resourceClass: WATER_ITEM_CLASS, purityMul: 1 };
  }
  const node =
    line.location === undefined ? undefined : nearestNode(world.resourceNodes, line.location);
  if (node?.resourceClass == null) {
    return { resourceClass: undefined, purity: 'unknown', purityMul: 1 };
  }
  return {
    resourceClass: node.resourceClass,
    purity: node.purity ?? 'unknown',
    purityMul: node.purity == null ? 1 : PURITY_MULTIPLIER[node.purity],
  };
}

/** Build one extractor's theoretical line, resolving resource + purity from its node. */
function extractorLine(
  line: ExtractorLine,
  game: GameDataIndex,
  world: WorldLocations,
): MachineLine {
  const building = game.buildings[line.buildingClass];
  const { resourceClass, purity, purityMul } = resolveExtraction(line, world);
  const outputs: RateFlow[] = [];
  if (building?.extractionRatePerMin !== undefined && resourceClass !== undefined) {
    const base = building.extractionRatePerMin * purityMul;
    outputs.push({
      itemClass: resourceClass,
      name: game.displayNames.get(resourceClass) ?? humaniseClassName(resourceClass),
      basePerMinute: round(base),
      effectivePerMinute: round(base * line.clockSpeed * line.productionBoost),
      unit: extractorUnit(resourceClass),
    });
  }
  return {
    kind: 'extractor',
    buildingClass: line.buildingClass,
    building: game.displayNames.get(line.buildingClass) ?? humaniseClassName(line.buildingClass),
    resourceClass,
    resource:
      resourceClass === undefined
        ? undefined
        : (game.displayNames.get(resourceClass) ?? humaniseClassName(resourceClass)),
    purity,
    clock: line.clockSpeed,
    boost: line.productionBoost,
    location: line.location === undefined ? undefined : vecToMetres(line.location),
    outputs,
    powerMW: estimatePower(building, undefined, line.clockSpeed, line.productionBoost),
  };
}

function extractorUnit(resourceClass: string): IngredientUnit {
  // Fluids (water/oil/etc.) are reported in m³. We don't have the item form to hand
  // here, so infer from the well-known fluid resource classes.
  return /Water|LiquidOil|NitrogenGas|NitricAcid|HeavyOilResidue/i.test(resourceClass)
    ? 'm³'
    : 'items';
}

/** The nearest resource node to a centimetre position, within {@link NODE_MATCH_CM}. */
function nearestNode(nodes: ResourceNode[], locCm: Vec3): ResourceNode | undefined {
  let best: ResourceNode | undefined;
  let bestDistance = Infinity;
  for (const node of nodes) {
    const d = Math.hypot(node.x - locCm.x, node.y - locCm.y, node.z - locCm.z);
    if (d < bestDistance) {
      bestDistance = d;
      best = node;
    }
  }
  return bestDistance <= NODE_MATCH_CM ? best : undefined;
}

/** A machine's source label for the per-item breakdown (recipe, or extractor + purity). */
function sourceLabel(line: MachineLine): string {
  if (line.kind === 'manufacturer') {
    return line.recipe ?? '(unconfigured)';
  }
  return line.purity !== undefined && line.purity !== 'unknown'
    ? `${line.building} (${line.purity})`
    : line.building;
}

function toDetail(line: MachineLine): MachineDetail {
  return {
    building: line.building,
    recipe: line.recipe,
    resource: line.resource,
    purity: line.purity,
    clockPercent: round(line.clock * 100, 1),
    productionBoost: line.boost,
    location: line.location,
    outputs: line.outputs,
    estimatedPowerMW: line.powerMW,
  };
}

/**
 * Theoretical production capacity, aggregated by output item. Manufacturers are
 * joined to their recipe and extractors to the resource node they sit on; each
 * machine's effective output (rate × clock × boost × purity) is summed per item.
 * When `item` is given, the result is narrowed to lines producing that item (name
 * or class) and the individual machines are listed too (capped). See
 * {@link PRODUCTION_NOTE} for what this does and does not represent.
 */
export function productionView(
  state: SaveState,
  game: GameDataIndex,
  world: WorldLocations,
  options: { item?: string } = {},
): ProductionView {
  const lines: MachineLine[] = [
    ...state.production.producers.map((p) => manufacturerLine(p, game)),
    ...state.production.extractors.map((e) => extractorLine(e, game, world)),
  ];

  const needle = options.item?.trim().toLowerCase();
  const filtered =
    needle === undefined || needle === ''
      ? lines
      : lines.filter((l) =>
          l.outputs.some(
            (o) =>
              o.name.toLowerCase().includes(needle) || o.itemClass.toLowerCase().includes(needle),
          ),
        );

  // Aggregate effective output per item, with a per-source (recipe/extractor) breakdown.
  const items = new Map<string, ProductionItem>();
  const sources = new Map<string, Map<string, ProductionSource>>();
  for (const line of filtered) {
    for (const out of line.outputs) {
      const item = items.get(out.itemClass) ?? {
        item: out.name,
        itemClass: out.itemClass,
        unit: out.unit,
        effectivePerMinute: 0,
        machineCount: 0,
        sources: [],
      };
      item.effectivePerMinute = round(item.effectivePerMinute + out.effectivePerMinute);
      item.machineCount += 1;
      items.set(out.itemClass, item);

      const bySource = sources.get(out.itemClass) ?? new Map<string, ProductionSource>();
      const label = sourceLabel(line);
      const src = bySource.get(label) ?? { label, machineCount: 0, effectivePerMinute: 0 };
      src.machineCount += 1;
      src.effectivePerMinute = round(src.effectivePerMinute + out.effectivePerMinute);
      bySource.set(label, src);
      sources.set(out.itemClass, bySource);
    }
  }
  const itemList = [...items.values()]
    .map((item) => ({
      ...item,
      sources: [...(sources.get(item.itemClass)?.values() ?? [])].sort(
        (a, b) => b.effectivePerMinute - a.effectivePerMinute,
      ),
    }))
    .sort((a, b) => b.effectivePerMinute - a.effectivePerMinute);

  const estimatedPowerMW = round(
    filtered.reduce((sum, l) => sum + (l.powerMW ?? 0), 0),
    1,
  );

  const view: ProductionView = {
    producerCount: state.production.producers.length,
    extractorCount: state.production.extractors.length,
    estimatedPowerMW,
    items: itemList,
    note: PRODUCTION_NOTE,
  };

  // Only enumerate individual machines when the caller has narrowed by item — an
  // unfiltered factory can be hundreds of machines (the aggregate is the answer).
  if (needle !== undefined && needle !== '') {
    view.machines = filtered.slice(0, MAX_MACHINE_DETAIL).map(toDetail);
    if (filtered.length > MAX_MACHINE_DETAIL) {
      view.machinesTruncated = true;
    }
  }

  return view;
}
