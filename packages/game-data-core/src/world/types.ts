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

/** A collectible the player picks up once; absent from the world after pickup. */
export type CollectibleKind =
  | 'mercerSphere'
  | 'somersloop'
  | 'powerSlugBlue'
  | 'powerSlugYellow'
  | 'powerSlugPurple'
  | 'hardDrive';

/** A permanent resource extraction point (always present in the world). */
export type ResourceNodeKind = 'resourceNode' | 'frackingSatellite' | 'frackingCore' | 'geyser';

/** Node purity. Geysers and fracking cores carry no meaningful purity (`null`). */
export type Purity = 'impure' | 'normal' | 'pure';

export interface Collectible {
  /** Stable in-level instance name, e.g. `BP_Crystal_C_2146`. */
  id: string;
  kind: CollectibleKind;
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
}

/** Outcome of resolving and loading the world-location dataset. */
export interface WorldLocationsResolution {
  world: WorldLocations;
  /** The file the data was loaded from, if any. */
  path?: string;
  warning?: string;
}
