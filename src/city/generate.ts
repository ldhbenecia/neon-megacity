// Layout v2 generator (ART_DIRECTION 2.6 pipeline):
// zones → rotated road grids clipped by zone / river / corridors → blocks → lots →
// archetype draw → tiers → tags → street slots. Pure and deterministic per seed.
import { createRng, type Rng } from '../core/random';
import {
  CORPS,
  FLOOR_H,
  computeTiers,
  fictionalName,
  floorsFor,
  weighted,
  type Massing,
} from './archetypes';
import { ZONES, zoneAt, zoneById } from './districts';
import {
  MAX_DECK_THICKNESS,
  MIN_ROAD_CLEARANCE,
  bridgeDeckY,
  highwaySamples,
  makeBridges,
  makeHighways,
  onBridge,
} from './highways';
import {
  clamp,
  closestSegmentT,
  footprintObb,
  hashString,
  obbBounds,
  obbCorners,
  obbOverlap,
  obbSegmentDistance,
  toLocal,
  toWorld,
  type Obb,
} from './math';
import {
  RIVER,
  TERRAIN,
  riverFrame,
  riverSignedDistance,
  surfaceHeight,
  terrainHeight,
} from './river';
import { GridHash, segmentBounds } from './spatial';
import type {
  Archetype,
  Block,
  Bridge,
  BuildingSpec,
  DistrictZone,
  Layout,
  Ridge,
  Road,
  RoadKind,
  Side,
  SlotKind,
  StreetSlot,
  Vec2,
} from './types';

export const EXTENT = 2400;
/** Skyline peak (ART_DIRECTION 2.2): the tallest tower stands near here. */
export const SKYLINE_PEAK: Vec2 = { x: -60, z: -380 };
/** Megatower threshold and fixed top heights. */
export const MEGA_MIN_H = 250;
const MEGA_COUNT = 10;
const MEGA_TOP = [520, 470, 455] as const;
/** Core blocks whose center is within this distance of the peak get megatower-sized lots. */
const CORE_MEGA_RADIUS = 200;
/** Height caps for non-megatower buildings, applied after the neighbour rule. */
const HEIGHT_CAP: Partial<Record<string, number>> = { core: 245, midtown: 210, sangga: 70 };
/** Building must keep this far from the channel edge (riverSignedDistance). */
export const RIVER_CLEARANCE = 5;

const zoneRng = (seed: number, key: string): Rng => createRng((seed ^ hashString(key)) >>> 0);

// ---------------------------------------------------------------------------
// Obstacles (capsules: segment + half width) that lots must not touch.

interface Capsule {
  a: Vec2;
  b: Vec2;
  half: number;
}

class Obstacles {
  readonly list: Capsule[] = [];
  readonly hash = new GridHash();
  add(a: Vec2, b: Vec2, half: number): void {
    this.hash.insert(this.list.length, segmentBounds(a, b, half));
    this.list.push({ a, b, half });
  }
  blocked(o: Obb): boolean {
    for (const i of this.hash.query(obbBounds(o))) {
      const c = this.list[i] as Capsule;
      if (obbSegmentDistance(o, c.a, c.b) < c.half) return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Roads

/** Local (u, v) in a zone's grid frame → world. */
function gridToWorld(zone: DistrictZone, u: number, v: number): Vec2 {
  const o = toWorld(u, v, zone.gridAngle);
  return { x: zone.origin.x + o.x, z: zone.origin.z + o.z };
}

function gridRange(zone: DistrictZone): { u0: number; u1: number; v0: number; v1: number } {
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const p of zone.polygon) {
    const l = toLocal(p.x - zone.origin.x, p.z - zone.origin.z, zone.gridAngle);
    u0 = Math.min(u0, l.x);
    u1 = Math.max(u1, l.x);
    v0 = Math.min(v0, l.z);
    v1 = Math.max(v1, l.z);
  }
  return { u0, u1, v0, v1 };
}

const ROAD_STEP = 4;

/** Clip a grid line (local u or v = `fixed`, t0..t1 along the other axis) to the zone. */
function clipLine(
  zone: DistrictZone,
  fixed: number,
  along: 'u' | 'v',
  t0: number,
  t1: number,
  bridges: readonly Bridge[],
): { a: Vec2; b: Vec2 }[] {
  const runs: { a: Vec2; b: Vec2 }[] = [];
  const half = zone.roadWidth / 2 + 1;
  let start: number | null = null;
  const at = (t: number): Vec2 =>
    along === 'v' ? gridToWorld(zone, fixed, t) : gridToWorld(zone, t, fixed);
  const n = Math.ceil((t1 - t0) / ROAD_STEP);
  for (let i = 0; i <= n + 1; i++) {
    const t = t0 + i * ROAD_STEP;
    const p = at(t);
    const inside =
      i <= n && zoneAt(p.x, p.z).id === zone.id && !underLowDeck(bridges, p.x, p.z, half);
    if (inside && start === null) start = t;
    if (!inside && start !== null) {
      const end = t - ROAD_STEP;
      if (end - start >= 8) runs.push({ a: at(start), b: at(end) });
      start = null;
    }
  }
  return runs;
}

/**
 * True where a road of half width `half` at (x, z) would pass under a bridge approach with less
 * than MIN_ROAD_CLEARANCE (assuming the thickest allowed deck). Roads stop short of those spots.
 */
function underLowDeck(bridges: readonly Bridge[], x: number, z: number, half: number): boolean {
  for (const br of bridges) {
    // The road strip spans ±half around (x, z); check its centre and both edges along the
    // bridge axis, where the approach deck is lowest on the landing side.
    const ax = br.landB.x - br.landA.x;
    const az = br.landB.z - br.landA.z;
    const len = Math.hypot(ax, az);
    for (const k of [0, -half, half]) {
      const y = bridgeDeckY(br, x + (ax / len) * k, z + (az / len) * k, half);
      if (y !== null && y - MAX_DECK_THICKNESS < MIN_ROAD_CLEARANCE) return true;
    }
  }
  return false;
}

function buildRoads(seed: number, bridges: readonly Bridge[]): Road[] {
  const roads: Road[] = [];
  const push = (kind: RoadKind, a: Vec2, b: Vec2, width: number, zone: DistrictZone): void => {
    roads.push({ id: roads.length, kind, a, b, width, district: zone.kind, zoneId: zone.id });
  };
  for (const zone of ZONES) {
    if (zone.kind === 'riverside') continue;
    const rng = zoneRng(seed, `roads:${zone.id}`);
    const { u0, u1, v0, v1 } = gridRange(zone);
    const P = zone.roadPitch;
    const Q = zone.roadPitchV;
    const hill = zone.kind === 'hillside';
    // Lines of constant u run along v (for hillside: uphill, roughly north-south).
    for (let i = Math.floor(u0 / P); i <= Math.ceil(u1 / P); i++) {
      for (const { a, b } of clipLine(zone, i * P, 'v', v0, v1, bridges)) {
        if (!hill) {
          push(zone.roadKind, a, b, zone.roadWidth, zone);
          continue;
        }
        // Split uphill alleys per block; ~9% become stairs (계단).
        const la = toLocal(a.x - zone.origin.x, a.z - zone.origin.z, zone.gridAngle).z;
        const lb = toLocal(b.x - zone.origin.x, b.z - zone.origin.z, zone.gridAngle).z;
        const lo = Math.min(la, lb);
        const hi = Math.max(la, lb);
        let s = lo;
        while (s < hi - 1) {
          const e = Math.min(hi, (Math.floor(s / Q + 1e-6) + 1) * Q);
          if (e - s >= 8) {
            const stair = rng.chance(0.09);
            push(
              stair ? 'stair' : 'alley',
              gridToWorld(zone, i * P, s),
              gridToWorld(zone, i * P, e),
              stair ? 2.5 : zone.roadWidth,
              zone,
            );
          }
          s = e;
        }
      }
    }
    for (let j = Math.floor(v0 / Q); j <= Math.ceil(v1 / Q); j++) {
      for (const { a, b } of clipLine(zone, j * Q, 'u', u0, u1, bridges)) {
        push(zone.roadKind, a, b, zone.roadWidth, zone);
      }
    }
  }
  // Bridge approach avenues continue 150 m into the districts on both banks.
  for (const br of bridges) {
    for (const [land, abut] of [
      [br.landA, br.a],
      [br.landB, br.b],
    ] as const) {
      const dx = land.x - abut.x;
      const dz = land.z - abut.z;
      const len = Math.hypot(dx, dz);
      const end = { x: land.x + (dx / len) * 150, z: land.z + (dz / len) * 150 };
      const mid = { x: (land.x + end.x) / 2, z: (land.z + end.z) / 2 };
      push('arterial', land, end, br.width, zoneAt(mid.x, mid.z));
    }
  }
  return roads;
}

// ---------------------------------------------------------------------------
// Lots

interface Lot {
  obb: Obb;
  zone: DistrictZone;
  blockId: number;
}

const SIDEWALK: Record<string, number> = {
  core: 4,
  midtown: 4,
  sangga: 2,
  hillside: 1,
  apartment: 6,
  industrial: 4,
};

const SANGGA_ALLEY = 5;
/** Hillside lot occupancy: low slope + ridge floor (see draftsFor). */
const HILL_OCCUPANCY_LOW = 0.8;
const HILL_OCCUPANCY_TOP = 0.05;

interface LotCell {
  /** Grid index inside the block. */
  i: number;
  j: number;
  /** Center and size in the block's local frame. */
  u: number;
  v: number;
  w: number;
  d: number;
}

/** Local lot rectangles (center u, v and size) inside a block centered at 0. */
function lotGrid(
  kind: DistrictZone['kind'] | 'coreDense',
  bw: number,
  bd: number,
  rng: Rng,
): LotCell[] {
  const cells = (nu: number, nv: number, gapV = 0) => {
    const out: LotCell[] = [];
    const lw = bw / nu;
    const ld = (bd - gapV) / nv;
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const v = -bd / 2 + ld * (j + 0.5) + (j >= nv / 2 ? gapV : 0);
        out.push({ i, j, u: -bw / 2 + lw * (i + 0.5), v, w: lw, d: ld });
      }
    }
    return out;
  };
  switch (kind) {
    case 'coreDense':
      return cells(3, 3);
    case 'midtown':
      return rng.chance(0.5) ? cells(2, 2) : cells(3, 2);
    case 'sangga':
      return cells(3, 2, SANGGA_ALLEY);
    case 'apartment':
      return cells(Math.max(1, Math.floor(bw / 85)), 3);
    case 'hillside':
      // 별계단동 is the densest quarter: 4 × 4 lots of ~11 m per 45 m block.
      return cells(4, 4);
    default: // core (megatower lots), industrial
      return cells(2, 2);
  }
}

interface LocalRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/**
 * Largest index rectangle of accepted cells whose covering rectangle passes `ok`
 * (ties: first found, i.e. lowest indices). Returns its cells.
 */
function bestLotRect(
  grid: readonly LotCell[],
  accepted: ReadonlyMap<string, unknown>,
  ok: (r: LocalRect) => boolean,
): LotCell[] {
  const at = new Map(grid.map((g) => [`${g.i},${g.j}`, g]));
  const ni = Math.max(...grid.map((g) => g.i)) + 1;
  const nj = Math.max(...grid.map((g) => g.j)) + 1;
  let best: LotCell[] = [];
  for (let i0 = 0; i0 < ni; i0++) {
    for (let i1 = i0; i1 < ni; i1++) {
      for (let j0 = 0; j0 < nj; j0++) {
        for (let j1 = j0; j1 < nj; j1++) {
          const n = (i1 - i0 + 1) * (j1 - j0 + 1);
          if (n <= best.length) continue;
          const cells: LotCell[] = [];
          for (let i = i0; i <= i1; i++) {
            for (let j = j0; j <= j1; j++) {
              const k = `${i},${j}`;
              const g = at.get(k);
              if (g && accepted.has(k)) cells.push(g);
            }
          }
          if (cells.length !== n) continue;
          const r: LocalRect = { u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity };
          for (const g of cells) {
            r.u0 = Math.min(r.u0, g.u - g.w / 2);
            r.u1 = Math.max(r.u1, g.u + g.w / 2);
            r.v0 = Math.min(r.v0, g.v - g.d / 2);
            r.v1 = Math.max(r.v1, g.v + g.d / 2);
          }
          if (n === 1 || ok(r)) best = cells;
        }
      }
    }
  }
  return best;
}

/** Set a block's rectangle to the union of its lots (all share the block rotation). */
function fitBlockToLots(block: Block, own: readonly Lot[]): void {
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const l of own) {
    const c = toLocal(l.obb.x - block.x, l.obb.z - block.z, block.rotY);
    u0 = Math.min(u0, c.x - l.obb.hw);
    u1 = Math.max(u1, c.x + l.obb.hw);
    v0 = Math.min(v0, c.z - l.obb.hd);
    v1 = Math.max(v1, c.z + l.obb.hd);
  }
  const mid = toWorld((u0 + u1) / 2, (v0 + v1) / 2, block.rotY);
  block.x += mid.x;
  block.z += mid.z;
  block.w = u1 - u0;
  block.d = v1 - v0;
}

interface LotsResult {
  lots: Lot[];
  blocks: Block[];
  alleys: { a: Vec2; b: Vec2; zone: DistrictZone }[];
}

function buildLots(seed: number, obstacles: Obstacles, bridges: readonly Bridge[]): LotsResult {
  const lots: Lot[] = [];
  const blocks: Block[] = [];
  const alleys: LotsResult['alleys'] = [];
  const lotHash = new GridHash();
  const accept = (o: Obb, zone: DistrictZone): boolean => {
    for (const p of [...obbCorners(o), { x: o.x, z: o.z }]) {
      if (zoneAt(p.x, p.z).id !== zone.id) return false;
      if (riverSignedDistance(p.x, p.z) < RIVER_CLEARANCE) return false;
    }
    if (obstacles.blocked(o)) return false;
    for (const id of lotHash.query(obbBounds(o))) {
      if (obbOverlap((lots[id] as Lot).obb, o, -1e-6)) return false; // touching lots are fine
    }
    return true;
  };

  /** Local rectangle (u0..u1, v0..v1) around block center c is free of obstacles. */
  const clear = (c: Vec2, r: LocalRect, rotY: number): boolean => {
    const mid = toWorld((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2, rotY);
    return !obstacles.blocked({
      x: c.x + mid.x,
      z: c.z + mid.z,
      hw: (r.u1 - r.u0) / 2,
      hd: (r.v1 - r.v0) / 2,
      rotY,
    });
  };

  for (const zone of ZONES) {
    if (zone.kind === 'riverside') continue;
    const rng = zoneRng(seed, `lots:${zone.id}`);
    const { u0, u1, v0, v1 } = gridRange(zone);
    const P = zone.roadPitch;
    const Q = zone.roadPitchV;
    const walk = SIDEWALK[zone.kind] ?? 3;
    const bw = P - zone.roadWidth;
    const bd = Q - zone.roadWidth;
    for (let i = Math.floor(u0 / P); i < Math.ceil(u1 / P); i++) {
      for (let j = Math.floor(v0 / Q); j < Math.ceil(v1 / Q); j++) {
        const c = gridToWorld(zone, (i + 0.5) * P, (j + 0.5) * Q);
        if (zoneAt(c.x, c.z).id !== zone.id) continue;
        const block: Block = {
          id: blocks.length,
          zoneId: zone.id,
          district: zone.kind,
          x: c.x,
          z: c.z,
          w: bw,
          d: bd,
          rotY: zone.gridAngle,
          buildingIds: [],
        };
        const before = lots.length;
        // Core: big 2×2 lots near the skyline peak (megatowers), 3×3 elsewhere.
        const dense =
          zone.kind === 'core' &&
          Math.hypot(c.x - SKYLINE_PEAK.x, c.z - SKYLINE_PEAK.z) > CORE_MEGA_RADIUS;
        const grid = lotGrid(dense ? 'coreDense' : zone.kind, bw - 2 * walk, bd - 2 * walk, rng);
        const cand = new Map<string, Obb>();
        for (const g of grid) {
          const off = toWorld(g.u, g.v, zone.gridAngle);
          const obb: Obb = {
            x: c.x + off.x,
            z: c.z + off.z,
            hw: g.w / 2,
            hd: g.d / 2,
            rotY: zone.gridAngle,
          };
          if (accept(obb, zone)) cand.set(`${g.i},${g.j}`, obb);
        }
        // Keep the largest rectangle of surviving lots whose bounding rectangle is itself clear,
        // so the block never spans a corridor or the river where lots were removed.
        for (const g of bestLotRect(grid, cand, (r) => clear(c, r, zone.gridAngle))) {
          const obb = cand.get(`${g.i},${g.j}`) as Obb;
          lotHash.insert(lots.length, obbBounds(obb));
          lots.push({ obb, zone, blockId: block.id });
        }
        if (lots.length > before) {
          // Shrink the block to the lots that survived (corridors / river may have removed some).
          fitBlockToLots(block, lots.slice(before));
          blocks.push(block);
          // Mid-block alley, only along the lots that survived and only between two rows.
          const fit = toLocal(block.x - c.x, block.z - c.z, zone.gridAngle);
          if (zone.kind === 'sangga' && Math.abs(fit.z) + SANGGA_ALLEY / 2 < block.d / 2) {
            const a = toWorld(fit.x - block.w / 2, 0, zone.gridAngle);
            const b = toWorld(fit.x + block.w / 2, 0, zone.gridAngle);
            alleys.push({
              a: { x: c.x + a.x, z: c.z + a.z },
              b: { x: c.x + b.x, z: c.z + b.z },
              zone,
            });
          }
        }
      }
    }
  }

  // Riverside pavilions (매점, 펌프장): a thin row between the embankment and the highway corridor.
  const rng = zoneRng(seed, 'lots:riverside');
  const riverside = zoneById('riverside');
  for (const side of [-1, 1] as const) {
    for (let x = -1150; x <= 1150; x += 90) {
      if (!rng.chance(0.55)) continue;
      const f = riverFrame(x);
      const off = 129.5;
      const p = { x: f.p.x + f.south.x * off * side, z: f.p.z + f.south.z * off * side };
      if (onBridge(bridges, p, 30)) continue;
      const rotY = Math.atan2(-f.along.z, f.along.x);
      const obb: Obb = { x: p.x, z: p.z, hw: rng.range(3, 6), hd: rng.range(2, 3.5), rotY };
      if (!accept(obb, riverside)) continue;
      // Each pavilion is its own one-lot block.
      const blockId = blocks.length;
      blocks.push({
        id: blockId,
        zoneId: riverside.id,
        district: 'riverside',
        x: obb.x,
        z: obb.z,
        w: obb.hw * 2,
        d: obb.hd * 2,
        rotY,
        buildingIds: [],
      });
      lotHash.insert(lots.length, obbBounds(obb));
      lots.push({ obb, zone: riverside, blockId });
    }
  }
  return { lots, blocks, alleys };
}

// ---------------------------------------------------------------------------
// Buildings

interface Draft {
  lot: Lot;
  archetype: Archetype;
  w: number;
  d: number;
  h: number;
  /** Local offset of the footprint center inside the lot. */
  ox: number;
  oz: number;
  /** Extra rotation (sangga / hillside jitter). */
  jitter: number;
  /** Set only on megatowers. */
  corp?: string;
}

const CORE_MEGA_BAG: Archetype[] = [
  'setbackTower',
  'setbackTower',
  'setbackTower',
  'cylinderTower',
  'cylinderTower',
  'cylinderTower',
  'bracedTower',
  'bracedTower',
  'cantileverTower',
  'twinTower',
];

function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = t;
  }
  return arr;
}

/** Footprint for an archetype inside a lot of size lw × ld. */
function footprint(rng: Rng, a: Archetype, lw: number, ld: number): { w: number; d: number } {
  const f = rng.range(0.78, 0.92);
  switch (a) {
    case 'cylinderTower': {
      const dia = Math.min(lw, ld) * f;
      return { w: dia, d: dia };
    }
    case 'officeSlab': {
      const ratio = rng.range(2, 3);
      if (lw >= ld) {
        const w = lw * f;
        return { w, d: Math.min(w / ratio, ld * f) };
      }
      const d = ld * f;
      return { w: Math.min(d / ratio, lw * f), d };
    }
    case 'sangga':
      return { w: clamp(lw * 0.92, 8, 25), d: clamp(ld * 0.92, 8, 25) };
    case 'hillHouse': {
      const s = rng.range(6, 10);
      // 6–10 m houses; lots are ~11 m, so neighbours keep a 2–3 m+ alley between them.
      return { w: Math.min(s * rng.range(0.9, 1.1), lw * 0.8), d: Math.min(s, ld * 0.8) };
    }
    case 'warehouse':
      return { w: lw * rng.range(0.6, 0.9), d: ld * rng.range(0.6, 0.9) };
    case 'apartmentSlab':
      return { w: Math.min(rng.range(55, 90), lw * 0.95), d: rng.range(12, 14) };
    case 'pavilion':
      return { w: lw, d: ld };
    default:
      return { w: lw * f, d: ld * f };
  }
}

/** Gap kept between a footprint and its lot edge (m). */
const LOT_MARGIN = 0.05;

/**
 * Scale (≤ 1) that makes a w × d rectangle rotated by `rot` and offset by (ox, oz) fit inside
 * a lw × ld lot with LOT_MARGIN on every side.
 */
export function fitScale(
  w: number,
  d: number,
  rot: number,
  ox: number,
  oz: number,
  lw: number,
  ld: number,
): number {
  const c = Math.abs(Math.cos(rot));
  const sn = Math.abs(Math.sin(rot));
  const ex = w * c + d * sn;
  const ez = w * sn + d * c;
  const ax = lw - 2 * Math.abs(ox) - 2 * LOT_MARGIN;
  const az = ld - 2 * Math.abs(oz) - 2 * LOT_MARGIN;
  return Math.max(0, Math.min(1, ax / ex, az / ez));
}

function draftsFor(zone: DistrictZone, lots: Lot[], rng: Rng): Draft[] {
  const drafts: Draft[] = [];
  const make = (lot: Lot, archetype: Archetype, h: number, extra: Partial<Draft> = {}): Draft => {
    const lw = lot.obb.hw * 2;
    const ld = lot.obb.hd * 2;
    let { w, d } = footprint(rng, archetype, lw, ld);
    const jitterable = zone.kind === 'sangga' || zone.kind === 'hillside';
    const ox = jitterable ? rng.range(-1, 1) * Math.max(0, (lw - w) / 2 - 1) * 0.6 : 0;
    const oz = jitterable ? rng.range(-1, 1) * Math.max(0, (ld - d) / 2 - 1) * 0.6 : 0;
    const jitter = jitterable ? rng.range(-4, 4) * (Math.PI / 180) : 0;
    // Shrink so the rotated, offset footprint stays strictly inside its lot.
    const s = fitScale(w, d, jitter, ox, oz, lw, ld);
    w *= s;
    d *= s;
    return { lot, archetype, w, d, h, ox, oz, jitter, ...extra };
  };

  switch (zone.kind) {
    case 'core': {
      const perBlock = new Map<number, number>();
      let picked = 0;
      const big = lots
        .filter((l) => Math.min(l.obb.hw, l.obb.hd) * 2 >= 55)
        .sort(
          (a, b) =>
            Math.hypot(a.obb.x - SKYLINE_PEAK.x, a.obb.z - SKYLINE_PEAK.z) -
            Math.hypot(b.obb.x - SKYLINE_PEAK.x, b.obb.z - SKYLINE_PEAK.z),
        )
        .filter((l) => {
          // At most 3 megatowers per block so every block keeps one low building (ratio rule).
          const n = perBlock.get(l.blockId) ?? 0;
          if (n >= 3 || picked >= MEGA_COUNT) return false;
          perBlock.set(l.blockId, n + 1);
          picked++;
          return true;
        });
      const bag = shuffle(rng, [...CORE_MEGA_BAG]);
      // The 520 m landmark is a single slender tower: setback or cylinder.
      const lead = bag.findIndex((x) => x === 'setbackTower' || x === 'cylinderTower');
      [bag[0], bag[lead]] = [bag[lead] as Archetype, bag[0] as Archetype];
      const rest = Array.from({ length: Math.max(0, big.length - MEGA_TOP.length) }, () =>
        rng.range(MEGA_MIN_H + 10, 420),
      ).sort((a, b) => b - a);
      const heights = [...MEGA_TOP.slice(0, big.length), ...rest];
      const megaSet = new Set(big);
      big.forEach((lot, i) => {
        drafts.push(
          make(lot, bag[i % bag.length] as Archetype, heights[i] as number, {
            corp: CORPS[i % CORPS.length] as string,
          }),
        );
      });
      for (const lot of lots) {
        if (megaSet.has(lot)) continue;
        // Plaza / sunken square / ramp space, except next to megatowers (they need a podium).
        if (!perBlock.has(lot.blockId) && rng.chance(0.3)) continue;
        const a = weighted<Archetype>(rng, [
          ['setbackTower', 40],
          ['officeSlab', 30],
          ['bracedTower', 15],
          ['cylinderTower', 15],
        ]);
        drafts.push(make(lot, a, rng.range(120, 245)));
      }
      break;
    }
    case 'midtown':
      for (const lot of lots) {
        if (rng.chance(0.08)) continue;
        const a = weighted<Archetype>(rng, [
          ['officeSlab', 50],
          ['setbackTower', 30],
          ['bracedTower', 10],
          ['sangga', 10],
        ]);
        let h = a === 'sangga' ? sanggaHeight(rng) : rng.range(40, 140);
        if (a !== 'sangga' && rng.chance(0.15)) h *= 1.5;
        drafts.push(make(lot, a, h));
      }
      break;
    case 'sangga':
      for (const lot of lots) {
        if (rng.chance(0.15)) continue;
        const a = weighted<Archetype>(rng, [
          ['sangga', 85],
          ['officeSlab', 10],
          ['cylinderTower', 5],
        ]);
        const h =
          a === 'officeSlab'
            ? rng.range(45, 70)
            : a === 'cylinderTower'
              ? rng.range(15, 30)
              : sanggaHeight(rng);
        drafts.push(make(lot, a, h));
      }
      break;
    case 'apartment':
      for (const lot of lots) {
        if (rng.chance(0.1)) {
          drafts.push(make(lot, 'sangga', 4.2 + 3.3 * rng.int(1, 2)));
          continue;
        }
        // Row spacing 0.8..1.0 × height (ART_DIRECTION 4.2).
        const gap = lot.obb.hd * 2 - 13;
        const floors = clamp(Math.round((gap * rng.range(1.0, 1.25)) / 2.8), 15, 25);
        drafts.push(make(lot, 'apartmentSlab', floors * 2.8));
      }
      break;
    case 'industrial':
      for (const lot of lots) {
        if (rng.chance(0.1)) continue;
        drafts.push(make(lot, 'warehouse', rng.range(10, 30)));
      }
      break;
    case 'hillside':
      for (const lot of lots) {
        // Packed near the bottom of the slope (~85 % of lots built), thinning toward the ridge.
        const up = clamp(
          (TERRAIN.hillStartZ - lot.obb.z) / (TERRAIN.hillStartZ - TERRAIN.hillEndZ),
          0,
          1,
        );
        if (!rng.chance(HILL_OCCUPANCY_LOW * Math.pow(1 - up, 2.2) + HILL_OCCUPANCY_TOP)) continue;
        drafts.push(make(lot, 'hillHouse', 2.7 * rng.int(2, 4)));
      }
      break;
    case 'riverside':
      for (const lot of lots) drafts.push(make(lot, 'pavilion', rng.range(3, 8)));
      break;
    case 'megacore':
    case 'corridor':
    case 'oldtown':
    case 'palace':
    case 'brick':
    case 'nightlife':
    case 'showroom':
    case 'park':
      throw new Error(`layout v2 generator does not support zone kind ${zone.kind}`);
    default: {
      const unknown: never = zone.kind;
      throw new Error(`unknown zone kind ${String(unknown)}`);
    }
  }
  return drafts;
}

function sanggaHeight(rng: Rng): number {
  return 4.2 + 3.3 * (rng.int(4, 9) - 1);
}

/**
 * Height rules inside a block (ART_DIRECTION 2.2), applied in this order:
 * 1. ratio: tallest / lowest ≥ 3. The tallest is pinned and one "low" building is pushed to
 *    ≤ tallest / 3.
 * 2. neighbours: two footprints closer than NEIGHBOUR_GAP differ by more than 10 %. Non-megatower
 *    buildings other than the tallest are re-drawn: the low one inside [4.2, tallest / 3],
 *    the rest inside [4.2, min(cap, tallest)]. The tallest stays the max and the low one stays
 *    ≤ tallest / 3, so step 1 can never be undone. Pairs of megatowers are exempt (their heights
 *    are fixed landmarks).
 * Caps (HEIGHT_CAP) hold for every non-megatower at the end.
 */
const RATIO_KINDS = new Set(['core', 'midtown', 'sangga']);
const MIN_STOREY = 4.2;
/** Footprints closer than this (m) count as neighbours for the ±10 % rule. */
export const NEIGHBOUR_GAP = 4;

/** World footprint of a draft (same math as buildSpecs). */
function draftObb(d: Draft): Obb {
  const off = toWorld(d.ox, d.oz, d.lot.obb.rotY);
  return {
    x: d.lot.obb.x + off.x,
    z: d.lot.obb.z + off.z,
    hw: d.w / 2,
    hd: d.d / 2,
    rotY: d.lot.obb.rotY + d.jitter,
  };
}

/** True when two heights violate the ±10 % neighbour rule. */
export function tooSimilar(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.1 * Math.max(a, b);
}

function applyBlockHeightRules(drafts: Draft[], rng: Rng): void {
  const byBlock = new Map<number, Draft[]>();
  for (const d of drafts) {
    if (!RATIO_KINDS.has(d.lot.zone.kind)) continue;
    const list = byBlock.get(d.lot.blockId);
    if (list) list.push(d);
    else byBlock.set(d.lot.blockId, [d]);
  }
  for (const list of byBlock.values()) {
    const capOf = (d: Draft): number =>
      d.corp ? Infinity : (HEIGHT_CAP[d.lot.zone.kind] ?? Infinity);
    for (const d of list) d.h = Math.min(d.h, capOf(d));
    if (list.length < 2) continue;

    // 1. Ratio rule.
    const top = list.reduce((x, y) => (y.h > x.h ? y : x));
    const low = list.filter((d) => !d.corp && d !== top);
    if (low.length === 0) continue;
    // A single-storey shop (4.2 m) is the floor, so the tallest must reach at least 12.6 m.
    if (top.h < 3 * MIN_STOREY) top.h = Math.min(3 * MIN_STOREY + 1.5, capOf(top));
    const lowest = low.reduce((x, y) => (y.h < x.h ? y : x));
    if (top.h / lowest.h < 3) {
      lowest.h = Math.max(MIN_STOREY, (top.h / 3) * rng.range(0.6, 0.95));
      // Short sangga blocks get a 1–2 storey shop; tall blocks get a low podium building.
      if (lowest.archetype !== 'sangga' && lowest.h < 30) lowest.archetype = 'officeSlab';
    }

    // 2. Neighbour rule on spatially touching lots.
    const nbrs = list.map((a) =>
      list.filter((b) => b !== a && obbOverlap(draftObb(a), draftObb(b), NEIGHBOUR_GAP)),
    );
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (let i = 0; i < list.length; i++) {
        const d = list[i] as Draft;
        if (d.corp || d === top) continue;
        const around = nbrs[i] as Draft[];
        if (!around.some((n) => tooSimilar(n.h, d.h))) continue;
        const lo = MIN_STOREY;
        const hi = d === lowest ? top.h / 3 : Math.min(capOf(d), top.h);
        for (let k = 0; k < 32; k++) {
          // Stay close to the original draw first, then anywhere in range.
          const h = k < 16 ? clamp(d.h * rng.range(0.55, 1.5), lo, hi) : rng.range(lo, hi);
          if (!around.some((n) => tooSimilar(n.h, h))) {
            d.h = h;
            changed = true;
            break;
          }
        }
      }
      if (!changed) break;
    }
  }
}

/** Local side whose outward normal points most along the world direction (dx, dz). */
function sideToward(dx: number, dz: number, rotY: number): Side {
  const l = toLocal(dx, dz, rotY);
  if (Math.abs(l.x) > Math.abs(l.z)) return l.x > 0 ? 'px' : 'nx';
  return l.z > 0 ? 'pz' : 'nz';
}

/** Side facing the nearest road within `radius`, or null when there is none. */
function nearestRoadSide(
  roads: readonly Road[],
  roadHash: GridHash,
  x: number,
  z: number,
  rotY: number,
  radius: number,
): Side | null {
  let best = Infinity;
  let dir: Vec2 | null = null;
  const p = { x, z };
  const q = { minX: x - radius, minZ: z - radius, maxX: x + radius, maxZ: z + radius };
  for (const id of roadHash.query(q)) {
    const r = roads[id] as Road;
    const t = closestSegmentT(p, r.a, r.b);
    const cx = r.a.x + (r.b.x - r.a.x) * t;
    const cz = r.a.z + (r.b.z - r.a.z) * t;
    const dist = Math.hypot(x - cx, z - cz);
    if (dist < best) {
      best = dist;
      // Direction from the building to the closest point on the road.
      dir = { x: cx - x, z: cz - z };
    }
  }
  return dir ? sideToward(dir.x, dir.z, rotY) : null;
}

/** Street front: pavilions face the river, everything else the nearest real road. */
function frontSide(
  d: Draft,
  roads: readonly Road[],
  roadHash: GridHash,
  x: number,
  z: number,
  rotY: number,
): Side {
  if (d.archetype === 'pavilion') {
    const c = riverFrame(x).p;
    return sideToward(c.x - x, c.z - z, rotY);
  }
  return (
    nearestRoadSide(roads, roadHash, x, z, rotY, 80) ??
    nearestRoadSide(roads, roadHash, x, z, rotY, 600) ??
    'pz'
  );
}

function buildSpecs(
  seed: number,
  lots: Lot[],
  blocks: Block[],
  roads: readonly Road[],
  roadHash: GridHash,
): BuildingSpec[] {
  const drafts: Draft[] = [];
  for (const zone of ZONES) {
    const zl = lots.filter((l) => l.zone === zone);
    drafts.push(...draftsFor(zone, zl, zoneRng(seed, `drafts:${zone.id}`)));
  }
  const rng = zoneRng(seed, 'specs');
  applyBlockHeightRules(drafts, rng);

  const complexes = new Map<number, number>();
  const dongs = new Map<number, number>();
  return drafts.map((d, id): BuildingSpec => {
    const { lot } = d;
    const obb = draftObb(d);
    const { x, z, rotY } = obb;
    const baseY = Math.min(
      terrainHeight(x, z),
      ...obbCorners(obb).map((p) => terrainHeight(p.x, p.z)),
    );
    const [floorH, groundFloorH0] = FLOOR_H[d.archetype];
    const piloti = d.archetype === 'apartmentSlab' && rng.chance(0.3);
    const groundFloorH = piloti ? 5 : groundFloorH0;
    // Piloti slabs keep their floor count: a 5 m open ground floor plus 2.8 m floors.
    if (piloti) d.h = 5 + (Math.round(d.h / floorH) - 1) * floorH;
    const m: Massing = { x, z, w: d.w, d: d.d, h: d.h, rotY, baseY, archetype: d.archetype };
    const tr = computeTiers(m, rng, lot.zone.kind);
    const block = blocks[lot.blockId] as Block;
    block.buildingIds.push(id);

    const tags: BuildingSpec['tags'] = {
      storefront:
        d.archetype === 'sangga' ||
        d.archetype === 'pavilion' ||
        ((lot.zone.kind === 'core' || lot.zone.kind === 'midtown') && rng.chance(0.4)) ||
        (d.archetype === 'hillHouse' && rng.chance(0.1)),
      name: fictionalName(rng, d.archetype),
    };
    if (d.archetype === 'hillHouse' || d.archetype === 'sangga') {
      if (rng.chance(0.07)) tags.cross = true;
    }
    if (d.corp) {
      tags.corp = d.corp;
      tags.name = `${d.corp} 타워`;
    }
    if (d.archetype === 'apartmentSlab') {
      let n = complexes.get(lot.blockId);
      if (n === undefined) {
        n = complexes.size + 1;
        complexes.set(lot.blockId, n);
      }
      const dong = (dongs.get(lot.blockId) ?? 100) + 1;
      dongs.set(lot.blockId, dong);
      tags.complex = `새빛마을 ${n}단지`;
      tags.dong = dong;
      tags.name = `${tags.complex} ${dong}동`;
    }

    const spec: BuildingSpec = {
      id,
      x,
      z,
      w: d.w,
      d: d.d,
      h: d.h,
      rotY,
      baseY,
      district: lot.zone.kind,
      zoneId: lot.zone.id,
      blockId: lot.blockId,
      archetype: d.archetype,
      floorH,
      groundFloorH,
      floors: floorsFor(d.h, floorH, groundFloorH),
      tiers: tr.tiers,
      spireH: tr.spireH,
      front: frontSide(d, roads, roadHash, x, z, rotY),
      seed: Math.floor(rng.next() * 1e9),
      tags,
    };
    if (tr.twin) spec.twin = tr.twin;
    if (tr.skybridge) spec.skybridge = tr.skybridge;
    if (tr.cantilever) spec.cantilever = tr.cantilever;
    return spec;
  });
}

// ---------------------------------------------------------------------------
// Street slots (ART_DIRECTION 6.2)

function buildSlots(
  seed: number,
  roads: readonly Road[],
  buildings: readonly BuildingSpec[],
  bridges: readonly Bridge[],
  alleys: LotsResult['alleys'],
): StreetSlot[] {
  const rng = zoneRng(seed, 'slots');
  const hash = new GridHash();
  const footprints = buildings.map(footprintObb);
  footprints.forEach((o, id) => hash.insert(id, obbBounds(o)));
  const slots: StreetSlot[] = [];
  const free = (p: Vec2): boolean => {
    const probe: Obb = { x: p.x, z: p.z, hw: 0.8, hd: 0.8, rotY: 0 };
    for (const id of hash.query(obbBounds(probe))) {
      if (obbOverlap(footprints[id] as Obb, probe)) return false;
    }
    return Math.abs(p.x) < EXTENT / 2 && Math.abs(p.z) < EXTENT / 2;
  };
  const add = (kind: SlotKind, p: Vec2, rotY: number): void => {
    if (!free(p)) return;
    slots.push({ kind, x: p.x, z: p.z, y: surfaceHeight(p.x, p.z), rotY, seed: rng.int(0, 1e9) });
  };
  /** Points along a road at `offset` from its center line (side ±1). */
  const along = (r: Road, t: number, side: number, offset: number): Vec2 => {
    const dx = r.b.x - r.a.x;
    const dz = r.b.z - r.a.z;
    const len = Math.hypot(dx, dz);
    return {
      x: r.a.x + dx * t + (-dz / len) * offset * side,
      z: r.a.z + dz * t + (dx / len) * offset * side,
    };
  };
  const roadYaw = (r: Road): number => Math.atan2(-(r.b.z - r.a.z), r.b.x - r.a.x);

  let busAcc = 700;
  let signAcc = 0;
  for (const r of roads) {
    const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z);
    const yaw = roadYaw(r);
    const curb = r.width / 2 + 1.2;
    if (r.kind === 'stair') {
      for (let s = 4, k = 0; s < len; s += 9, k++) {
        add('stairLamp', along(r, s / len, k % 2 ? 1 : -1, r.width / 2 + 0.6), yaw);
      }
      continue;
    }
    if (r.kind !== 'arterial' && r.kind !== 'street') continue;
    const lightStep = r.kind === 'arterial' ? 50 : 120;
    for (let s = lightStep / 2, k = 0; s < len; s += lightStep, k++) {
      add('streetLight', along(r, s / len, k % 2 ? 1 : -1, curb), yaw);
    }
    if (r.district !== 'sangga') {
      const treeStep = r.district === 'apartment' || r.kind === 'arterial' ? 40 : 75;
      for (let s = treeStep / 3, k = 0; s < len; s += treeStep, k++) {
        add('tree', along(r, s / len, k % 2 ? -1 : 1, r.width / 2 + 2), yaw);
      }
    } else {
      signAcc += len;
      while (signAcc > 110) {
        signAcc -= 110;
        add('signPole', along(r, rng.range(0.1, 0.9), rng.chance(0.5) ? 1 : -1, curb - 0.4), yaw);
      }
    }
    busAcc += len;
    if (busAcc > 1500 && len > 80) {
      busAcc = 0;
      add('busStop', along(r, 0.5, 1, curb + 0.6), yaw);
    }
  }
  // 포장마차: riverside park strips and a few sangga alleys.
  for (const side of [-1, 1] as const) {
    for (let x = -1160; x <= 1160; x += 75) {
      if (!rng.chance(0.75)) continue;
      const f = riverFrame(x);
      const off = RIVER.width / 2 - 20;
      const p = { x: f.p.x + f.south.x * off * side, z: f.p.z + f.south.z * off * side };
      if (onBridge(bridges, p, 8)) continue;
      add('pojangmacha', p, Math.atan2(-f.along.z, f.along.x));
    }
  }
  for (const a of alleys) {
    if (!rng.chance(0.05)) continue;
    const t = rng.range(0.2, 0.8);
    add(
      'pojangmacha',
      { x: a.a.x + (a.b.x - a.a.x) * t, z: a.a.z + (a.b.z - a.a.z) * t },
      a.zone.gridAngle,
    );
  }
  return slots;
}

// ---------------------------------------------------------------------------

function makeRidges(seed: number): Ridge[] {
  const rng = zoneRng(seed, 'ridges');
  return [
    {
      id: 'ridge-near',
      radius: 2500,
      peakNorth: 260,
      peakSouth: 120,
      segments: 512,
      fog: 0.35,
      baseY: -50,
      seed: rng.int(1, 1e6),
      peaks: [],
    },
    {
      id: 'ridge-mid',
      radius: 4000,
      peakNorth: 450,
      peakSouth: 180,
      segments: 384,
      fog: 0.6,
      baseY: -50,
      seed: rng.int(1, 1e6),
      peaks: [],
    },
    {
      id: 'ridge-far',
      radius: 6000,
      peakNorth: 700,
      peakSouth: 240,
      segments: 256,
      fog: 0.8,
      baseY: -50,
      seed: rng.int(1, 1e6),
      peaks: [],
    },
  ];
}

export function generateLayout(seed = 2077): Layout {
  const bridges = makeBridges();
  const highways = makeHighways(bridges);
  const roads = buildRoads(seed, bridges);

  const obstacles = new Obstacles();
  for (const r of roads) obstacles.add(r.a, r.b, r.width / 2 + 0.5);
  for (const hw of highways) {
    const s = highwaySamples(hw, 8);
    for (let i = 0; i < s.length - 1; i++) {
      obstacles.add(s[i] as Vec2, s[i + 1] as Vec2, hw.corridorHalf);
    }
    for (const p of hw.pillars) obstacles.add(p, p, 3);
  }
  for (const b of bridges) obstacles.add(b.landA, b.landB, b.width / 2 + 3);
  const c = RIVER.centerline;
  for (let i = 0; i < c.length - 1; i++) {
    obstacles.add(c[i] as Vec2, c[i + 1] as Vec2, RIVER.width / 2 + RIVER_CLEARANCE);
  }

  const { lots, blocks, alleys } = buildLots(seed, obstacles, bridges);
  for (const a of alleys) {
    roads.push({
      id: roads.length,
      kind: 'alley',
      a: a.a,
      b: a.b,
      width: SANGGA_ALLEY,
      district: a.zone.kind,
      zoneId: a.zone.id,
    });
  }
  const roadHash = new GridHash();
  roads.forEach((r) => roadHash.insert(r.id, segmentBounds(r.a, r.b, r.width / 2)));
  const buildings = buildSpecs(seed, lots, blocks, roads, roadHash);
  const usedBlocks = blocks.filter((b) => b.buildingIds.length > 0);
  // Re-number blocks densely and point buildings at the new ids.
  usedBlocks.forEach((b, i) => {
    for (const id of b.buildingIds) (buildings[id] as BuildingSpec).blockId = i;
    b.id = i;
  });
  const slots = buildSlots(seed, roads, buildings, bridges, alleys);

  return {
    seed,
    extent: EXTENT,
    extentX: EXTENT,
    extentZ: EXTENT,
    districts: [...ZONES],
    river: {
      ...RIVER,
      centerline: RIVER.centerline.map((p) => ({ ...p })),
      widths: [...RIVER.widths],
      parkWidths: [...RIVER.parkWidths],
      samples: RIVER.samples.map((p) => ({ ...p })),
    },
    bridges,
    highways,
    ridges: makeRidges(seed),
    roads,
    blocks: usedBlocks,
    buildings,
    slots,
    islands: [],
    mountains: [],
    namedRoads: [],
    landmarks: [],
  };
}
