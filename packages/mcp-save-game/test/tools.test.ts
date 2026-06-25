import type { Collectible, WorldLocations } from '@foreman/game-data-core';
import { describe, expect, it } from 'vitest';

import { emptySaveState, normaliseSave } from '../src/normalise/index.js';
import {
  collectibleProgressView,
  milestones,
  nearbyFromWorld,
  playerSummary,
  storageView,
  unlockedRecipes,
} from '../src/query/selectors.js';
import { SaveStore } from '../src/store/saveStore.js';
import { FIXTURE_SAVE } from './fixtures/save.js';

/** A small static world dataset for the nearby selector (centimetre coords). */
const WORLD_COLLECTIBLES: Collectible[] = [
  { id: 'a', kind: 'mercerSphere', x: 50, y: 0, z: 0 }, // nearest
  { id: 'b', kind: 'mercerSphere', x: 5000, y: 0, z: 0 }, // far
  { id: 'c', kind: 'somersloop', x: 100, y: 0, z: 0 },
  { id: 'd', kind: 'powerSlugBlue', x: 200, y: 0, z: 0 },
  { id: 'e', kind: 'powerSlugYellow', x: 300, y: 0, z: 0 },
  { id: 'f', kind: 'powerSlugPurple', x: 400, y: 0, z: 0 },
  { id: 'g', kind: 'hardDrive', x: 500, y: 0, z: 0 },
  { id: 'h', kind: 'somersloop', x: 600, y: 0, z: 0 },
];

const { state } = normaliseSave(FIXTURE_SAVE, '2026-01-01T00:00:00.000Z');
const store = SaveStore.fromState(state);

describe('store tagging', () => {
  it('exposes version and save name for response tagging', () => {
    expect(store.version).toBe('build 999999 (save 60)');
    expect(store.saveName).toBe('Fixture');
  });
});

describe('selectors', () => {
  it('playerSummary reports location and item count', () => {
    const summary = playerSummary(store.getState());
    expect(summary.itemCount).toBe(1);
    expect(summary.location).toEqual({ x: 100, y: 200, z: 300 });
  });

  it('unlockedRecipes splits standard and alternate with counts', () => {
    const r = unlockedRecipes(store.getState());
    expect(r.total).toBe(2);
    expect(r.standardCount).toBe(1);
    expect(r.alternateCount).toBe(1);
  });

  it('milestones groups by tier and surfaces phase + MAM', () => {
    const m = milestones(store.getState());
    expect(m.milestonesByTier).toEqual([{ tier: 3, milestones: expect.any(Array) }]);
    expect(m.tutorials).toHaveLength(1);
    expect(m.assemblyPhase?.phase).toBe(2);
    expect(m.mamResearch).toEqual(['Caterium']);
  });

  it('storageView sorts containers nearest-first when given a location', () => {
    const view = storageView(store.getState(), { x: 0, y: 0, z: 0 });
    expect(view.containerCount).toBe(2);
    expect(view.containers[0]?.buildingClass).toBe('Build_StorageContainerMk1_C'); // the near one
    expect(view.containers[0]?.distance).toBe(10);
    expect(view.containers[1]?.distance ?? 0).toBeGreaterThan(view.containers[0]?.distance ?? 0);
  });

  it('collectibleProgress scopes collected to explored (streamed) cells', () => {
    const world: WorldLocations = {
      gameVersion: 'test',
      build: 0,
      source: 'test',
      counts: {},
      collectibles: [
        { id: '1', kind: 'mercerSphere', x: 0, y: 0, z: 0 }, // explored, absent → collected
        { id: '2', kind: 'mercerSphere', x: 100, y: 100, z: 0 }, // explored, present → grabbable
        { id: '3', kind: 'mercerSphere', x: 9_999_999, y: 9_999_999, z: 0 }, // unexplored
      ],
      resourceNodes: [],
    };
    const s = emptySaveState('v', 'n', 't');
    s.collectibleProgress = [
      { kind: 'mercerSphere', label: 'Mercer Sphere', worldTotal: 298, presentInSave: 1 },
    ];
    s.streamedCellBoxes = [{ x0: -500, x1: 500, y0: -500, y1: 500 }]; // covers ids 1 & 2

    const sphere = collectibleProgressView(s, world).perType[0];
    // streamedTotal = 2 (ids 1,2), present = 1 ⇒ collected = 1; unexplored = 298 − 1 − 1.
    expect(sphere).toMatchObject({
      worldTotal: 298,
      presentInSave: 1,
      collectedInExplored: 1,
      inUnexploredAreas: 296,
    });
  });

  it('collectibleProgress reports ~0 collected when nothing is explored', () => {
    const world: WorldLocations = {
      gameVersion: 'test',
      build: 0,
      source: 'test',
      counts: {},
      collectibles: [{ id: '1', kind: 'mercerSphere', x: 0, y: 0, z: 0 }],
      resourceNodes: [],
    };
    const s = emptySaveState('v', 'n', 't');
    s.collectibleProgress = [
      { kind: 'mercerSphere', label: 'Mercer Sphere', worldTotal: 298, presentInSave: 0 },
    ];
    s.streamedCellBoxes = []; // nothing streamed
    const sphere = collectibleProgressView(s, world).perType[0];
    expect(sphere?.collectedInExplored).toBe(0);
  });

  it('nearbyFromWorld returns collectibles nearest-first, filtered and capped', () => {
    const origin = { x: 0, y: 0, z: 0 };
    const all = nearbyFromWorld(WORLD_COLLECTIBLES, origin);
    expect(all.matchCount).toBe(8);
    expect(all.items[0]).toMatchObject({ label: 'Mercer Sphere', distance: 50 }); // nearest
    expect(all.note).toMatch(/world dataset/i);

    const spheres = nearbyFromWorld(WORLD_COLLECTIBLES, origin, { kinds: ['mercerSphere'] });
    expect(spheres.matchCount).toBe(2);

    const within = nearbyFromWorld(WORLD_COLLECTIBLES, origin, { radius: 1000 });
    expect(within.matchCount).toBe(7); // excludes the far sphere at 5000

    const capped = nearbyFromWorld(WORLD_COLLECTIBLES, origin, { limit: 3 });
    expect(capped.items).toHaveLength(3);
    expect(capped.matchCount).toBe(8); // matchCount is the full total, before the limit
  });
});
