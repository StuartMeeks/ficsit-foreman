import { solveFlow, type FlowEdge, type FlowNetwork, type FlowNode } from '@foreman/sf-flow';
import type { WorldLocations } from '@foreman/sf-game-data';
import type { SaveGraph } from '@foreman/sf-save-data-graph';
import type { SaveState } from '@foreman/sf-save-data';
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
  '(throughput-capped) and splitters/mergers to every machine input, then flags a producer ' +
  'starved when an input is delivered below its required rate (beyond tolerance). v1 models ' +
  'smart-splitter outputs as plain demand-weighted splits and does not yet apply fluid head ' +
  'lift or recipe/power modifiers (#172) — so verdicts are exact on vanilla, belt-fed solid ' +
  'lines and conservative elsewhere (ambiguous flow → unknown, never a false starved).';

const capOf = (graph: SaveGraph, eff: EffectiveGameData, id: string): number => {
  const node = graph.getActor(id);
  if (node === undefined) {
    return Infinity;
  }
  return Math.min(eff.conveyorCapacity(node.classKey), eff.pipeCapacity(node.classKey));
};

/** Maps the save graph + effective game data onto the abstract flow network the solver reconciles. */
function buildNetwork(
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

  const edges: FlowEdge[] = graph.flowEdges().map(({ from, to }) => ({
    from,
    to,
    capacity: Math.min(capOf(graph, eff, from), capOf(graph, eff, to)),
  }));

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
