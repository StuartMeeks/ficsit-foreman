import { describe, expect, it } from 'vitest';

import { emptySaveState, type SaveState } from '../src/normalise/index.js';
import { SaveStore } from '../src/store/saveStore.js';

const NOW = '2026-01-01T00:00:00.000Z';

describe('SaveStore', () => {
  it('serves an empty state when no save path is configured', () => {
    const store = new SaveStore(undefined);
    const state = store.getState();
    expect(store.version).toBe('unknown');
    expect(store.saveName).toBe('none');
    expect(state.recipes).toEqual([]);
  });

  it('re-parses only when the file mtime changes', () => {
    const states: SaveState[] = [emptySaveState('v', 'A', NOW), emptySaveState('v', 'B', NOW)];
    let mtime = 1;
    let loads = 0;
    const store = new SaveStore('save.sav', {
      statMtime: () => mtime,
      load: () => states[Math.min(loads++, states.length - 1)] as SaveState,
      now: () => NOW,
    });
    expect(store.saveName).toBe('A'); // initial load
    expect(store.getState().saveName).toBe('A'); // same mtime → no reload
    expect(loads).toBe(1);
    mtime = 2;
    expect(store.getState().saveName).toBe('B'); // mtime changed → reload
    expect(loads).toBe(2);
  });

  it('keeps the previous state when a re-parse throws', () => {
    let mtime = 1;
    let mode: 'ok' | 'throw' = 'ok';
    const store = new SaveStore('save.sav', {
      statMtime: () => mtime,
      load: () => {
        if (mode === 'throw') {
          throw new Error('corrupt');
        }
        return emptySaveState('v', 'GOOD', NOW);
      },
      now: () => NOW,
    });
    expect(store.saveName).toBe('GOOD');
    mode = 'throw';
    mtime = 2;
    expect(() => store.getState()).not.toThrow();
    expect(store.saveName).toBe('GOOD'); // unchanged
  });
});
