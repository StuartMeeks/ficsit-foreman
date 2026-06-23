import { describe, expect, it } from 'vitest';

import { normaliseSave } from '../src/normalise/index.js';
import {
  collectibleProgressView,
  milestones,
  nearby,
  playerSummary,
  storageView,
  unlockedRecipes,
} from '../src/query/selectors.js';
import { SaveStore } from '../src/store/saveStore.js';
import { FIXTURE_SAVE } from './fixtures/save.js';

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
    expect((view.containers[1]?.distance ?? 0)).toBeGreaterThan(view.containers[0]?.distance ?? 0);
  });

  it('collectibleProgress reports per-type X/Y with a coverage note', () => {
    const v = collectibleProgressView(store.getState());
    const sphere = v.perType.find((c) => c.kind === 'mercerSphere');
    expect(sphere).toMatchObject({ worldTotal: 298, remaining: 2, collected: 296 });
    expect(v.note).toMatch(/over-counted/);
  });

  it('nearby returns collectibles nearest-first, filtered and capped', () => {
    const origin = { x: 0, y: 0, z: 0 };
    const all = nearby(store.getState(), origin);
    expect(all.matchCount).toBe(8); // drop pod + resource deposit excluded
    expect(all.items[0]).toMatchObject({ label: 'Mercer Sphere', distance: 50 }); // nearest

    const spheres = nearby(store.getState(), origin, { kinds: ['mercerSphere'] });
    expect(spheres.matchCount).toBe(2);

    const within = nearby(store.getState(), origin, { radius: 1000 });
    expect(within.matchCount).toBe(7); // excludes the far sphere at 5000

    const capped = nearby(store.getState(), origin, { limit: 3 });
    expect(capped.items).toHaveLength(3);
    expect(capped.matchCount).toBe(8); // matchCount is the full total, before the limit
  });
});
