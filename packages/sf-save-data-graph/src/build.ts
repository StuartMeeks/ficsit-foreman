/**
 * Projects the in-memory connection graph from a `SaveState`. The relational facts
 * — buildable actors (the complete node set), conveyor/pipe edges and pre-grouped
 * power circuits — already live in `state.topology`, produced by the `sf-save-data`
 * normaliser. This builds the adjacency/BFS index over them, joins each node to its
 * typed domain record (storage/producer/extractor) by instance name, and keeps a
 * back-reference to the state so every save fact is reachable through the facade. It
 * holds **no facts of its own**: it is a pure projection. Never throws; an empty or
 * partial state simply yields an empty graph.
 */
import type {
  BatteryLine,
  ExtractorLine,
  GeneratorLine,
  ProducerLine,
  SaveState,
  SplitterConfig,
  StorageContainer,
} from '@foreman/sf-save-data';

import { SaveGraph } from './graph.js';
import type { ActorKind, ActorNode } from './types.js';

const EMPTY_TOPOLOGY = { buildables: [], edges: [], powerCircuits: [], splitters: [] } as const;

function indexByInstance<T extends { instanceName: string }>(
  records: T[] | undefined,
): Map<string, T> {
  const map = new Map<string, T>();
  for (const record of records ?? []) {
    map.set(record.instanceName, record);
  }
  return map;
}

/** Projects the connection graph from a normalised save state. */
export function buildSaveGraph(state: SaveState): SaveGraph {
  const topology = state.topology ?? EMPTY_TOPOLOGY;

  // Index the typed domain lists so each node can carry its own record.
  const storageByName = indexByInstance<StorageContainer>(state.storage?.containers);
  const producerByName = indexByInstance<ProducerLine>(state.production?.producers);
  const extractorByName = indexByInstance<ExtractorLine>(state.production?.extractors);
  const generatorByName = indexByInstance<GeneratorLine>(state.production?.generators);
  const batteryByName = indexByInstance<BatteryLine>(state.production?.batteries);
  const splitterByName = indexByInstance<SplitterConfig>(topology.splitters);

  const actors = new Map<string, ActorNode>();
  for (const buildable of topology.buildables) {
    const storage = storageByName.get(buildable.instanceName);
    const producer = producerByName.get(buildable.instanceName);
    const extractor = extractorByName.get(buildable.instanceName);
    const generator = generatorByName.get(buildable.instanceName);
    const battery = batteryByName.get(buildable.instanceName);
    const splitter = splitterByName.get(buildable.instanceName);
    const kind: ActorKind = storage
      ? 'storage'
      : producer
        ? 'producer'
        : extractor
          ? 'extractor'
          : generator
            ? 'generator'
            : 'building';
    actors.set(buildable.instanceName, {
      instanceName: buildable.instanceName,
      classKey: buildable.classKey,
      location: buildable.location,
      kind,
      ...(storage === undefined ? {} : { storage }),
      ...(producer === undefined ? {} : { producer }),
      ...(extractor === undefined ? {} : { extractor }),
      ...(generator === undefined ? {} : { generator }),
      ...(battery === undefined ? {} : { battery }),
      ...(splitter === undefined ? {} : { splitter }),
    });
  }

  // Unresolved-reference warnings are a normalisation concern; the graph surfaces
  // the save's warnings unchanged (it generates none of its own).
  return new SaveGraph(actors, topology.edges, topology.powerCircuits, state.warnings ?? [], state);
}
