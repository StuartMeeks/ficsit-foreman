import { describe, expect, it } from 'vitest';

import { normaliseSave } from '../src/normalise/index.js';
import { FIXTURE_SAVE } from './fixtures/save.js';

const { state } = normaliseSave(FIXTURE_SAVE, '2026-01-01T00:00:00.000Z');

describe('header + version', () => {
  it('detects version from build/save numbers and the session name', () => {
    expect(state.version).toBe('build 999999 (save 60)');
    expect(state.saveName).toBe('Fixture');
  });
});

describe('player', () => {
  it('reads location and HUB location from transforms', () => {
    expect(state.player.location).toEqual({ x: 100, y: 200, z: 300 });
    expect(state.player.hubLocation).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('decodes inventory via the mInventory reference and skips empty slots', () => {
    expect(state.player.inventory).toHaveLength(1);
    expect(state.player.inventory[0]).toMatchObject({
      itemClass: 'Desc_IronPlate_C',
      quantity: 50,
    });
  });
});

describe('storage + depot', () => {
  it('extracts containers with their inventories', () => {
    expect(state.storage.containers).toHaveLength(2);
    const coal = state.storage.containers
      .flatMap((c) => c.inventory)
      .find((i) => i.itemClass === 'Desc_Coal_C');
    expect(coal?.quantity).toBe(200);
  });

  it('decodes the dimensional depot (ItemAmount shape)', () => {
    expect(state.storage.dimensionalDepot).toHaveLength(1);
    expect(state.storage.dimensionalDepot[0]).toMatchObject({
      itemClass: 'Desc_SAMIngot_C',
      quantity: 500,
    });
  });
});

describe('recipes', () => {
  it('classifies standard vs alternate', () => {
    expect(state.recipes).toHaveLength(2);
    const alt = state.recipes.find((r) => r.recipeClass === 'Recipe_Alternate_Wire_1_C');
    const std = state.recipes.find((r) => r.recipeClass === 'Recipe_IngotIron_C');
    expect(alt?.isAlternate).toBe(true);
    expect(std?.isAlternate).toBe(false);
  });
});

describe('milestones + MAM + phase', () => {
  it('classifies tutorial vs tiered milestone', () => {
    const tutorial = state.milestones.find((m) => m.schematicClass === 'Schematic_Tutorial1_C');
    const milestone = state.milestones.find((m) => m.schematicClass === 'Schematic_3-2_C');
    expect(tutorial?.kind).toBe('tutorial');
    expect(milestone).toMatchObject({ kind: 'milestone', tier: 3 });
  });

  it('reads MAM research and the assembly phase number', () => {
    expect(state.mamResearch).toEqual(['Caterium']);
    expect(state.assemblyPhase?.phase).toBe(2);
    expect(state.assemblyPhase?.current).toBe('GP_Project_Assembly_Phase_2');
  });
});

describe('collectibles', () => {
  const byKind = Object.fromEntries(state.collectibleProgress.map((c) => [c.kind, c]));

  it('counts present-in-save actors per type against the world total (no collected count)', () => {
    expect(byKind['mercerSphere']).toMatchObject({ worldTotal: 298, presentInSave: 2 });
    expect(byKind['somersloop']).toMatchObject({ worldTotal: 106, presentInSave: 1 });
    expect(byKind['powerSlugBlue']).toMatchObject({ worldTotal: 596, presentInSave: 3 });
    expect(byKind['powerSlugYellow']).toMatchObject({ presentInSave: 1 });
    expect(byKind['powerSlugPurple']).toMatchObject({ presentInSave: 1 });
    // No "collected"/"remaining" is derived (absence ≠ collected on a streamed save).
    expect(byKind['mercerSphere']).not.toHaveProperty('collected');
  });

  it('excludes hard-drive drop pods and transient resource deposits', () => {
    expect(state.collectibleProgress.some((c) => String(c.kind).includes('drop'))).toBe(false);
    // 2 spheres + 1 sloop + 3 blue + 1 yellow + 1 purple = 8 (pod + deposit excluded).
    expect(state.remainingCollectibles).toHaveLength(8);
    expect(state.remainingCollectibles.every((c) => c.location !== undefined)).toBe(true);
  });
});

describe('item display names', () => {
  it('uses real names from the provided map, humanised fallback otherwise', () => {
    const { state: named } = normaliseSave(
      FIXTURE_SAVE,
      '2026-01-01T00:00:00.000Z',
      new Map([['Desc_IronPlate_C', 'Iron Plate']]),
    );
    expect(named.player.inventory[0]?.displayName).toBe('Iron Plate'); // from the map
    const sam = named.storage.dimensionalDepot.find((i) => i.itemClass === 'Desc_SAMIngot_C');
    expect(sam?.displayName).toBeTruthy(); // not in the map → humanised, still present
  });
});

describe('partial parse', () => {
  it('does not throw on a malformed object and produces no warnings when managers are present', () => {
    expect(state.warnings).toEqual([]);
  });

  it('degrades gracefully (warn-and-skip) on an empty save, never throwing', () => {
    const { state: empty } = normaliseSave({}, '2026-01-01T00:00:00.000Z');
    expect(empty.recipes).toEqual([]);
    expect(empty.player.inventory).toEqual([]);
    expect(empty.warnings.length).toBeGreaterThan(0);
  });
});
