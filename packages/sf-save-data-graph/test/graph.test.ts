import { describe, expect, it } from 'vitest';

import { emptySaveState } from '@foreman/sf-save-data';

import { buildSaveGraph, ownerOf } from '../src/index.js';
import {
  BELT,
  CONSTRUCTOR,
  COAL,
  GENERATOR,
  MINER,
  PIPE,
  SCENE_STATE,
  SMART_SPLITTER,
  STORAGE,
} from './fixtures/scene.js';

describe('ownerOf', () => {
  it('drops the trailing connector segment', () => {
    expect(ownerOf(`${CONSTRUCTOR}.Output0`)).toBe(CONSTRUCTOR);
  });

  it('returns the path unchanged when there is no segment', () => {
    expect(ownerOf('NoDots')).toBe('NoDots');
  });
});

describe('buildSaveGraph', () => {
  const graph = buildSaveGraph(SCENE_STATE);

  it('registers only building actors (not connection components or circuits)', () => {
    const stats = graph.stats();
    // 9 Build_* actors in the scene; connectors/circuits are not actor nodes.
    expect(stats.actors).toBe(9);
    expect(graph.getActor(CONSTRUCTOR)?.classKey).toBe('Build_ConstructorMk1_C');
    expect(graph.getActor(`${CONSTRUCTOR}.Output0`)).toBeUndefined();
  });

  it('carries actor locations through', () => {
    expect(graph.getActor(CONSTRUCTOR)?.location).toEqual({ x: 100, y: 0, z: 0 });
  });

  it('resolves conveyor links to owner actors and dedups the symmetric pair', () => {
    const conveyor = graph.edges('conveyor');
    // constructor↔belt and belt↔storage (each declared from both ends, deduped to
    // one), plus the dangling stray-belt link (recorded, but warned — see below).
    expect(conveyor).toHaveLength(3);
    const pairs = conveyor.map((e) => [e.from, e.to].sort());
    expect(pairs).toContainEqual([BELT, CONSTRUCTOR].sort());
    expect(pairs).toContainEqual([BELT, STORAGE].sort());
  });

  it('retains connector name tails for direction inference', () => {
    const edge = graph
      .edges('conveyor')
      .find((e) => e.from === CONSTRUCTOR || e.to === CONSTRUCTOR);
    const connectors = [edge?.fromConnector, edge?.toConnector];
    expect(connectors).toContain('Output0');
    expect(connectors).toContain('ConveyorAny0');
  });

  it('models belts as nodes so a chain is traversable end to end', () => {
    expect(graph.neighbours(BELT, 'conveyor').map((a) => a.instanceName).sort()).toEqual(
      [CONSTRUCTOR, STORAGE].sort(),
    );
    // Constructor reaches storage only by passing through the belt node.
    expect(graph.traverse(CONSTRUCTOR, { kind: 'conveyor' })).toContain(STORAGE);
    expect(graph.traverse(CONSTRUCTOR, { kind: 'conveyor', maxDepth: 1 })).not.toContain(STORAGE);
  });

  it('resolves pipe links and carries the network id', () => {
    const pipes = graph.edges('pipe');
    expect(pipes).toHaveLength(1);
    expect(pipes[0]?.networkId).toBe(4);
    expect([pipes[0]?.from, pipes[0]?.to].sort()).toEqual([COAL, PIPE].sort());
  });

  it('reads pre-grouped power circuits and maps members to circuits', () => {
    const circuits = graph.powerCircuits();
    expect(circuits).toHaveLength(1);
    expect(circuits[0]?.circuitId).toBe(3);
    expect(circuits[0]?.members.sort()).toEqual([GENERATOR, MINER].sort());
    expect(graph.powerCircuitOf(GENERATOR)?.circuitId).toBe(3);
    expect(graph.powerCircuitOf(CONSTRUCTOR)).toBeUndefined();
  });

  it('surfaces the save warnings (e.g. a dangling connection reference)', () => {
    // The unresolved-reference warning is produced by the normaliser and projected
    // through unchanged — the graph generates none of its own.
    expect(graph.warnings.some((w) => /conveyor connection.*unknown owner/.test(w))).toBe(true);
  });

  it('never throws on an empty or partial state', () => {
    const empty = emptySaveState('unknown', 'none', '2026-01-01T00:00:00.000Z');
    expect(() => buildSaveGraph(empty)).not.toThrow();
    expect(buildSaveGraph(empty).stats().actors).toBe(0);
    // A malformed state missing topology must not throw either.
    expect(() => buildSaveGraph({ warnings: [] } as never).stats()).not.toThrow();
  });
});

describe('domain projection (nodes carry their typed save records)', () => {
  const graph = buildSaveGraph(SCENE_STATE);

  it('tags each actor with its domain role, joined by instance name', () => {
    expect(graph.getActor(CONSTRUCTOR)?.kind).toBe('producer');
    expect(graph.getActor(MINER)?.kind).toBe('extractor');
    expect(graph.getActor(STORAGE)?.kind).toBe('storage');
    expect(graph.getActor(GENERATOR)?.kind).toBe('generator');
    expect(graph.getActor(COAL)?.kind).toBe('generator');
    expect(graph.getActor(BELT)?.kind).toBe('building'); // no domain record
  });

  it('attaches the matching typed record to the node', () => {
    expect(graph.getActor(STORAGE)?.storage?.instanceName).toBe(STORAGE);
    expect(graph.getActor(MINER)?.extractor?.instanceName).toBe(MINER);
    expect(graph.getActor(GENERATOR)?.generator?.instanceName).toBe(GENERATOR);
    const producer = graph.getActor(CONSTRUCTOR)?.producer;
    expect(producer?.instanceName).toBe(CONSTRUCTOR);
    expect(producer?.buildingClass).toBe('Build_ConstructorMk1_C');
  });

  it('selects actors by domain role', () => {
    expect(graph.actorsByKind('extractor').map((a) => a.instanceName)).toEqual([MINER]);
    expect(graph.actorsByKind('storage').map((a) => a.instanceName)).toEqual([STORAGE]);
    expect(graph.actorsByKind('generator').map((a) => a.instanceName).sort()).toEqual(
      [COAL, GENERATOR].sort(),
    );
  });

  it('exposes the backing SaveState so every save fact is reachable from the graph', () => {
    expect(graph.state()).toBe(SCENE_STATE);
    expect(graph.state().topology.buildables).toHaveLength(graph.stats().actors);
  });

  it('projects smart-splitter routing rules onto the node and via splitterRulesOf', () => {
    const node = graph.getActor(SMART_SPLITTER);
    expect(node?.kind).toBe('building'); // a splitter carries no domain record
    expect(node?.splitter?.classKey).toBe('Build_ConveyorAttachmentSplitterSmart_C');
    expect(graph.splitterRulesOf(SMART_SPLITTER)).toEqual([
      { outputIndex: 0, rule: 'item', itemClass: 'Desc_Wire_C' },
      { outputIndex: 1, rule: 'overflow' },
    ]);
  });

  it('returns undefined splitter rules for non-splitter actors', () => {
    expect(graph.splitterRulesOf(CONSTRUCTOR)).toBeUndefined();
    expect(graph.getActor(CONSTRUCTOR)?.splitter).toBeUndefined();
  });
});
