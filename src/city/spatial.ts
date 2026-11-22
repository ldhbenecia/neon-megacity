// Uniform-grid spatial hashes used while generating the layout and by the pure queries.
import type { Vec2 } from './types';

export const HASH_CELL = 64;

export interface Bounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Grid of item indices keyed by 64 m cells. */
export class GridHash {
  private readonly cells = new Map<number, number[]>();
  constructor(readonly cell = HASH_CELL) {}

  private key(ix: number, iz: number): number {
    // Map is ±(a few thousand) m; offset keeps keys positive and unique.
    return (ix + 4096) * 8192 + (iz + 4096);
  }

  insert(id: number, b: Bounds): void {
    const c = this.cell;
    for (let ix = Math.floor(b.minX / c); ix <= Math.floor(b.maxX / c); ix++) {
      for (let iz = Math.floor(b.minZ / c); iz <= Math.floor(b.maxZ / c); iz++) {
        const k = this.key(ix, iz);
        const list = this.cells.get(k);
        if (list) list.push(id);
        else this.cells.set(k, [id]);
      }
    }
  }

  /** Unique ids whose cells overlap `b`, in ascending order. */
  query(b: Bounds): number[] {
    const c = this.cell;
    const out = new Set<number>();
    for (let ix = Math.floor(b.minX / c); ix <= Math.floor(b.maxX / c); ix++) {
      for (let iz = Math.floor(b.minZ / c); iz <= Math.floor(b.maxZ / c); iz++) {
        const list = this.cells.get(this.key(ix, iz));
        if (list) for (const id of list) out.add(id);
      }
    }
    return [...out].sort((a, b2) => a - b2);
  }
}

export function segmentBounds(a: Vec2, b: Vec2, pad: number): Bounds {
  return {
    minX: Math.min(a.x, b.x) - pad,
    minZ: Math.min(a.z, b.z) - pad,
    maxX: Math.max(a.x, b.x) + pad,
    maxZ: Math.max(a.z, b.z) + pad,
  };
}

export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minZ <= b.maxZ && b.minZ <= a.maxZ;
}
