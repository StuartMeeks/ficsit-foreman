import { solveFlow, type FlowEdge, type FlowNetwork, type FlowNode } from '@foreman/sf-flow';
import type { WorldLocations } from '@foreman/sf-game-data';
import type { SaveGraph } from '@foreman/sf-save-data-graph';
import type { SaveState, SplitterRule } from '@foreman/sf-save-data';
import { cmToMetres, humaniseClassName } from '@foreman/sf-present';

import type { GameDataIndex } from '../gameData.js';
import { getEffectiveGameData, type EffectiveGameData } from './effectiveGameData.js';
import { powerView, resolveExtraction } from './selectors.js';

export type BottleneckVerdict = 'starved' | 'unpowered' | 'idle' | 'unknown';

export interface BottleneckEntry {
  instanceName: string;
  building: string;
  recipe?: string;
  location?: { x: number; y: number; z: number };
  verdict: BottleneckVerdict;
  /** A one-line, model-facing cause (e.g. "starved of Iron Ore: only 15/30 per min"). */
  detail: string;
}

export interface BottlenecksView {
  /** The tolerance band applied (a deficit within ±tolerance is treated as ok). */
  tolerance: number;
  producerCount: number;
  /** Counts by verdict, including the implicit `ok`. */
  summary: Record<BottleneckVerdict | 'ok', number>;
  /** The non-ok producers (capped at `limit`); each carries its verdict + cause. */
  bottlenecks: BottleneckEntry[];
  /** Set when the list was capped. */
  truncated?: number;
  note: string;
}

const NOTE =
  'Steady-state feed reconciliation: distributes each source’s output through belts/pipes ' +
  '(throughput-capped) and splitters/mergers to every machine input — honouring smart/' +
  'programmable splitter sort-rules (item filters, any, overflow, any-undefined) — then flags ' +
  'a producer starved when an input is delivered below its required rate (beyond tolerance). ' +
  'Fluid legs that rise above their pipe network’s shared head lift are cut. Does not yet apply ' +
  '1.2 recipe/power modifiers (#172). Ambiguous flow (looping/unresolved belts) → unknown, never ' +
  'a false starved.';

/**
 * Maximum head lift (metres — the height at which flow hits zero) per fluid building, used as
 * the conservative reachable-height bound so the gate only ever blocks the genuinely-unreachable.
 * Values from the Satisfactory wiki's head-lift table. Any other fluid-producing building (not
 * listed) falls back to 13 m (the common extractor/refinery figure) via {@link EffectiveGameData.isFluid}.
 */
const HEAD_LIFT_MAX_METRES: Record<string, number> = {
  Build_PipelinePump_C: 23,
  Build_PipelinePumpMk2_C: 57,
  Build_WaterPump_C: 13,
  Build_OilPump_C: 13,
  Build_FrackingExtractor_C: 13,
  Build_OilRefinery_C: 13,
  Build_Packager_C: 13,
  Build_Blender_C: 13,
  Build_PipeStorageTank_C: 8, // Fluid Buffer (a filled buffer shares head lift even at zero flow)
  Build_IndustrialTank_C: 12, // Industrial Fluid Buffer
  Build_TrainDockingStationLiquid_C: 13, // Fluid Freight Platform
};
const FLUID_PRODUCER_DEFAULT_HEAD_LIFT = 13;

const capOf = (graph: SaveGraph, eff: EffectiveGameData, id: string): number => {
  const node = graph.getActor(id);
  if (node === undefined) {
    return Infinity;
  }
  return Math.min(eff.conveyorCapacity(node.classKey), eff.pipeCapacity(node.classKey));
};

/**
 * The flow-edge filter for one smart/programmable splitter output, from its `mSortRules`.
 * Rules for the same output combine: `any` (Wildcard) → unrestricted; `anyUndefined` →
 * unrestricted minus the items an item-rule routes to a *sibling* output (a `deny` list);
 * `item` rules → an `allow` list; `none` → carries nothing; `overflow` → an overflow output.
 */
function outputFilter(
  rules: SplitterRule[],
  outputIndex: number,
): { allow?: string[]; deny?: string[]; overflow?: boolean } {
  const own = rules.filter((r) => r.outputIndex === outputIndex);
  if (own.length === 0) {
    return {}; // no rule configured for this output — carries anything
  }
  const overflow = own.some((r) => r.rule === 'overflow') ? { overflow: true } : {};
  const items = own.flatMap((r) =>
    r.rule === 'item' && r.itemClass !== undefined ? [r.itemClass] : [],
  );
  if (own.some((r) => r.rule === 'any')) {
    return { ...overflow };
  }
  if (own.some((r) => r.rule === 'anyUndefined')) {
    const deny = rules
      .filter(
        (r) => r.outputIndex !== outputIndex && r.rule === 'item' && r.itemClass !== undefined,
      )
      .map((r) => r.itemClass as string)
      .filter((it) => !items.includes(it));
    return { ...(deny.length > 0 ? { deny: [...new Set(deny)] } : {}), ...overflow };
  }
  if (items.length > 0) {
    return { allow: [...new Set(items)], ...overflow };
  }
  if ('overflow' in overflow) {
    return overflow; // overflow-only output: any item, but only as spillover
  }
  return { allow: [] }; // `none`
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Tolerance (metres) for height comparisons — absorbs cm→m noise without missing real lift gaps. */
const HEAD_LIFT_EPS = 1;

/**
 * Head-lift gate. In Satisfactory the **highest head lift among the fluid sources/pumps connected
 * to a pipe network is shared across that entire (undirected) network** — so a connected
 * component can lift fluid to `max(elevation + maxHeadLift)` over its head-lift providers. Pipe
 * flow direction is unreliable to infer anyway, so this works on the undirected pipe graph: it
 * computes that shared reachable height per connected component and **zeroes the capacity** of any
 * pipe edge whose higher endpoint sits above it. Using each building's *maximum* head lift (the
 * height at which flow truly stops) makes the bound an upper bound on reachable height — it only
 * ever blocks the genuinely-unreachable, never a false starve. Components with no head-lift
 * provider, and position-less nodes, are left untouched. Mutates `edges` in place.
 */
function applyHeadLiftGate(
  state: SaveState,
  graph: SaveGraph,
  eff: EffectiveGameData,
  nodes: FlowNode[],
  edges: FlowEdge[],
): void {
  const pipeTopoEdges = state.topology.edges.filter((e) => e.kind === 'pipe' && e.from !== e.to);
  if (pipeTopoEdges.length === 0) {
    return;
  }

  // Union-find over the undirected pipe network (head lift is shared across the whole component).
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while ((parent.get(root) ?? root) !== root) {
      root = parent.get(root) as string;
    }
    let cur = x;
    while (cur !== root) {
      const next = parent.get(cur) ?? cur;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    if (!parent.has(a)) {
      parent.set(a, a);
    }
    if (!parent.has(b)) {
      parent.set(b, b);
    }
    parent.set(find(a), find(b));
  };
  for (const edge of pipeTopoEdges) {
    union(edge.from, edge.to);
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const heightOf = (id: string): number | undefined => {
    const loc = graph.getActor(id)?.location;
    return loc === undefined ? undefined : cmToMetres(loc.z);
  };
  // A node's head lift (metres), or undefined if it provides none. Tabled fluid buildings use
  // their exact maximum; any other fluid-producing node gets the common default.
  const headLiftOf = (id: string): number | undefined => {
    const classKey = graph.getActor(id)?.classKey;
    if (classKey === undefined) {
      return undefined;
    }
    const tabled = HEAD_LIFT_MAX_METRES[classKey];
    if (tabled !== undefined) {
      return tabled;
    }
    const supply = nodeById.get(id)?.supply;
    const producesFluid = supply !== undefined && Object.keys(supply).some((it) => eff.isFluid(it));
    return producesFluid ? FLUID_PRODUCER_DEFAULT_HEAD_LIFT : undefined;
  };

  // Per-component max reachable height = max over providers of (elevation + max head lift).
  const maxHead = new Map<string, number>();
  for (const id of parent.keys()) {
    const lift = headLiftOf(id);
    const z = heightOf(id);
    if (lift === undefined || z === undefined) {
      continue;
    }
    const root = find(id);
    maxHead.set(root, Math.max(maxHead.get(root) ?? -Infinity, z + lift));
  }

  const pipePairs = new Set(pipeTopoEdges.map((e) => pairKey(e.from, e.to)));
  for (const edge of edges) {
    if (!pipePairs.has(pairKey(edge.from, edge.to)) || !parent.has(edge.from)) {
      continue;
    }
    const head = maxHead.get(find(edge.from));
    if (head === undefined) {
      continue; // component has no head-lift provider — don't constrain
    }
    const zFrom = heightOf(edge.from);
    const zTo = heightOf(edge.to);
    if (zFrom === undefined || zTo === undefined) {
      continue;
    }
    if (Math.max(zFrom, zTo) > head + HEAD_LIFT_EPS) {
      edge.capacity = 0; // the higher end is above any reachable fluid height in this network
    }
  }
}

/** Maps the save graph + effective game data onto the abstract flow network the solver reconciles. */
export function buildNetwork(
  state: SaveState,
  graph: SaveGraph,
  eff: EffectiveGameData,
  world: WorldLocations,
): FlowNetwork {
  const nodes: FlowNode[] = [];
  for (const buildable of state.topology.buildables) {
    const node = graph.getActor(buildable.instanceName);
    if (node?.producer !== undefined) {
      nodes.push({
        id: node.instanceName,
        demand: eff.requiredInputs(node.producer),
        supply: eff.producerOutputs(node.producer),
      });
    } else if (node?.extractor !== undefined) {
      const { resourceClass, purityMul } = resolveExtraction(node.extractor, world);
      const rate = eff.raw.buildings[node.extractor.buildingClass]?.extractionRatePerMin;
      const supply =
        resourceClass !== undefined && rate !== undefined
          ? {
              [resourceClass]:
                rate * purityMul * node.extractor.clockSpeed * node.extractor.productionBoost,
            }
          : undefined;
      nodes.push(
        supply === undefined
          ? { id: buildable.instanceName }
          : { id: buildable.instanceName, supply },
      );
    } else {
      // Belts, splitters, mergers, storage, poles: pass-through carriers.
      nodes.push({ id: buildable.instanceName });
    }
  }

  // Map each smart/programmable splitter's output edge to its rule outputIndex. The
  // splitter-side connector is `OutputN`; verified mapping is `outputIndex = N − 1`
  // (Output1/2/3 ↔ idx 0/1/2). Single pass over the topology edges.
  const splitterIds = new Set(state.topology.splitters.map((s) => s.instanceName));
  const outputIndexFor = new Map<string, Map<string, number>>();
  for (const edge of state.topology.edges) {
    for (const [owner, connector, other] of [
      [edge.from, edge.fromConnector, edge.to],
      [edge.to, edge.toConnector, edge.from],
    ] as const) {
      if (!splitterIds.has(owner)) {
        continue;
      }
      const match = /^Output(\d+)$/.exec(connector);
      if (match === null) {
        continue;
      }
      let byNeighbour = outputIndexFor.get(owner);
      if (byNeighbour === undefined) {
        byNeighbour = new Map();
        outputIndexFor.set(owner, byNeighbour);
      }
      byNeighbour.set(other, Number(match[1]) - 1);
    }
  }

  const edges: FlowEdge[] = graph.flowEdges().map(({ from, to }) => {
    const edge: FlowEdge = {
      from,
      to,
      capacity: Math.min(capOf(graph, eff, from), capOf(graph, eff, to)),
    };
    // A smart/programmable splitter output carries only what its sort-rules allow.
    const rules = graph.getActor(from)?.splitter?.rules;
    const outputIndex = outputIndexFor.get(from)?.get(to);
    if (rules !== undefined && outputIndex !== undefined) {
      return { ...edge, ...outputFilter(rules, outputIndex) };
    }
    return edge;
  });

  // Zero the capacity of any fluid leg that rises above its pipe network's shared head lift.
  applyHeadLiftGate(state, graph, eff, nodes, edges);

  return { nodes, edges };
}

const round = (n: number): number => Math.round(n * 10) / 10;

/**
 * `find_bottlenecks` — reconciles the save's material flow and reports each producer that is
 * starved (an input under-fed beyond tolerance), unpowered (on an overloaded circuit with no
 * battery buffer), idle (no recipe) or unknown (flow direction unresolved). Compact and
 * aggregated: a summary plus the non-ok producers with the upstream cause — never a graph dump.
 */
export function bottlenecksView(
  state: SaveState,
  graph: SaveGraph,
  game: GameDataIndex,
  world: WorldLocations,
  options: { tolerance?: number; limit?: number } = {},
): BottlenecksView {
  const tolerance = options.tolerance ?? 0.05;
  const limit = options.limit ?? 50;
  const eff = getEffectiveGameData(state, game);
  const result = solveFlow(buildNetwork(state, graph, eff, world));
  const cyclic = new Set(result.cyclic);

  // Per-circuit power status, for the unpowered verdict.
  const power = powerView(state, graph, game);
  const circuitById = new Map(power.circuits.map((c) => [c.circuitId, c]));
  const name = (cls: string): string => game.displayNames.get(cls) ?? humaniseClassName(cls);

  const summary: Record<BottleneckVerdict | 'ok', number> = {
    ok: 0,
    starved: 0,
    unpowered: 0,
    idle: 0,
    unknown: 0,
  };
  const bottlenecks: BottleneckEntry[] = [];
  let producerCount = 0;

  for (const node of graph.actorsByKind('producer')) {
    producerCount += 1;
    const producer = node.producer;
    if (producer === undefined) {
      continue;
    }
    const base = (verdict: BottleneckVerdict, detail: string): BottleneckEntry => ({
      instanceName: node.instanceName,
      building: name(producer.buildingClass),
      ...(producer.recipeClass === undefined ? {} : { recipe: name(producer.recipeClass) }),
      ...(node.location === undefined
        ? {}
        : {
            location: {
              x: cmToMetres(node.location.x),
              y: cmToMetres(node.location.y),
              z: cmToMetres(node.location.z),
            },
          }),
      verdict,
      detail,
    });

    if (producer.recipeClass === undefined) {
      summary.idle += 1;
      bottlenecks.push(base('idle', 'no recipe set — not producing'));
      continue;
    }

    // Unpowered: the producer's circuit is overloaded and has no battery charge to ride it out.
    const circuit = circuitById.get(graph.powerCircuitOf(node.instanceName)?.circuitId ?? NaN);
    if (circuit?.status === 'overloaded' && circuit.batteryChargeMWh <= 0) {
      summary.unpowered += 1;
      bottlenecks.push(
        base('unpowered', `on overloaded circuit ${circuit.circuitId} (no battery buffer)`),
      );
      continue;
    }

    const required = eff.requiredInputs(producer);
    const delivered = result.delivered[node.instanceName] ?? {};
    const starved = Object.entries(required).filter(
      ([item, need]) => need > 0 && (delivered[item] ?? 0) < need * (1 - tolerance),
    );

    if (starved.length === 0) {
      summary.ok += 1;
      continue;
    }

    // Under-fed, but if the feed direction couldn't be resolved we cannot be sure — say unknown.
    const reach = graph.upstreamOf(node.instanceName);
    if (cyclic.has(node.instanceName) || !reach.complete) {
      summary.unknown += 1;
      bottlenecks.push(
        base(
          'unknown',
          'flow direction unresolved (looping or ambiguous belts) — cannot confirm feed',
        ),
      );
      continue;
    }

    // Report the hungriest input as the cause.
    starved.sort((a, b) => (delivered[a[0]] ?? 0) / a[1] - (delivered[b[0]] ?? 0) / b[1]);
    const [item, need] = starved[0] as [string, number];
    const got = delivered[item] ?? 0;
    const cause =
      got <= 0
        ? `no ${name(item)} reaching it`
        : `only ${round(got)}/${round(need)} ${name(item)} per min (shared supply or belt limit)`;
    summary.starved += 1;
    bottlenecks.push(base('starved', `starved of ${name(item)}: ${cause}`));
  }

  // Most-broken first; cap for tokens.
  const order: Record<BottleneckVerdict, number> = {
    unpowered: 0,
    starved: 1,
    idle: 2,
    unknown: 3,
  };
  bottlenecks.sort((a, b) => order[a.verdict] - order[b.verdict]);
  const capped = bottlenecks.slice(0, limit);

  return {
    tolerance,
    producerCount,
    summary,
    bottlenecks: capped,
    ...(capped.length < bottlenecks.length
      ? { truncated: bottlenecks.length - capped.length }
      : {}),
    note: NOTE,
  };
}
