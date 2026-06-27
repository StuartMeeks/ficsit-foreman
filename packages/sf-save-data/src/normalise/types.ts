/**
 * The clean, serialisable model the MCP tools answer over. Nothing downstream of
 * `normaliseSave` sees a raw `typePath`, tagged-property wrapper, or Unreal class
 * path — only these records. The model carries **raw class names only**; resolving
 * them to display names (authored game-data names, or a humanised fallback) is the
 * consumer's job at the edge (`sf-mcp`), keeping this library game-data-agnostic.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface InventoryStack {
  /** Item class name, e.g. `Desc_IronPlate_C`. */
  itemClass: string;
  quantity: number;
}

export type Inventory = InventoryStack[];

export interface PlayerState {
  location?: Vec3;
  hubLocation?: Vec3;
  inventory: Inventory;
}

export interface StorageContainer {
  /** Stable per-save actor instance name — the join key to `topology` and the graph. */
  instanceName: string;
  buildingClass: string;
  location?: Vec3;
  inventory: Inventory;
}

export interface UnlockedRecipe {
  recipeClass: string;
  isAlternate: boolean;
}

export type MilestoneKind = 'milestone' | 'tutorial' | 'other';

export interface Milestone {
  schematicClass: string;
  /** Milestone tier (1–9) where derivable from the class name. */
  tier?: number;
  kind: MilestoneKind;
}

export interface AssemblyPhase {
  /** Current Project Assembly / Space Elevator phase number, if derivable. */
  phase?: number;
  current?: string;
  target?: string;
}

/**
 * A recipe-running factory machine, as read from the save (no game-data join yet).
 * This is the machine's *configuration* — recipe, clock and somersloop boost — from
 * which the query layer derives theoretical throughput and estimated power. What the
 * machine is actually fed/producing (belts, pipes, power) is out of scope here — see
 * the actual-production graph issue.
 */
export interface ProducerLine {
  /** Stable per-save actor instance name — the join key to `topology` and the graph. */
  instanceName: string;
  /** Building class, e.g. `Build_ConstructorMk1_C`. */
  buildingClass: string;
  /** Recipe class the machine is set to, e.g. `Recipe_IronPlate_C`. Undefined = unconfigured. */
  recipeClass?: string;
  /** Clock speed as a fraction (1 = 100%); defaults to 1 when the save omits it. */
  clockSpeed: number;
  /** Somersloop output multiplier (1 = none); defaults to 1 when omitted. */
  productionBoost: number;
  location?: Vec3;
}

/** A resource extractor (miner / pump / fracking). Output is the node's resource. */
export interface ExtractorLine {
  /** Stable per-save actor instance name — the join key to `topology` and the graph. */
  instanceName: string;
  buildingClass: string;
  clockSpeed: number;
  productionBoost: number;
  location?: Vec3;
}

/**
 * A power generator (biomass / coal / fuel / nuclear / geothermal), as read from the
 * save. It burns fuel rather than running a recipe (no somersloop), so this captures
 * only its configuration; MW output is a game-data join (`powerProduction × clock`,
 * linear in clock) made at the query layer. Geothermal has no `fuelClass` and a
 * variable, purity-dependent output.
 */
export interface GeneratorLine {
  /** Stable per-save actor instance name — the join key to `topology` and the graph. */
  instanceName: string;
  /** Building class, e.g. `Build_GeneratorFuel_C`. */
  buildingClass: string;
  /** Clock speed as a fraction (1 = 100%); defaults to 1 when the save omits it. */
  clockSpeed: number;
  /** Item class currently being burned, e.g. `Desc_Coal_C`. Undefined for geothermal / unfuelled. */
  fuelClass?: string;
  location?: Vec3;
}

export interface ProductionState {
  producers: ProducerLine[];
  extractors: ExtractorLine[];
  generators: GeneratorLine[];
}

/**
 * A buildable actor (machine, belt, splitter, pipe, power pole, …) as a graph node.
 * This is the **complete** node set — every `Build_*` actor, including the
 * intermediate belts/splitters/poles that carry no domain record — so the
 * connection graph stays traversable end-to-end. Raw class-name keys only.
 */
export interface BuildableActor {
  /** Unique per-save instance name. */
  instanceName: string;
  /** Raw class-name key (the type-path tail), e.g. `Build_ConstructorMk1_C`. */
  classKey: string;
  /** World position in centimetres, if the actor carries a transform. */
  location?: Vec3;
}

/** The kinds of physical link recorded in the topology. Power is grouped separately (see `PowerCircuit`). */
export type EdgeKind = 'conveyor' | 'pipe';

/**
 * One physical connection between two actors, resolved from the connection
 * components that declare it. The link is **undirected** as stored — `from`/`to`
 * are canonically ordered (by component path), not a flow direction. The
 * connector-name tails (`Output0`/`Input0`/`ConveyorAny0`) are retained so
 * consumers can infer flow direction; belt connectors are deliberately ambiguous
 * in the save.
 */
export interface ConnectionEdge {
  kind: EdgeKind;
  /** Owner actor instance name of one endpoint (canonically the smaller component path). */
  from: string;
  /** Owner actor instance name of the other endpoint. */
  to: string;
  /** The `from` connection component's name tail (e.g. `Output0`). */
  fromConnector: string;
  /** The `to` connection component's name tail. */
  toConnector: string;
  /** Pipe network id (`mPipeNetworkID`); present on pipe edges only. */
  networkId?: number;
}

/**
 * A power circuit, pre-grouped by the game (`FGPowerCircuit.mCircuitID` +
 * `mComponents`). Members are the actor instance names whose power connections
 * belong to the circuit — no traversal needed.
 */
export interface PowerCircuit {
  circuitId: number;
  members: string[];
}

/**
 * The factory's connectivity, exactly as the save stores it: the complete set of
 * buildable actors (nodes), the conveyor/pipe links between them (edges), and the
 * pre-grouped power circuits. This is the relational fact layer; the in-memory
 * adjacency/BFS index over it lives in `@foreman/sf-save-data-graph`, which is a
 * pure projection of this data.
 */
export interface TopologyState {
  buildables: BuildableActor[];
  edges: ConnectionEdge[];
  powerCircuits: PowerCircuit[];
}

export interface SaveState {
  /** Detected game version (build number, with save version), or 'unknown'. */
  version: string;
  /** Save session name, or the file base name. */
  saveName: string;
  /** Raw in-game session name from the header (undefined if absent). */
  sessionName?: string;
  /** Map name from the header, e.g. `Persistent_Level` (undefined if absent). */
  mapName?: string;
  /** Satisfactory changelist/build number from the header — comparable to game data's `build`. */
  buildVersion?: number;
  /** Save-format version from the header. */
  saveVersion?: number;
  /** Total in-game play time in seconds, if the header carries it. */
  playDurationSeconds?: number;
  /** ISO timestamp of when this state was parsed. */
  parsedAt: string;
  player: PlayerState;
  storage: {
    containers: StorageContainer[];
    dimensionalDepot: Inventory;
  };
  recipes: UnlockedRecipe[];
  /** Active factory machines (recipe-runners) and resource extractors. */
  production: ProductionState;
  milestones: Milestone[];
  /**
   * The factory's connectivity — every buildable actor, the conveyor/pipe links
   * between them, and the pre-grouped power circuits. The relational substrate the
   * connection graph projects (`@foreman/sf-save-data-graph`).
   */
  topology: TopologyState;
  /** Unlocked MAM research-tree class names (e.g. `BPD_ResearchTree_AlienOrganisms_C`). */
  mamResearch: string[];
  assemblyPhase?: AssemblyPhase;
  /**
   * GUIDs of collected collectibles (spheres/sloops/slugs), from
   * `FGScannableSubsystem.mDestroyedPickups` — matched against the world-locations
   * dataset for exact per-kind collected counts. See `collectibleProgressView`.
   */
  collectedPickupGuids: string[];
  /** GUIDs of looted hard-drive drop pods (`FGScannableSubsystem.mLootedDropPods`). */
  lootedDropPodGuids: string[];
  /**
   * Instance names of collected loose crash-site parts (`FGItemPickup_Spawnable`), taken
   * from each sublevel's `collectables` (collected/removed-actor) record. These are NOT in
   * `mDestroyedPickups` (that tracks collectibles only); they are matched against the
   * world-locations `lootPickups[].id` to drop already-grabbed parts. Map-wide and complete.
   */
  collectedLootIds: string[];
  /** Non-fatal issues collected during normalisation. */
  warnings: string[];
}

/** A valid empty state for when no save is loaded (or a parse failed). */
export function emptySaveState(version: string, saveName: string, parsedAt: string): SaveState {
  return {
    version,
    saveName,
    parsedAt,
    player: { inventory: [] },
    storage: { containers: [], dimensionalDepot: [] },
    recipes: [],
    production: { producers: [], extractors: [], generators: [] },
    milestones: [],
    topology: { buildables: [], edges: [], powerCircuits: [] },
    mamResearch: [],
    collectedPickupGuids: [],
    lootedDropPodGuids: [],
    collectedLootIds: [],
    warnings: [],
  };
}
