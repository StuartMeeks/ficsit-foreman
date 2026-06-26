import { describe, expect, it } from 'vitest';

import { emptyGameData } from '../src/parser/index.js';
import type { GameData, Item, WorldLocations } from '../src/index.js';
import { WorldQueries } from '../src/world/queries.js';

function resource(className: string, displayName: string): Item {
  return {
    className,
    displayName,
    description: '',
    stackSize: 0,
    form: 'solid',
    sinkPoints: 0,
    energyValue: 0,
    isResource: true,
  };
}

const gameData: GameData = {
  ...emptyGameData('1.2.3.0'),
  resources: {
    Desc_OreIron_C: resource('Desc_OreIron_C', 'Iron Ore'),
    Desc_OreCopper_C: resource('Desc_OreCopper_C', 'Copper Ore'),
  },
};

const world: WorldLocations = {
  gameVersion: '1.2.3.0',
  build: 1,
  source: 'test',
  counts: { mercerSphere: 2, somersloop: 1, resourceNode: 3, geyser: 1 },
  collectibles: [
    { id: 'm-far', kind: 'mercerSphere', x: 1000, y: 0, z: 0 },
    { id: 'm-near', kind: 'mercerSphere', x: 100, y: 0, z: 0 },
    { id: 's1', kind: 'somersloop', x: 50, y: 0, z: 0 },
  ],
  resourceNodes: [
    { id: 'iron-pure', kind: 'resourceNode', resourceClass: 'Desc_OreIron_C', purity: 'pure', x: 300, y: 0, z: 0 },
    { id: 'iron-impure', kind: 'resourceNode', resourceClass: 'Desc_OreIron_C', purity: 'impure', x: 200, y: 0, z: 0 },
    { id: 'copper', kind: 'resourceNode', resourceClass: 'Desc_OreCopper_C', purity: 'normal', x: 10, y: 0, z: 0 },
    { id: 'geo', kind: 'geyser', resourceClass: null, purity: 'normal', x: 5, y: 0, z: 0 },
  ],
};

const origin = { x: 0, y: 0, z: 0 };
const q = new WorldQueries(world, gameData);

describe('listCollectibles', () => {
  it('returns counts only when no type is given', () => {
    const result = q.listCollectibles();
    expect(result.counts).toMatchObject({ mercerSphere: 2, somersloop: 1 });
    expect(result.total).toBe(3);
    expect(result.collectibles).toBeUndefined();
  });

  it('returns the full point list for a single kind', () => {
    const result = q.listCollectibles('mercerSphere');
    expect(result.collectibles).toHaveLength(2);
    expect(result.collectibles?.every((c) => c.kind === 'mercerSphere')).toBe(true);
  });
});

describe('nearestCollectibles', () => {
  it('sorts by distance, nearest first', () => {
    const hits = q.nearestCollectibles(origin);
    expect(hits[0]?.id).toBe('s1');
    expect(hits[0]?.distance).toBe(50);
    expect(hits.map((h) => h.id)).toEqual(['s1', 'm-near', 'm-far']);
  });

  it('filters by kind and caps with n', () => {
    const hits = q.nearestCollectibles(origin, 'mercerSphere', 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe('m-near');
  });
});

describe('nearestResourceNodes', () => {
  it('resolves the resource display name and reports purity + distance', () => {
    const hits = q.nearestResourceNodes(origin, { resource: 'iron' });
    expect(hits.map((h) => h.id)).toEqual(['iron-impure', 'iron-pure']);
    expect(hits[0]?.resource).toEqual({ className: 'Desc_OreIron_C', displayName: 'Iron Ore' });
    expect(hits[0]?.purity).toBe('impure');
    expect(hits[0]?.distance).toBe(200);
  });

  it('matches the resource filter against the class name too', () => {
    const hits = q.nearestResourceNodes(origin, { resource: 'Desc_OreCopper_C' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe('copper');
  });

  it('filters by purity', () => {
    const hits = q.nearestResourceNodes(origin, { purity: 'pure' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe('iron-pure');
  });

  it('returns a null resource for geysers and caps with n', () => {
    const hits = q.nearestResourceNodes(origin, { n: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe('geo');
    expect(hits[0]?.resource).toBeNull();
  });
});
