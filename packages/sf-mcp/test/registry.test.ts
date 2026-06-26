import { describe, expect, it } from 'vitest';

import { emptySaveState } from '@foreman/sf-save-data';
import { SaveStoreRegistry } from '../src/store/registry.js';
import { SaveStore } from '../src/store/saveStore.js';

const NOW = '2026-01-01T00:00:00.000Z';

/** A registry whose per-path stores parse from memory (no file I/O). */
function makeRegistry(baseDir: string | undefined, maxEntries = 5): SaveStoreRegistry {
  const defaultStore = new SaveStore(undefined);
  return new SaveStoreRegistry(defaultStore, baseDir, maxEntries, {
    statMtime: () => 1,
    load: () => emptySaveState('v', 'X', NOW),
    now: () => NOW,
  });
}

describe('SaveStoreRegistry', () => {
  it('serves the default store when no savePath is given', () => {
    const registry = makeRegistry('/saves');
    const a = registry.resolve();
    const b = registry.resolve('');
    expect(a).toBe(b);
    expect(a.saveName).toBe('none'); // the empty default store
  });

  it('caches one store per path (parsed once, reused)', () => {
    const registry = makeRegistry('/saves');
    const first = registry.resolve('/saves/a.sav');
    const again = registry.resolve('/saves/a.sav');
    const other = registry.resolve('/saves/b.sav');
    expect(again).toBe(first); // same path → same (cached) store
    expect(other).not.toBe(first); // different path → different store
  });

  it('evicts the least-recently-used path past the cap', () => {
    const registry = makeRegistry('/saves', 2);
    const a = registry.resolve('/saves/a.sav');
    registry.resolve('/saves/b.sav');
    registry.resolve('/saves/c.sav'); // evicts a (LRU)
    expect(registry.resolve('/saves/a.sav')).not.toBe(a); // a was rebuilt
  });

  it('refuses a path outside the allowed base dir (no traversal)', () => {
    const registry = makeRegistry('/saves');
    const escaped = registry.resolve('/saves/../etc/passwd');
    expect(escaped).toBe(registry.resolve()); // fell back to the default store
  });

  it('refuses any path when no base dir is configured', () => {
    const registry = makeRegistry(undefined);
    expect(registry.resolve('/saves/a.sav')).toBe(registry.resolve());
  });
});
