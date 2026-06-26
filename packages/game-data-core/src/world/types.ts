/**
 * World-location dataset types. A static, first-party dataset of every fixed
 * placement in the Satisfactory world — collectibles (Mercer Spheres,
 * Somersloops, power slugs, hard-drive drop pods) and resource extraction
 * points (resource nodes, fracking satellites/cores, geothermal geysers).
 *
 * Coordinates are Unreal world units (centimetres), matching what the save game
 * reports, so positions are directly comparable with a pioneer's location.
 *
 * British English is used throughout comments and documentation.
 */

/**
 * A collectible the player picks up once; absent from the world after pickup.
 * Most are GUID-keyed pickups; the customizer kinds (`helmet`, `mtape`) carry no
 * pickup GUID and instead grant a cosmetic schematic — see {@link Collectible}.
 */
export type CollectibleKind =
  | 'mercerSphere'
  | 'somersloop'
  | 'powerSlugBlue'
  | 'powerSlugYellow'
  | 'powerSlugPurple'
  | 'hardDrive'
  | 'helmet'
  | 'mtape';

/** A permanent resource extraction point (always present in the world). */
export type ResourceNodeKind = 'resourceNode' | 'frackingSatellite' | 'frackingCore' | 'geyser';

/**
 * What a hard-drive crash site (drop pod) requires to open. A pod may need an item
 * cost, a power cost, both, or nothing (in which case the `Collectible` carries no
 * `unlock` at all). Read from the pod's `mUnlockCost` by the presence of its
 * sub-fields — the cost-type enum is unreliable (omitted at its default value).
 */
export interface UnlockCost {
  /** An item the pod must be fed to open (item descriptor class + amount). */
  item?: { itemClass: string; amount: number };
  /** A power draw the pod must be supplied, in megawatts. */
  powerMW?: number;
}

/** Node purity. Geysers and fracking cores carry no meaningful purity (`null`). */
export type Purity = 'impure' | 'normal' | 'pure';

export interface Collectible {
  /** Stable in-level instance name, e.g. `BP_Crystal_C_2146`. */
  id: string;
  kind: CollectibleKind;
  /**
   * The actor's GUID as 32 uppercase hex chars (four FGuid uint32s in file
   * order) — `mItemPickupGuid` for pickups, `mDropPodGuid` for hard-drive pods.
   * This is the key a save records when the collectible is collected (in
   * `FGScannableSubsystem.mDestroyedPickups` / `mLootedDropPods`), so it lets a
   * save be matched to exact per-collectible collected status. Absent for the
   * schematic-keyed customizer kinds (`helmet`, `mtape`).
   */
  guid?: string;
  /**
   * For schematic-keyed kinds (`helmet`, `mtape`): the cosmetic schematic class
   * the pickup grants (e.g. `Schematic_Helmet_Beta_C`). These carry no pickup
   * GUID — collected status is read from the save's unlocked schematics instead.
   */
  schematic?: string;
  /**
   * For hard-drive drop pods (`kind: 'hardDrive'`): what the crash site requires to
   * open (item and/or power). Absent when the pod is free or for non-pod kinds.
   */
  unlock?: UnlockCost;
  x: number;
  y: number;
  z: number;
}

/**
 * A loose crash-site part — one of the ~703 `FGItemPickup_Spawnable` actors strewn
 * around crash sites (free high-tier parts like Computers and Heavy Modular Frames).
 * Collected once, then gone. The item class is not stored on the placed actor; it is
 * recovered from the pickup's static mesh (= the item descriptor's `mConveyorMesh`)
 * during extraction. NOTE: this reflects the corrected 1.2 loot — saves that began in
 * 1.0/1.1 may carry different in-world items for a few pickups (a since-fixed game bug).
 */
export interface LootPickup {
  /**
   * Stable in-level instance name. This is the key for collected status: a save records
   * collected loose parts in each sublevel's `collectables` (collected-actor) list by
   * instance name — NOT in `mDestroyedPickups` (which tracks collectibles only).
   */
  id: string;
  /** `mItemPickupGuid` (32 uppercase hex) — the actor's stable GUID (identity; see `id` for collected status). */
  guid: string;
  /** Item descriptor class, e.g. `Desc_Computer_C`. */
  itemClass: string;
  /** Stack size at the pickup (`NumItems`). */
  amount: number;
  x: number;
  y: number;
  z: number;
}

export interface ResourceNode {
  id: string;
  kind: ResourceNodeKind;
  /** Resource descriptor class, e.g. `Desc_OreIron_C`. `null` for geysers. */
  resourceClass: string | null;
  /** `null` for geysers and fracking cores. */
  purity: Purity | null;
  x: number;
  y: number;
  z: number;
}

export interface WorldLocations {
  /** Game version the dataset was extracted from (matches the docs `meta.json`). */
  gameVersion: string;
  build: number;
  /** Provenance string for the dataset. */
  source: string;
  /** Per-kind totals; equal to the corresponding array lengths. */
  counts: Record<string, number>;
  collectibles: Collectible[];
  resourceNodes: ResourceNode[];
  /** Loose crash-site parts (`counts.crashSitePart` equals this array's length). */
  lootPickups: LootPickup[];
}

/** Outcome of resolving and loading the world-location dataset. */
export interface WorldLocationsResolution {
  world: WorldLocations;
  /** The file the data was loaded from, if any. */
  path?: string;
  warning?: string;
}
