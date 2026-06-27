import { describe, expect, it } from 'vitest';

import { normaliseSave } from '../src/normalise/index.js';
import { FIXTURE_SAVE } from './fixtures/save.js';

const { state } = normaliseSave(FIXTURE_SAVE, '2026-01-01T00:00:00.000Z');

describe('header + version', () => {
  it('detects version from build/save numbers and the session name', () => {
    expect(state.version).toBe('build 999999 (save 60)');
    expect(state.saveName).toBe('Fixture');
  });

  it('surfaces discrete header identity for the host', () => {
    expect(state.sessionName).toBe('Fixture');
    expect(state.buildVersion).toBe(999999);
    expect(state.saveVersion).toBe(60);
    expect(state.playDurationSeconds).toBe(1234);
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

  it('carries each container instance name (the join key to topology/graph)', () => {
    const names = state.storage.containers.map((c) => c.instanceName).sort();
    expect(names).toEqual([
      'Persistent_Level:PersistentLevel.StoreFar',
      'Persistent_Level:PersistentLevel.StoreNear',
    ]);
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
    // Raw research-tree class names; humanising/cleaning to "Caterium" is the edge's job.
    expect(state.mamResearch).toEqual(['Research_Caterium_C']);
    expect(state.assemblyPhase?.phase).toBe(2);
    expect(state.assemblyPhase?.current).toBe('GP_Project_Assembly_Phase_2');
  });
});

describe('collectibles', () => {
  it('reads collected-pickup + looted-drop-pod GUIDs from FGScannableSubsystem', () => {
    // mDestroyedPickups: [1,2,3,4] and [5,6,7,8]; mLootedDropPods: [9,10,11,12].
    // Each FGuid renders as 32 uppercase hex chars (four uint32s in file order).
    expect(state.collectedPickupGuids).toEqual([
      '00000001000000020000000300000004',
      '00000005000000060000000700000008',
    ]);
    expect(state.lootedDropPodGuids).toEqual(['000000090000000A0000000B0000000C']);
  });
});

describe('raw class names (no display-name enrichment)', () => {
  it('emits item/building class names only — naming is resolved at the edge', () => {
    // The neutral library no longer carries display names; only the raw classes.
    expect(state.player.inventory[0]).toMatchObject({ itemClass: 'Desc_IronPlate_C', quantity: 50 });
    expect(state.player.inventory[0]).not.toHaveProperty('displayName');
    const sam = state.storage.dimensionalDepot.find((i) => i.itemClass === 'Desc_SAMIngot_C');
    expect(sam).not.toHaveProperty('displayName');
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
