/**
 * The save-game connection graph model — the game-data-agnostic substrate every
 * *relational* save question is answered over (power #68, production feed-tracing
 * #126, logistics, map adjacency). It records the factory's connectivity exactly
 * as the save stores it: actors are nodes, and the belts/pipes/power links between
 * them are typed edges. Like `@foreman/sf-save-data` it carries **raw class-name
 * keys only** (`Build_*`); joining to recipes/buildings is the consumer's job at the
 * edge (`sf-mcp`). See `docs/component-architecture.md`.
 */
import type { Vec3 } from '@foreman/sf-save-data';

/** A building actor (machine, belt, splitter, pipe, power pole, …). */
export interface ActorNode {
  /** Unique per-save instance name, e.g. `Persistent_Level:PersistentLevel.Build_MinerMk1_C_2147415623`. */
  instanceName: string;
  /** Raw class-name key (the type-path tail), e.g. `Build_ConstructorMk1_C`. */
  classKey: string;
  /** World position in centimetres, if the actor carries a transform. */
  location?: Vec3;
}

/** The kinds of physical link the foundation models. Power is grouped separately (see `PowerCircuit`). */
export type EdgeKind = 'conveyor' | 'pipe';

/**
 * One physical connection between two actors, resolved from the connection
 * components that declare it. The link is **undirected** as stored — `from`/`to`
 * are canonically ordered, not a flow direction. The connector-name tails
 * (`Output0`/`Input0`/`ConveyorAny0`) are retained so consumers (#126) can infer
 * flow direction; belt connectors are deliberately ambiguous in the save.
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

/** Counts for diagnostics and tests. */
export interface SaveGraphStats {
  actors: number;
  conveyorEdges: number;
  pipeEdges: number;
  powerCircuits: number;
  powerCircuitMembers: number;
}

/** Options for `SaveGraph.traverse`. */
export interface TraverseOptions {
  /** Restrict to one edge kind; omit to traverse all kinds. */
  kind?: EdgeKind;
  /** Maximum hops from the start (inclusive); omit for unbounded. */
  maxDepth?: number;
}
