// Pure queries over a generated Layout (ART_DIRECTION 2.6). Per-layout indices are built
// lazily and cached in WeakMaps, so calling these never mutates the layout itself.
import { fbm1 } from './noise';
import {
  footprintObb,
  obbBounds,
  obbOverlap,
  pointSegmentDistance,
  sideNormal,
  toLocal,
} from './math';
import { highwaySamples } from './highways';
import { GridHash, boundsOverlap, segmentBounds, type Bounds } from './spatial';
import type { BuildingFace, BuildingSpec, Layout, Ridge, Side, Tier, Vec2, Vec3 } from './types';

export type Vec3Like = Readonly<Vec3>;

const buildingHashes = new WeakMap<Layout, GridHash>();
function buildingHash(L: Layout): GridHash {
  let h = buildingHashes.get(L);
  if (!h) {
    h = new GridHash();
    for (const b of L.buildings) h.insert(b.id, obbBounds(footprintObb(b)));
    buildingHashes.set(L, h);
  }
  return h;
}

/** Ids of buildings whose footprint overlaps the axis-aligned rectangle (64 m spatial hash). */
export function buildingsInAabb(
  L: Layout,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): number[] {
  const q: Bounds = { minX, minZ, maxX, maxZ };
  const box = {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    hw: (maxX - minX) / 2,
    hd: (maxZ - minZ) / 2,
    rotY: 0,
  };
  return buildingHash(L)
    .query(q)
    .filter((id) => {
      const b = L.buildings[id] as BuildingSpec;
      const o = footprintObb(b);
      return boundsOverlap(obbBounds(o), q) && obbOverlap(o, box, -1e-9);
    });
}

/** All tiers of a building (both stacks for twin towers). */
export function allTiers(b: BuildingSpec): Tier[] {
  return b.twin ? [...b.tiers, ...b.twin] : b.tiers;
}

/** World y of the highest point (spire included). */
export function buildingTop(b: BuildingSpec): number {
  return b.baseY + b.h + b.spireH;
}

function insideTier(b: BuildingSpec, t: Tier, x: number, y: number, z: number): boolean {
  if (y < t.y0 || y > t.y1) return false;
  if (t.shape === 'cylinder') return Math.hypot(x - t.x, z - t.z) <= t.w / 2;
  const l = toLocal(x - t.x, z - t.z, b.rotY);
  return Math.abs(l.x) <= t.w / 2 && Math.abs(l.z) <= t.d / 2;
}

/** Id of the building whose tier volume contains the point, or null (camera collision). */
export function buildingContaining(L: Layout, x: number, y: number, z: number): number | null {
  for (const id of buildingHash(L).query({ minX: x, minZ: z, maxX: x, maxZ: z })) {
    const b = L.buildings[id] as BuildingSpec;
    if (allTiers(b).some((t) => insideTier(b, t, x, y, z))) return id;
  }
  return null;
}

function rayTier(b: BuildingSpec, t: Tier, o: Vec3Like, d: Vec3Like): number {
  if (t.shape === 'cylinder') {
    const ox = o.x - t.x;
    const oz = o.z - t.z;
    const r = t.w / 2;
    let best = Infinity;
    const a = d.x * d.x + d.z * d.z;
    if (a > 1e-12) {
      const bq = 2 * (ox * d.x + oz * d.z);
      const c = ox * ox + oz * oz - r * r;
      const disc = bq * bq - 4 * a * c;
      if (disc >= 0) {
        const s = Math.sqrt(disc);
        for (const k of [(-bq - s) / (2 * a), (-bq + s) / (2 * a)]) {
          const y = o.y + d.y * k;
          if (k >= 0 && y >= t.y0 && y <= t.y1) best = Math.min(best, k);
        }
      }
    }
    if (Math.abs(d.y) > 1e-12) {
      for (const y of [t.y0, t.y1]) {
        const k = (y - o.y) / d.y;
        if (k >= 0 && Math.hypot(ox + d.x * k, oz + d.z * k) <= r) best = Math.min(best, k);
      }
    }
    return best;
  }
  // Box (chamfers ignored): slab test in the building's local frame.
  const lo = toLocal(o.x - t.x, o.z - t.z, b.rotY);
  const ld = toLocal(d.x, d.z, b.rotY);
  const axes: [number, number, number, number][] = [
    [lo.x, ld.x, -t.w / 2, t.w / 2],
    [o.y, d.y, t.y0, t.y1],
    [lo.z, ld.z, -t.d / 2, t.d / 2],
  ];
  let t0 = 0;
  let t1 = Infinity;
  for (const [p, v, min, max] of axes) {
    if (Math.abs(v) < 1e-12) {
      if (p < min || p > max) return Infinity;
      continue;
    }
    let a = (min - p) / v;
    let c = (max - p) / v;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/**
 * Nearest building hit by the ray (dir need not be normalized; `t` is in units of dir).
 * Tests every tier as an OBB or cylinder.
 */
export function raycastBuildings(
  L: Layout,
  origin: Vec3Like,
  dir: Vec3Like,
): { id: number; t: number } | null {
  let best: { id: number; t: number } | null = null;
  for (const b of L.buildings) {
    for (const t of allTiers(b)) {
      const k = rayTier(b, t, origin, dir);
      if (k < (best?.t ?? Infinity)) best = { id: b.id, t: k };
    }
  }
  return best;
}

const SIDES: readonly Side[] = ['px', 'nx', 'pz', 'nz'];

/** Wall faces of every tier, for sign placement. Pure function of the spec. */
export function buildingFaces(b: BuildingSpec): BuildingFace[] {
  const out: BuildingFace[] = [];
  const stacks: [0 | 1, Tier[]][] = [[0, b.tiers]];
  if (b.twin) stacks.push([1, b.twin]);
  for (const [stack, tiers] of stacks) {
    tiers.forEach((t, ti) => {
      for (const side of SIDES) {
        const n = sideNormal(side, b.rotY);
        const alongX = side === 'px' || side === 'nx';
        const half = alongX ? t.w / 2 : t.d / 2;
        let width = alongX ? t.d : t.w;
        if (t.shape === 'cylinder') width = t.w * 0.5;
        if (t.shape === 'chamfer') width -= 2 * t.chamfer;
        out.push({
          building: b.id,
          tier: ti,
          stack,
          side,
          center: { x: t.x + n.x * half, y: (t.y0 + t.y1) / 2, z: t.z + n.z * half },
          normal: n,
          tangent: { x: n.z, z: -n.x },
          width,
          y0: t.y0,
          y1: t.y1,
          street: side === b.front,
          shape: t.shape,
        });
      }
    });
  }
  return out;
}

// --- decks (highways + bridges) ---

interface DeckSeg {
  a: Vec3;
  b: Vec3;
  half: number;
}
const deckCache = new WeakMap<Layout, DeckSeg[]>();
function deckSegments(L: Layout): DeckSeg[] {
  let segs = deckCache.get(L);
  if (!segs) {
    segs = [];
    for (const hw of L.highways) {
      const s = highwaySamples(hw, 4);
      for (let i = 0; i < s.length - 1; i++) {
        segs.push({ a: s[i] as Vec3, b: s[i + 1] as Vec3, half: hw.width / 2 });
      }
    }
    deckCache.set(L, segs);
  }
  return segs;
}

/**
 * Highest deck surface (highway, ramp, bridge or bridge approach) over (x, z), or null.
 * Used for camera clamps and snapping presets onto decks.
 */
export function deckHeightAt(L: Layout, x: number, z: number): number | null {
  const p: Vec2 = { x, z };
  let best: number | null = null;
  const take = (y: number): void => {
    if (best === null || y > best) best = y;
  };
  for (const s of deckSegments(L)) {
    if (!boundsOverlap(segmentBounds(s.a, s.b, s.half), { minX: x, minZ: z, maxX: x, maxZ: z })) {
      continue;
    }
    if (pointSegmentDistance(p, s.a, s.b) > s.half) continue;
    const abx = s.b.x - s.a.x;
    const abz = s.b.z - s.a.z;
    const len2 = abx * abx + abz * abz || 1;
    const t = Math.min(1, Math.max(0, ((x - s.a.x) * abx + (z - s.a.z) * abz) / len2));
    take(s.a.y + (s.b.y - s.a.y) * t);
  }
  for (const br of L.bridges) {
    if (pointSegmentDistance(p, br.landA, br.landB) > br.width / 2) continue;
    const mid = { x: (br.a.x + br.b.x) / 2, z: (br.a.z + br.b.z) / 2 };
    const ax = br.landB.x - br.landA.x;
    const az = br.landB.z - br.landA.z;
    const len = Math.hypot(ax, az);
    const s = Math.abs(((x - mid.x) * ax + (z - mid.z) * az) / len);
    const spanHalf = Math.hypot(br.b.x - br.a.x, br.b.z - br.a.z) / 2;
    const ramp = len / 2 - spanHalf;
    take(s <= spanHalf ? br.deckY : br.deckY * Math.max(0, 1 - (s - spanHalf) / ramp));
  }
  return best;
}

// --- far ridges ---

/**
 * Ridge silhouette height (m above y = 0) at a bearing around the city center.
 * `angle` = atan2(z, x); north (-Z) is the highest side. Seamless over 2π.
 */
export function ridgeHeight(r: Ridge, angle: number): number {
  const north = (1 - Math.sin(angle)) / 2;
  const peak = r.peakSouth + (r.peakNorth - r.peakSouth) * north;
  const u = ((((angle / (Math.PI * 2)) % 1) + 1) % 1) * 16;
  const n = fbm1(u, r.seed, 4, 16);
  return peak * Math.min(1, Math.pow(n / 0.8, 1.6));
}

/** World position of a point on a ridge ring at `angle` (top of the silhouette). */
export function ridgePoint(r: Ridge, angle: number): Vec3 {
  return { x: Math.cos(angle) * r.radius, y: ridgeHeight(r, angle), z: Math.sin(angle) * r.radius };
}
