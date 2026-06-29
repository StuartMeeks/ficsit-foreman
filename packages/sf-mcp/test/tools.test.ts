import type { Collectible, WorldLocations } from '@foreman/sf-game-data';
import { humaniseClassName } from '@foreman/sf-present';
import { describe, expect, it } from 'vitest';

import { emptySaveState, normaliseSave } from '@foreman/sf-save-data';
import {
  collectedGuidSet,
  collectibleProgressView,
  milestones,
  nearbyFromWorld,
  playerSummary,
  storageView,
  unlockedRecipes,
  unlockedSchematicSet,
} from '../src/query/selectors.js';
import type { GameDataIndex } from '../src/gameData.js';
import { SaveStore } from '../src/store/saveStore.js';
import { FIXTURE_SAVE } from '../../sf-save-data/test/fixtures/save.js';

/** A small static world dataset for the nearby selector (centimetre coords). */
const WORLD_COLLECTIBLES: Collectible[] = [
  { id: 'a', kind: 'mercerSphere', guid: 'G1', x: 50, y: 0, z: 0 }, // nearest
  { id: 'b', kind: 'mercerSphere', guid: 'G2', x: 5000, y: 0, z: 0 }, // far
  { id: 'c', kind: 'somersloop', guid: 'G3', x: 100, y: 0, z: 0 },
  { id: 'd', kind: 'powerSlugBlue', guid: 'G4', x: 200, y: 0, z: 0 },
  { id: 'e', kind: 'powerSlugYellow', guid: 'G5', x: 300, y: 0, z: 0 },
  { id: 'f', kind: 'powerSlugPurple', guid: 'G6', x: 400, y: 0, z: 0 },
  { id: 'g', kind: 'hardDrive', guid: 'G7', x: 500, y: 0, z: 0 },
  { id: 'h', kind: 'somersloop', guid: 'G8', x: 600, y: 0, z: 0 },
];

const { state } = normaliseSave(FIXTURE_SAVE, '2026-01-01T00:00:00.000Z');
const store = SaveStore.fromState(state);

/** Edge name resolver with no game data: humanised fallback only. */
const resolve = (className: string): string => humaniseClassName(className);

describe('store tagging', () => {
  it('exposes version and save name for response tagging', () => {
    expect(store.version).toBe('build 999999 (save 60)');
    expect(store.saveName).toBe('Fixture');
  });
});

describe('selectors', () => {
  it('playerSummary reports location and item count', () => {
    const summary = playerSummary(store.getState(), resolve);
    expect(summary.itemCount).toBe(1);
    // Location is reported in metres (fixture stores 100/200/300 cm).
    expect(summary.location).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('unlockedRecipes splits standard and alternate with counts', () => {
    const r = unlockedRecipes(store.getState(), resolve);
    expect(r.total).toBe(2);
    expect(r.standardCount).toBe(1);
    expect(r.alternateCount).toBe(1);
  });

  const EMPTY_GAME: GameDataIndex = { displayNames: new Map(), recipes: {}, buildings: {} };

  it('milestones groups by tier and surfaces phase + MAM', () => {
    const m = milestones(store.getState(), EMPTY_GAME, resolve);
    expect(m.milestonesByTier).toEqual([{ tier: 3, milestones: expect.any(Array) }]);
    expect(m.tutorials).toHaveLength(1);
    expect(m.assemblyPhase?.phase).toBe(2);
    expect(m.mamResearch).toEqual(['Caterium']);
    expect(m.creative).toBeUndefined(); // non-creative save: no overlay
    expect(m.projectAssembly).toEqual([]); // no phase data in EMPTY_GAME
  });

  it('milestones surfaces creative progression when Creative Mode is on (#172)', () => {
    const s = emptySaveState('v', 'n', 't');
    s.creativeMode = {
      ...s.creativeMode,
      enabled: true,
      startingTier: 6,
      unlockAllResearch: true,
      noUnlockCost: true,
    };
    const m = milestones(s, EMPTY_GAME, resolve);
    expect(m.creative).toEqual({
      startingTier: 6,
      unlockAllResearch: true,
      unlockAllShop: false,
      unlockInstantAltRecipes: false,
      noUnlockCost: true,
    });
  });

  it('milestones applies the Space Elevator cost multiplier to phase deliverables (#172, slice E)', () => {
    const s = emptySaveState('v', 'n', 't');
    s.advancedGameSettings.spaceElevatorCostMultiplier = 10;
    s.assemblyPhase = { phase: 1 };
    const game: GameDataIndex = {
      displayNames: new Map([['Desc_SpaceElevatorPart_1_C', 'Smart Plating']]),
      recipes: {},
      buildings: {},
      projectAssemblyPhases: [
        {
          phase: 1,
          lastTierOfPhase: 4,
          cost: [
            {
              itemClassName: 'Desc_SpaceElevatorPart_1_C',
              displayName: '',
              amount: 50,
              perMinute: 0,
              unit: 'items',
            },
          ],
        },
      ],
    };
    const gameResolve = (c: string): string => game.displayNames.get(c) ?? c;
    const m = milestones(s, game, gameResolve);
    expect(m.projectAssembly).toEqual([
      {
        phase: 1,
        unlocksTier: 4,
        current: true,
        cost: [
          { itemClass: 'Desc_SpaceElevatorPart_1_C', displayName: 'Smart Plating', amount: 500 },
        ], // 50 × 10
      },
    ]);
  });

  it('storageView sorts containers nearest-first when given a location', () => {
    const view = storageView(store.getState(), resolve, { x: 0, y: 0, z: 0 });
    expect(view.containerCount).toBe(2);
    expect(view.containers[0]?.buildingClass).toBe('Build_StorageContainerMk1_C'); // the near one
    expect(view.containers[0]?.distance).toBe(0.1); // 10 cm → 0.1 m
    expect(view.containers[0]?.location).toEqual({ x: 0.1, y: 0, z: 0 }); // metres
    expect(view.containers[1]?.distance ?? 0).toBeGreaterThan(view.containers[0]?.distance ?? 0);
  });

  it('collectibleProgress gives exact collected counts from the GUID record', () => {
    const world: WorldLocations = {
      gameVersion: 'test',
      build: 0,
      source: 'test',
      counts: {},
      collectibles: [
        { id: '1', kind: 'mercerSphere', guid: 'M1', x: 0, y: 0, z: 0 },
        { id: '2', kind: 'mercerSphere', guid: 'M2', x: 0, y: 0, z: 0 },
        { id: '3', kind: 'mercerSphere', guid: 'M3', x: 0, y: 0, z: 0 },
        { id: '4', kind: 'hardDrive', guid: 'P1', x: 0, y: 0, z: 0 },
        { id: '5', kind: 'hardDrive', guid: 'P2', x: 0, y: 0, z: 0 },
      ],
      resourceNodes: [],
    };
    const s = emptySaveState('v', 'n', 't');
    s.collectedPickupGuids = ['M1', 'M2']; // 2 of 3 mercer (matched via mDestroyedPickups)
    s.lootedDropPodGuids = ['P1']; // 1 of 2 pods (matched via mLootedDropPods)

    const byKind = Object.fromEntries(
      collectibleProgressView(s, world).perType.map((c) => [c.kind, c]),
    );
    expect(byKind['mercerSphere']).toMatchObject({ worldTotal: 3, collected: 2, remaining: 1 });
    expect(byKind['hardDrive']).toMatchObject({ worldTotal: 2, collected: 1, remaining: 1 });
    // A kind absent from the dataset reports zeros, not undefined.
    expect(byKind['somersloop']).toMatchObject({ worldTotal: 0, collected: 0, remaining: 0 });
  });

  it('marks schematic-keyed customizer pickups collected by unlocked schematic', () => {
    const world: WorldLocations = {
      gameVersion: 'test',
      build: 0,
      source: 'test',
      counts: {},
      collectibles: [
        { id: 'h', kind: 'helmet', schematic: 'Schematic_Helmet_Beta_C', x: 0, y: 0, z: 0 },
        { id: 't1', kind: 'mtape', schematic: 'Schematic_Huntdown_C', x: 10, y: 0, z: 0 },
        { id: 't2', kind: 'mtape', schematic: 'Schematic_DeepRockGalactic_C', x: 20, y: 0, z: 0 },
      ],
      resourceNodes: [],
    };
    const s = emptySaveState('v', 'n', 't');
    // The pioneer has unlocked the helmet + one tape (no pickup GUIDs involved).
    s.milestones = [
      { schematicClass: 'Schematic_Helmet_Beta_C', kind: 'other' },
      { schematicClass: 'Schematic_Huntdown_C', kind: 'other' },
    ];

    const byKind = Object.fromEntries(
      collectibleProgressView(s, world).perType.map((c) => [c.kind, c]),
    );
    expect(byKind['helmet']).toMatchObject({ worldTotal: 1, collected: 1, remaining: 0 });
    expect(byKind['mtape']).toMatchObject({ worldTotal: 2, collected: 1, remaining: 1 });

    // get_nearby excludes the unlocked ones — only the un-collected tape remains.
    const nearby = nearbyFromWorld(
      world.collectibles,
      { x: 0, y: 0, z: 0 },
      {},
      collectedGuidSet(s),
      unlockedSchematicSet(s),
    );
    expect(nearby.items.map((i) => i.label)).toEqual(['Tape']); // the DeepRockGalactic tape
  });

  it('nearbyFromWorld returns uncollected collectibles nearest-first, filtered and capped', () => {
    const origin = { x: 0, y: 0, z: 0 };
    const all = nearbyFromWorld(WORLD_COLLECTIBLES, origin);
    expect(all.matchCount).toBe(8);
    // Nearest: the 50 cm sphere → 0.5 m, with a compass bearing.
    expect(all.items[0]).toMatchObject({ label: 'Mercer Sphere', distance: 0.5 });
    expect(all.items[0]?.bearing).toMatch(/^(N|NE|E|SE|S|SW|W|NW)$/);

    const spheres = nearbyFromWorld(WORLD_COLLECTIBLES, origin, { kinds: ['mercerSphere'] });
    expect(spheres.matchCount).toBe(2);

    const within = nearbyFromWorld(WORLD_COLLECTIBLES, origin, { radius: 10 }); // metres
    expect(within.matchCount).toBe(7); // excludes the far sphere at 5000 cm (50 m)

    const capped = nearbyFromWorld(WORLD_COLLECTIBLES, origin, { limit: 3 });
    expect(capped.items).toHaveLength(3);
    expect(capped.matchCount).toBe(8); // matchCount is the full total, before the limit

    // Collected ones (by GUID) are excluded — these are genuinely still grabbable.
    const remaining = nearbyFromWorld(WORLD_COLLECTIBLES, origin, {}, new Set(['G1', 'G4']));
    expect(remaining.matchCount).toBe(6);
    expect(remaining.note).toMatch(/un-collected/i);
  });
});
