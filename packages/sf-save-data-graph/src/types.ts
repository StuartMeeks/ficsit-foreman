/**
 * The save-game connection graph model — the game-data-agnostic substrate every
 * *relational* save question is answered over (power #68, production feed-tracing
 * #126, logistics, map adjacency). It records the factory's connectivity exactly
 * as the save stores it: actors are nodes, and the belts/pipes/power links between
 * them are typed edges. Like `@foreman/sf-save-data` it carries **raw class-name
 * keys only** (`Build_*`); joining to recipes/buildings is the consumer's job at the
 * edge (`sf-mcp`). See `docs/component-architecture.md`.
 */
import type {
  ExtractorLine,
  GeneratorLine,
  ProducerLine,
  SplitterConfig,
  StorageContainer,
  Vec3,
} from '@foreman/sf-save-data';

// The relational fact types now live in `@foreman/sf-save-data` (they are part of
// `SaveState.topology`); the graph is a pure projection of them. Re-exported here so
// the graph package's public surface is unchanged for existing consumers.
export type {
  ConnectionEdge,
  EdgeKind,
  PowerCircuit,
  SplitterConfig,
  SplitterRule,
  SplitterRuleKind,
} from '@foreman/sf-save-data';

import type { EdgeKind } from '@foreman/sf-save-data';

/**
 * The domain role of an actor, derived by joining the topology's node set to the
 * typed `SaveState` lists. `building` is a plain `Build_*` actor with no domain
 * record (belts, splitters, poles, …). Leaves room for `player`/`pickup` later.
 */
export type ActorKind = 'storage' | 'producer' | 'extractor' | 'generator' | 'building';

/** A building actor (machine, belt, splitter, pipe, power pole, …). */
export interface ActorNode {
  /** Unique per-save instance name, e.g. `Persistent_Level:PersistentLevel.Build_MinerMk1_C_2147415623`. */
  instanceName: string;
  /** Raw class-name key (the type-path tail), e.g. `Build_ConstructorMk1_C`. */
  classKey: string;
  /** World position in centimetres, if the actor carries a transform. */
  location?: Vec3;
  /** Domain role, joined from the typed `SaveState` lists. */
  kind: ActorKind;
  /** The storage record for this actor, when `kind === 'storage'`. */
  storage?: StorageContainer;
  /** The producer (recipe-runner) record, when `kind === 'producer'`. */
  producer?: ProducerLine;
  /** The extractor record, when `kind === 'extractor'`. */
  extractor?: ExtractorLine;
  /** The generator record, when `kind === 'generator'`. */
  generator?: GeneratorLine;
  /**
   * Conditional output-routing rules, present on smart/programmable splitters only
   * (`kind` stays `building`). Drives feed-tracing: a filtered branch is not an even
   * split. Read via `SaveGraph.splitterRulesOf`.
   */
  splitter?: SplitterConfig;
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
