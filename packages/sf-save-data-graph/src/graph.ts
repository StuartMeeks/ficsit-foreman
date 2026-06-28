/**
 * The query facade over a built save-game connection graph. This is the **stable,
 * backend-swappable surface**: today it is backed by in-memory adjacency maps (a
 * mid save's ~12k connections build in ~100ms, dwarfed by the ~5s parse), but the
 * method shapes are what consumers (#68 power, #126 production) depend on — a future
 * swap to an embedded graph DB would be an implementation change, not an API one.
 *
 * Foundation-level methods only; consumers add domain queries in their own issues.
 */
import type { SaveState } from '@foreman/sf-save-data';

import type {
  ActorKind,
  ActorNode,
  ConnectionEdge,
  EdgeKind,
  PowerCircuit,
  SaveGraphStats,
  SplitterRule,
  TraverseOptions,
} from './types.js';

export class SaveGraph {
  /** Undirected adjacency: actor → its connected actors, keyed by edge kind. */
  private readonly adjacency = new Map<string, Map<EdgeKind, Set<string>>>();
  /** Actor instance name → the id of the power circuit it belongs to. */
  private readonly actorCircuit = new Map<string, number>();

  public constructor(
    private readonly actors: Map<string, ActorNode>,
    private readonly connectionEdges: ConnectionEdge[],
    private readonly circuits: PowerCircuit[],
    public readonly warnings: string[],
    private readonly savedState: SaveState,
  ) {
    for (const edge of connectionEdges) {
      this.link(edge.from, edge.to, edge.kind);
      this.link(edge.to, edge.from, edge.kind);
    }
    for (const circuit of circuits) {
      for (const member of circuit.members) {
        this.actorCircuit.set(member, circuit.circuitId);
      }
    }
  }

  private link(from: string, to: string, kind: EdgeKind): void {
    let byKind = this.adjacency.get(from);
    if (byKind === undefined) {
      byKind = new Map();
      this.adjacency.set(from, byKind);
    }
    let set = byKind.get(kind);
    if (set === undefined) {
      set = new Set();
      byKind.set(kind, set);
    }
    set.add(to);
  }

  /** The actor with this instance name, if it is a known building. */
  public getActor(instanceName: string): ActorNode | undefined {
    return this.actors.get(instanceName);
  }

  /** Every actor whose class-name key starts with `prefix` (e.g. `Build_ConveyorAttachmentSplitter`). */
  public actorsByClass(prefix: string): ActorNode[] {
    const out: ActorNode[] = [];
    for (const actor of this.actors.values()) {
      if (actor.classKey.startsWith(prefix)) {
        out.push(actor);
      }
    }
    return out;
  }

  /** Every actor with the given domain role (e.g. `producer`, `storage`). */
  public actorsByKind(kind: ActorKind): ActorNode[] {
    const out: ActorNode[] = [];
    for (const actor of this.actors.values()) {
      if (actor.kind === kind) {
        out.push(actor);
      }
    }
    return out;
  }

  /**
   * The backing `SaveState` this graph projects. Everything the save carries —
   * player, recipes, milestones, MAM research, collectibles, assembly phase, header
   * — is reachable here, so a consumer holding only the graph never needs a second
   * handle to the state. The graph adds no facts of its own; it indexes these.
   */
  public state(): SaveState {
    return this.savedState;
  }

  /** Actors directly connected to `instanceName`, optionally restricted to one edge kind. */
  public neighbours(instanceName: string, kind?: EdgeKind): ActorNode[] {
    const byKind = this.adjacency.get(instanceName);
    if (byKind === undefined) {
      return [];
    }
    const names = new Set<string>();
    for (const [edgeKind, set] of byKind) {
      if (kind !== undefined && edgeKind !== kind) {
        continue;
      }
      for (const name of set) {
        names.add(name);
      }
    }
    const out: ActorNode[] = [];
    for (const name of names) {
      const actor = this.actors.get(name);
      if (actor !== undefined) {
        out.push(actor);
      }
    }
    return out;
  }

  /** All connection edges, optionally restricted to one kind. */
  public edges(kind?: EdgeKind): ConnectionEdge[] {
    return kind === undefined
      ? [...this.connectionEdges]
      : this.connectionEdges.filter((edge) => edge.kind === kind);
  }

  /** Every power circuit (pre-grouped by the game). */
  public powerCircuits(): PowerCircuit[] {
    return [...this.circuits];
  }

  /**
   * The conditional output-routing rules of a smart/programmable splitter, or
   * `undefined` for any other actor (plain splitters, mergers, machines, …). A
   * smart splitter with no rules configured returns an empty array, not `undefined`.
   * Feed-tracing uses this to honour a filtered branch rather than assuming an even split.
   */
  public splitterRulesOf(instanceName: string): SplitterRule[] | undefined {
    return this.actors.get(instanceName)?.splitter?.rules;
  }

  /** The power circuit an actor belongs to, if any. */
  public powerCircuitOf(instanceName: string): PowerCircuit | undefined {
    const id = this.actorCircuit.get(instanceName);
    if (id === undefined) {
      return undefined;
    }
    return this.circuits.find((circuit) => circuit.circuitId === id);
  }

  /**
   * Breadth-first set of actor instance names reachable from `start` over the
   * undirected connection graph (the start itself is excluded from the result).
   * This is the primitive #126 feed-tracing builds on; direction inference and
   * belt-chain collapsing are the consumer's concern.
   */
  public traverse(start: string, options: TraverseOptions = {}): string[] {
    const { kind, maxDepth } = options;
    const visited = new Set<string>([start]);
    const result: string[] = [];
    let frontier: string[] = [start];
    let depth = 0;
    while (frontier.length > 0 && (maxDepth === undefined || depth < maxDepth)) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const neighbour of this.neighbours(node, kind)) {
          if (!visited.has(neighbour.instanceName)) {
            visited.add(neighbour.instanceName);
            result.push(neighbour.instanceName);
            next.push(neighbour.instanceName);
          }
        }
      }
      frontier = next;
      depth++;
    }
    return result;
  }

  /** Counts for diagnostics and tests. */
  public stats(): SaveGraphStats {
    let conveyorEdges = 0;
    let pipeEdges = 0;
    for (const edge of this.connectionEdges) {
      if (edge.kind === 'conveyor') {
        conveyorEdges++;
      } else {
        pipeEdges++;
      }
    }
    let powerCircuitMembers = 0;
    for (const circuit of this.circuits) {
      powerCircuitMembers += circuit.members.length;
    }
    return {
      actors: this.actors.size,
      conveyorEdges,
      pipeEdges,
      powerCircuits: this.circuits.length,
      powerCircuitMembers,
    };
  }
}
