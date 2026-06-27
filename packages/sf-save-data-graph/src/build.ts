/**
 * Projects the in-memory connection graph from a `SaveState`. The relational facts
 * — buildable actors (the complete node set), conveyor/pipe edges and pre-grouped
 * power circuits — already live in `state.topology`, produced by the `sf-save-data`
 * normaliser. This builds the adjacency/BFS index over them and holds **no facts of
 * its own**: it is a pure projection. Never throws; an empty or partial state simply
 * yields an empty graph.
 */
import type { SaveState } from '@foreman/sf-save-data';

import { SaveGraph } from './graph.js';
import type { ActorNode } from './types.js';

const EMPTY_TOPOLOGY = { buildables: [], edges: [], powerCircuits: [] } as const;

/** Projects the connection graph from a normalised save state. */
export function buildSaveGraph(state: SaveState): SaveGraph {
  const topology = state.topology ?? EMPTY_TOPOLOGY;

  const actors = new Map<string, ActorNode>();
  for (const buildable of topology.buildables) {
    actors.set(buildable.instanceName, {
      instanceName: buildable.instanceName,
      classKey: buildable.classKey,
      location: buildable.location,
    });
  }

  // Unresolved-reference warnings are a normalisation concern; the graph surfaces
  // the save's warnings unchanged (it generates none of its own).
  return new SaveGraph(actors, topology.edges, topology.powerCircuits, state.warnings ?? []);
}
