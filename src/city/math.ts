// Small pure 2D geometry helpers used by layout generation and its queries.
import type { BuildingSpec, Side, Vec2 } from './types';

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** GLSL-style smoothstep; works for edge0 > edge1 as well. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Local offset (lx, lz) in a frame rotated by rotY (three.js rotation.y) → world offset. */
export function toWorld(lx: number, lz: number, rotY: number): Vec2 {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  return { x: c * lx + s * lz, z: -s * lx + c * lz };
}

/** Inverse of `toWorld`: world offset → local offset. */
export function toLocal(wx: number, wz: number, rotY: number): Vec2 {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  return { x: c * wx - s * wz, z: s * wx + c * wz };
}

/** Oriented rectangle in the XZ plane. */
export interface Obb {
  x: number;
  z: number;
  /** Half extents along the local axes. */
  hw: number;
  hd: number;
  rotY: number;
}

/** A building's ground footprint as an OBB. */
export function footprintObb(b: BuildingSpec): Obb {
  return { x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, rotY: b.rotY };
}

export function obbCorners(o: Obb): Vec2[] {
  const out: Vec2[] = [];
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const p = toWorld(sx * o.hw, sz * o.hd, o.rotY);
    out.push({ x: o.x + p.x, z: o.z + p.z });
  }
  return out;
}

export function obbBounds(o: Obb): { minX: number; minZ: number; maxX: number; maxZ: number } {
  const c = Math.abs(Math.cos(o.rotY));
  const s = Math.abs(Math.sin(o.rotY));
  const ex = c * o.hw + s * o.hd;
  const ez = s * o.hw + c * o.hd;
  return { minX: o.x - ex, minZ: o.z - ez, maxX: o.x + ex, maxZ: o.z + ez };
}

/** Separating-axis overlap test with a margin (positive margin = must be at least that far apart). */
export function obbOverlap(a: Obb, b: Obb, margin = 0): boolean {
  // Local axes in world space: u = toWorld(1, 0) = (c, -s), v = toWorld(0, 1) = (s, c).
  const ac = Math.cos(a.rotY);
  const as = Math.sin(a.rotY);
  const bc = Math.cos(b.rotY);
  const bs = Math.sin(b.rotY);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const separated = (x: number, z: number): boolean => {
    const ra = a.hw * Math.abs(ac * x - as * z) + a.hd * Math.abs(as * x + ac * z);
    const rb = b.hw * Math.abs(bc * x - bs * z) + b.hd * Math.abs(bs * x + bc * z);
    return Math.abs(dx * x + dz * z) >= ra + rb + margin;
  };
  return !(separated(ac, -as) || separated(as, ac) || separated(bc, -bs) || separated(bs, bc));
}

/** Parameter t in [0, 1] of the point on segment ab closest to p (0 for a zero-length segment). */
export function closestSegmentT(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  return len2 > 0 ? clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / len2, 0, 1) : 0;
}

export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const t = closestSegmentT(p, a, b);
  return Math.hypot(p.x - (a.x + (b.x - a.x) * t), p.z - (a.z + (b.z - a.z) * t));
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const cross = (o: Vec2, p: Vec2, q: Vec2): number =>
    (p.x - o.x) * (q.z - o.z) - (p.z - o.z) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Exact distance between an OBB (as a filled rectangle) and segment ab; 0 when they touch. */
export function obbSegmentDistance(o: Obb, a: Vec2, b: Vec2): number {
  const la = toLocal(a.x - o.x, a.z - o.z, o.rotY);
  const lb = toLocal(b.x - o.x, b.z - o.z, o.rotY);
  const inside = (p: Vec2): boolean => Math.abs(p.x) <= o.hw && Math.abs(p.z) <= o.hd;
  if (inside(la) || inside(lb)) return 0;
  const c: Vec2[] = [
    { x: -o.hw, z: -o.hd },
    { x: o.hw, z: -o.hd },
    { x: o.hw, z: o.hd },
    { x: -o.hw, z: o.hd },
  ];
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const p = c[i] as Vec2;
    const q = c[(i + 1) % 4] as Vec2;
    if (segmentsIntersect(la, lb, p, q)) return 0;
    best = Math.min(best, pointSegmentDistance(p, la, lb));
  }
  // Distance from the segment end points to the rectangle.
  for (const p of [la, lb]) {
    const dx = Math.max(Math.abs(p.x) - o.hw, 0);
    const dz = Math.max(Math.abs(p.z) - o.hd, 0);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

/** Even-odd point in polygon. */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Vec2;
    const b = poly[j] as Vec2;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Outward unit normal of a local side, in world space. */
export function sideNormal(side: Side, rotY: number): Vec2 {
  switch (side) {
    case 'px':
      return toWorld(1, 0, rotY);
    case 'nx':
      return toWorld(-1, 0, rotY);
    case 'pz':
      return toWorld(0, 1, rotY);
    case 'nz':
      return toWorld(0, -1, rotY);
  }
}

/** FNV-1a 32-bit hash of a string (for layout snapshots and stable sub-seeds). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
