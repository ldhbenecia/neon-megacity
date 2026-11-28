// Pure queries over a generated Layout (ART_DIRECTION 2.6). Per-layout indices are built
// lazily and cached in WeakMaps, so calling these never mutates the layout itself.
import { fbm1 } from './noise';
import {
  closestSegmentT,
  footprintObb,
  obbBounds,
  obbOverlap,
  pointSegmentDistance,
  sideNormal,
  toLocal,
  type Obb,
} from './math';
import { bridgeDeckY, highwaySamples } from './highways';
import { terrainHeight } from './river';
import { GridHash, boundsOverlap, segmentBounds, type Bounds } from './spatial';
import type { BuildingFace, BuildingSpec, Layout, Ridge, Side, Tier, Vec2, Vec3 } from './types';

export type Vec3Like = Readonly<Vec3>;

interface BuildingIndex {
  hash: GridHash;
  /** Footprint OBB and its bounds per building id. */
  obbs: Obb[];
  bounds: Bounds[];
  /** Padded 3D bounds of all tiers per building: minX, minY, minZ, maxX, maxY, maxZ. */
  boxes: Float64Array;
}

const buildingIndices = new WeakMap<Layout, BuildingIndex>();
function buildingIndex(L: Layout): BuildingIndex {
  let idx = buildingIndices.get(L);
  if (!idx) {
    const hash = new GridHash();
    const obbs = L.buildings.map(footprintObb);
    const bounds = obbs.map(obbBounds);
    const boxes = new Float64Array(L.buildings.length * 6);
    const PAD = 1e-3;
    for (const b of L.buildings) {
      hash.insert(b.id, bounds[b.id] as Bounds);
      const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const t of buildingVolumes(b)) {
        const hd = t.shape === 'cylinder' ? t.w / 2 : t.d / 2;
        const o = obbBounds({ x: t.x, z: t.z, hw: t.w / 2, hd, rotY: b.rotY });
        box[0] = Math.min(box[0] as number, o.minX);
        box[1] = Math.min(box[1] as number, t.y0);
        box[2] = Math.min(box[2] as number, o.minZ);
        box[3] = Math.max(box[3] as number, o.maxX);
        box[4] = Math.max(box[4] as number, t.y1);
        box[5] = Math.max(box[5] as number, o.maxZ);
      }
      for (let k = 0; k < 6; k++) boxes[b.id * 6 + k] = (box[k] as number) + (k < 3 ? -PAD : PAD);
    }
    idx = { hash, obbs, bounds, boxes };
    buildingIndices.set(L, idx);
  }
  return idx;
}

/** Conservative ray / padded box test: false only when the ray cannot hit building `id`. */
function rayMayHitBox(boxes: Float64Array, id: number, o: Vec3Like, d: Vec3Like): boolean {
  let t0 = 0;
  let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    const pk = k === 0 ? o.x : k === 1 ? o.y : o.z;
    const vk = k === 0 ? d.x : k === 1 ? d.y : d.z;
    const min = boxes[id * 6 + k] as number;
    const max = boxes[id * 6 + 3 + k] as number;
    if (vk === 0) {
      if (pk < min || pk > max) return false;
      continue;
    }
    let a = (min - pk) / vk;
    let c = (max - pk) / vk;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return false;
  }
  return true;
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
  const { hash, obbs, bounds } = buildingIndex(L);
  return hash
    .query(q)
    .filter(
      (id) => boundsOverlap(bounds[id] as Bounds, q) && obbOverlap(obbs[id] as Obb, box, -1e-9),
    );
}

/** All tiers of a building (both stacks for twin towers). */
export function allTiers(b: BuildingSpec): Tier[] {
  return b.twin ? [...b.tiers, ...b.twin] : b.tiers;
}

/** Spire / antenna radius used for picking and collision (m). */
const SPIRE_RADIUS = 1.5;

/**
 * Every solid volume of a building as tier-like boxes / cylinders: both tier stacks, plus the
 * cantilever mass, the twin-tower skybridge and the spire. Used by picking and collision.
 */
export function buildingVolumes(b: BuildingSpec): Tier[] {
  const out = [...allTiers(b)];
  const top = b.tiers[b.tiers.length - 1];
  if (b.cantilever && top) {
    const c = b.cantilever;
    const alongX = c.side === 'px' || c.side === 'nx';
    const half = alongX ? top.w / 2 : top.d / 2;
    const n = sideNormal(c.side, b.rotY);
    const k = half + c.out / 2;
    out.push({
      x: top.x + n.x * k,
      z: top.z + n.z * k,
      w: alongX ? c.out : c.width,
      d: alongX ? c.width : c.out,
      y0: c.y0,
      y1: c.y1,
      shape: 'box',
      chamfer: 0,
    });
  }
  const a = b.tiers[0];
  const t = b.twin?.[0];
  if (b.skybridge && a && t) {
    // Stacks sit side by side along the local X axis; the bridge spans the gap between them.
    const gap = Math.hypot(t.x - a.x, t.z - a.z) - (a.w + t.w) / 2;
    out.push({
      x: (a.x + t.x) / 2,
      z: (a.z + t.z) / 2,
      w: Math.max(gap, 0) + 1,
      d: b.skybridge.width,
      y0: b.skybridge.y0,
      y1: b.skybridge.y1,
      shape: 'box',
      chamfer: 0,
    });
  }
  if (b.spireH > 0 && top) {
    out.push({
      x: top.x,
      z: top.z,
      w: SPIRE_RADIUS * 2,
      d: SPIRE_RADIUS * 2,
      y0: top.y1,
      y1: top.y1 + b.spireH,
      shape: 'cylinder',
      chamfer: 0,
    });
  }
  return out;
}

/** World y of the highest point (spire included). */
/** Street surface above the ground (m): just above it so it never z-fights the ground. */
export const ROAD_Y = 0.03;

/**
 * Height of the street surface at (x, z): the terrain plus ROAD_Y (ROAD_Y on flat ground).
 * Continuous everywhere, so crossings and slopes meet without steps. The single source for
 * roads, sidewalks and markings (buildings) and for traffic and street furniture (neon, which
 * uses surfaceHeight + ROAD_Y: the same value off the river channel). Raised stretches must be
 * drawn finely enough (buildings splits them every 3 m) to follow the ground mesh.
 */
export function roadSurfaceY(x: number, z: number): number {
  return terrainHeight(x, z) + ROAD_Y;
}

export function buildingTop(b: BuildingSpec): number {
  return b.baseY + b.h + b.spireH;
}

function insideTier(b: BuildingSpec, t: Tier, x: number, y: number, z: number): boolean {
  if (y < t.y0 || y > t.y1) return false;
  if (t.shape === 'cylinder') return Math.hypot(x - t.x, z - t.z) <= t.w / 2;
  const l = toLocal(x - t.x, z - t.z, b.rotY);
  return Math.abs(l.x) <= t.w / 2 && Math.abs(l.z) <= t.d / 2;
}

/**
 * Id of the building whose volume (tiers, cantilever, skybridge, spire) contains the point,
 * or null (camera collision).
 */
export function buildingContaining(L: Layout, x: number, y: number, z: number): number | null {
  for (const id of buildingIndex(L).hash.query({ minX: x, minZ: z, maxX: x, maxZ: z })) {
    const b = L.buildings[id] as BuildingSpec;
    if (buildingVolumes(b).some((t) => insideTier(b, t, x, y, z))) return id;
  }
  return null;
}

/** Ray parameter of the first hit with a volume; 0 when the origin is inside (box and cylinder alike). */
function rayTier(b: BuildingSpec, t: Tier, o: Vec3Like, d: Vec3Like): number {
  if (t.shape === 'cylinder') {
    if (insideTier(b, t, o.x, o.y, o.z)) return 0;
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
 * Tests every volume (`buildingVolumes`) as an OBB or cylinder; t = 0 when the origin is inside.
 */
export function raycastBuildings(
  L: Layout,
  origin: Vec3Like,
  dir: Vec3Like,
): { id: number; t: number } | null {
  const { boxes } = buildingIndex(L);
  let best: { id: number; t: number } | null = null;
  for (const b of L.buildings) {
    if (!rayMayHitBox(boxes, b.id, origin, dir)) continue;
    for (const t of buildingVolumes(b)) {
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

interface DeckSeg {
  a: Vec3;
  b: Vec3;
  half: number;
  bounds: Bounds;
}
interface DeckIndex {
  segs: DeckSeg[];
  hash: GridHash;
}
const deckCache = new WeakMap<Layout, DeckIndex>();
function deckIndex(L: Layout): DeckIndex {
  let idx = deckCache.get(L);
  if (!idx) {
    const segs: DeckSeg[] = [];
    for (const hw of L.highways) {
      const s = highwaySamples(hw, 4);
      for (let i = 0; i < s.length - 1; i++) {
        const a = s[i] as Vec3;
        const b = s[i + 1] as Vec3;
        const half = hw.width / 2;
        segs.push({ a, b, half, bounds: segmentBounds(a, b, half) });
      }
    }
    const hash = new GridHash();
    segs.forEach((sg, i) => hash.insert(i, sg.bounds));
    idx = { segs, hash };
    deckCache.set(L, idx);
  }
  return idx;
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
  const { segs, hash } = deckIndex(L);
  for (const i of hash.query({ minX: x, minZ: z, maxX: x, maxZ: z })) {
    const s = segs[i] as DeckSeg;
    const sb = s.bounds;
    if (x < sb.minX || x > sb.maxX || z < sb.minZ || z > sb.maxZ) continue;
    if (pointSegmentDistance(p, s.a, s.b) > s.half) continue;
    take(s.a.y + (s.b.y - s.a.y) * closestSegmentT(p, s.a, s.b));
  }
  for (const br of L.bridges) {
    const y = bridgeDeckY(br, x, z);
    if (y !== null) take(y);
  }
  return best;
}

/**
 * Ridge silhouette height (m above y = 0) at a bearing around the city center.
 * `angle` = atan2(z, x); north (-Z) is the highest side. Seamless over 2π.
 */
export function ridgeHeight(r: Ridge, angle: number): number {
  const north = (1 - Math.sin(angle)) / 2;
  const peak = r.peakSouth + (r.peakNorth - r.peakSouth) * north;
  const u = ((((angle / (Math.PI * 2)) % 1) + 1) % 1) * 16;
  const n = fbm1(u, r.seed, 4, 16);
  let h = peak * Math.min(1, Math.pow(n / 0.8, 1.6));
  // Named peaks (북한산, 관악산 …) rise above the noise profile as sharp bumps.
  for (const p of r.peaks) {
    const da = Math.atan2(Math.sin(angle - p.angle), Math.cos(angle - p.angle)) / p.width;
    h = Math.max(h, p.height * Math.exp(-da * da) * (0.85 + 0.15 * n));
  }
  return h;
}

/** World position of a point on a ridge ring at `angle` (top of the silhouette). */
export function ridgePoint(r: Ridge, angle: number): Vec3 {
  return { x: Math.cos(angle) * r.radius, y: ridgeHeight(r, angle), z: Math.sin(angle) * r.radius };
}
