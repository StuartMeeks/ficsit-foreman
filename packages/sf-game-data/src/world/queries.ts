import { humaniseClassName } from '@foreman/sf-core';

import type { GameData } from '../parser/types.js';
import type {
  Collectible,
  CollectibleKind,
  Purity,
  ResourceNode,
  ResourceNodeKind,
  WorldLocations,
} from './types.js';

/** A point in the Satisfactory world, in Unreal units (centimetres). */
export interface Coord {
  x: number;
  y: number;
  z: number;
}

/** A resolved resource descriptor (class + display name). */
export interface ResourceRef {
  className: string;
  displayName: string;
}

export interface CollectibleHit extends Collectible {
  /** Straight-line distance from the query origin, in centimetres. */
  distance: number;
}

export interface ResourceNodeHit {
  id: string;
  kind: ResourceNodeKind;
  resource: ResourceRef | null;
  purity: Purity | null;
  x: number;
  y: number;
  z: number;
  distance: number;
}

export interface LootPickupHit {
  id: string;
  guid: string;
  /** The resolved item the pickup grants (class + display name). */
  item: ResourceRef;
  amount: number;
  x: number;
  y: number;
  z: number;
  distance: number;
}

/** Per-item summary of loose crash-site parts across the world. */
export interface PartSummary {
  item: ResourceRef;
  /** Number of pickups of this item. */
  pickups: number;
  /** Total quantity across all those pickups. */
  totalAmount: number;
}

const COLLECTIBLE_KINDS: readonly CollectibleKind[] = [
  'mercerSphere',
  'somersloop',
  'powerSlugBlue',
  'powerSlugYellow',
  'powerSlugPurple',
  'hardDrive',
  'helmet',
  'mtape',
];

function distance(origin: Coord, point: { x: number; y: number; z: number }): number {
  const dx = origin.x - point.x;
  const dy = origin.y - point.y;
  const dz = origin.z - point.z;
  return Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz));
}

/**
 * Read-only queries over the static world-location dataset. Loaded straight
 * into memory (a flat point list + a distance sort beats the production graph
 * here), it answers "how many / where are the collectibles" and "what resource
 * nodes are near me". All answers are distilled — distances, display names and
 * purity, never raw instance-name dumps.
 */
export class WorldQueries {
  private readonly resourceNames = new Map<string, string>();

  constructor(
    private readonly world: WorldLocations,
    gameData: GameData,
  ) {
    for (const item of [...Object.values(gameData.items), ...Object.values(gameData.resources)]) {
      this.resourceNames.set(item.className, item.displayName);
    }
  }

  private resolveResource(className: string | null): ResourceRef | null {
    if (className === null) {
      return null;
    }
    return {
      className,
      displayName: this.resourceNames.get(className) ?? humaniseClassName(className),
    };
  }

  /**
   * Counts per collectible kind, plus the full point list for a single kind when
   * `type` is supplied (omitted otherwise to avoid dumping the whole dataset).
   */
  public listCollectibles(type?: CollectibleKind): {
    counts: Partial<Record<CollectibleKind, number>>;
    total: number;
    collectibles?: Collectible[];
  } {
    const counts: Partial<Record<CollectibleKind, number>> = {};
    for (const kind of COLLECTIBLE_KINDS) {
      const n = this.world.counts[kind];
      if (n !== undefined) {
        counts[kind] = n;
      }
    }
    if (type === undefined) {
      const total = COLLECTIBLE_KINDS.reduce((sum, kind) => sum + (counts[kind] ?? 0), 0);
      return { counts, total };
    }
    const collectibles = this.world.collectibles.filter((c) => c.kind === type);
    return { counts, total: collectibles.length, collectibles };
  }

  /** The `n` collectibles nearest a world location, optionally filtered by kind. */
  public nearestCollectibles(origin: Coord, type?: CollectibleKind, n = 10): CollectibleHit[] {
    const pool =
      type === undefined
        ? this.world.collectibles
        : this.world.collectibles.filter((c) => c.kind === type);
    return pool
      .map((c) => ({ ...c, distance: distance(origin, c) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, Math.max(0, n));
  }

  /**
   * The `n` resource nodes nearest a world location, optionally filtered by
   * resource (matched against class or display name) and purity.
   */
  public nearestResourceNodes(
    origin: Coord,
    opts: { resource?: string; purity?: Purity; n?: number } = {},
  ): ResourceNodeHit[] {
    const { resource, purity, n = 10 } = opts;
    const needle = resource?.trim().toLowerCase();
    const pool = this.world.resourceNodes.filter((node) => {
      if (purity !== undefined && node.purity !== purity) {
        return false;
      }
      if (needle !== undefined && needle !== '') {
        const ref = this.resolveResource(node.resourceClass);
        if (ref === null) {
          return false;
        }
        if (
          !ref.className.toLowerCase().includes(needle) &&
          !ref.displayName.toLowerCase().includes(needle)
        ) {
          return false;
        }
      }
      return true;
    });
    return pool
      .map((node) => this.toHit(node, distance(origin, node)))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, Math.max(0, n));
  }

  /** Resolve an item descriptor class to a display name (never null — items always have a class). */
  private resolveItem(className: string): ResourceRef {
    return {
      className,
      displayName: this.resourceNames.get(className) ?? humaniseClassName(className),
    };
  }

  /**
   * Per-item summary of every loose crash-site part in the world, optionally filtered
   * to items matching `item` (by class or display name). Sorted by pickup count.
   */
  public listParts(item?: string): { byItem: PartSummary[]; totalPickups: number } {
    const needle = item?.trim().toLowerCase();
    const acc = new Map<string, { pickups: number; totalAmount: number }>();
    for (const p of this.world.lootPickups) {
      const ref = this.resolveItem(p.itemClass);
      if (
        needle !== undefined &&
        needle !== '' &&
        !ref.className.toLowerCase().includes(needle) &&
        !ref.displayName.toLowerCase().includes(needle)
      ) {
        continue;
      }
      const cur = acc.get(p.itemClass) ?? { pickups: 0, totalAmount: 0 };
      cur.pickups += 1;
      cur.totalAmount += p.amount;
      acc.set(p.itemClass, cur);
    }
    const byItem = [...acc.entries()]
      .map(([className, v]) => ({ item: this.resolveItem(className), ...v }))
      .sort((a, b) => b.pickups - a.pickups);
    return { byItem, totalPickups: byItem.reduce((s, x) => s + x.pickups, 0) };
  }

  /**
   * The `n` loose crash-site parts nearest a world location, nearest-first, optionally
   * filtered to items matching `item` (by class or display name). Each carries the
   * resolved item, amount, and straight-line distance.
   */
  public nearestParts(origin: Coord, item?: string, n = 10): LootPickupHit[] {
    const needle = item?.trim().toLowerCase();
    const pool = this.world.lootPickups.filter((p) => {
      if (needle === undefined || needle === '') {
        return true;
      }
      const ref = this.resolveItem(p.itemClass);
      return (
        ref.className.toLowerCase().includes(needle) ||
        ref.displayName.toLowerCase().includes(needle)
      );
    });
    return pool
      .map((p) => ({
        id: p.id,
        guid: p.guid,
        item: this.resolveItem(p.itemClass),
        amount: p.amount,
        x: p.x,
        y: p.y,
        z: p.z,
        distance: distance(origin, p),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, Math.max(0, n));
  }

  private toHit(node: ResourceNode, dist: number): ResourceNodeHit {
    return {
      id: node.id,
      kind: node.kind,
      resource: this.resolveResource(node.resourceClass),
      purity: node.purity,
      x: node.x,
      y: node.y,
      z: node.z,
      distance: dist,
    };
  }
}
