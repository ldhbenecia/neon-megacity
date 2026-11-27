// Layout v3 generator (ART_DIRECTION 2.6 pipeline, Seoul zones from docs/SEOUL.md 4):
// named arterials + zones → rotated road grids clipped by zone / river / corridors → blocks → lots →
// archetype draw → tiers → tags → street slots. Pure and deterministic per seed.
import { CatmullRomCurve3, Vector3 } from 'three';
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
import { TEHERAN, ZONES, zoneAt, zoneBank, zoneById, zoneSide } from './districts';
import { makeNamedRoads } from './named';
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
  pointSegmentDistance,
  toLocal,
  toWorld,
  type Obb,
} from './math';
import {
  HALF_X,
  HALF_Z,
  ISLANDS,
  PALACE_RECT,
  TALL_GROUND,
  TALL_H,
  bankPoint,
  isForest,
  MOUNTAINS,
  RIVER,
  SAETGANG,
  parkWidthAt,
  riverFrame,
  riverOffset,
  riverWidthAt,
  riverSignedDistance,
  surfaceHeight,
  terrainHeight,
  waterClear,
} from './river';
import { GridHash, segmentBounds } from './spatial';
import type {
  Archetype,
  Block,
  Bridge,
  BuildingSpec,
  DistrictZone,
  Landmark,
  Layout,
  NamedRoad,
  SkyLane,
  Ridge,
  Road,
  RoadKind,
  Side,
  SlotKind,
  StreetSlot,
  Vec2,
} from './types';

/** Play area size (m). */
export const EXTENT_X = HALF_X * 2;
export const EXTENT_Z = HALF_Z * 2;
/** Skyline peak: the 용산 apex, the tallest tower of the city (SEOUL.md 4.5). */
export const SKYLINE_PEAK: Vec2 = { x: -380, z: -80 };
/** Megatower threshold. */
export const MEGA_MIN_H = 250;

interface TowerTier {
  count: number;
  /** Height range (m); the towers nearest the peak get the top of the range. */
  h: readonly [number, number];
  /** Footprint side range (m); always at least h / MAX_SLENDER. */
  size: readonly [number, number];
}

interface MegaPlan {
  peak: Vec2;
  /** Tiers placed outward from the peak, tallest first. The first tier is the landmark. */
  tiers: readonly TowerTier[];
  landmark: Landmark['id'];
}

/** Tallest allowed height / footprint width (√(w·d)) for any building. */
export const MAX_SLENDER = 10;

/** Tower clusters per megacore zone: one apex, then stepped tiers (SEOUL.md 4.5, 7.5). */
const MEGA: Record<string, MegaPlan> = {
  yongsan: {
    peak: SKYLINE_PEAK,
    tiers: [
      { count: 1, h: [600, 600], size: [80, 88] },
      { count: 6, h: [280, 450], size: [46, 54] },
      { count: 16, h: [120, 250], size: [26, 32] },
      { count: 18, h: [40, 110], size: [26, 40] },
    ],
    landmark: 'yongsan-apex',
  },
  yeouido: {
    peak: riverOffset(-1090, riverWidthAt(-1090) / 2 + 170),
    tiers: [
      { count: 1, h: [430, 430], size: [56, 62] },
      { count: 4, h: [300, 360], size: [40, 44] },
      { count: 18, h: [120, 220], size: [22, 28] },
      { count: 12, h: [40, 100], size: [24, 36] },
    ],
    landmark: 'yeouido-gold',
  },
  jamsil: {
    peak: { x: 1650, z: 330 },
    tiers: [
      { count: 1, h: [500, 500], size: [70, 78] },
      { count: 10, h: [150, 300], size: [34, 44] },
      { count: 16, h: [40, 110], size: [26, 40] },
    ],
    landmark: 'jamsil-blade',
  },
};

/** Building must keep this far from the channel edge (riverSignedDistance). */
export const RIVER_CLEARANCE = 5;

const zoneRng = (seed: number, key: string): Rng => createRng((seed ^ hashString(key)) >>> 0);

/** Obstacle capsule (segment + half width) that lots must not touch. */
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
      i <= n &&
      zoneAt(p.x, p.z).id === zone.id &&
      waterClear(p.x, p.z, half) &&
      !underLowDeck(bridges, p.x, p.z, half);
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
    const reach = br.width / 2 + 2 * half;
    if (
      x < Math.min(br.landA.x, br.landB.x) - reach ||
      x > Math.max(br.landA.x, br.landB.x) + reach
    ) {
      continue;
    }
    if (
      z < Math.min(br.landA.z, br.landB.z) - reach ||
      z > Math.max(br.landA.z, br.landB.z) + reach
    ) {
      continue;
    }
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

/** Zones that get a road grid and lots. */
function hasGrid(zone: DistrictZone): boolean {
  return zone.kind !== 'riverside' && zone.kind !== 'park' && zone.roadPitch > 0;
}

function buildRoads(seed: number, bridges: readonly Bridge[], named: readonly NamedRoad[]): Road[] {
  const roads: Road[] = [];
  const push = (kind: RoadKind, a: Vec2, b: Vec2, width: number, zone: DistrictZone): void => {
    roads.push({ id: roads.length, kind, a, b, width, district: zone.kind, zoneId: zone.id });
  };
  /**
   * Arterial a→b, cut where it would pass under a low approach of a bridge other than `own`
   * (named roads and avenues that start at a landing continue that bridge's deck).
   */
  const clipped = (a: Vec2, b: Vec2, width: number, own: (br: Bridge) => boolean): void => {
    const others = bridges.filter((br) => !own(br));
    const half = width / 2 + 1;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.ceil(len / ROAD_STEP);
    const at = (t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    let start: number | null = null;
    for (let k = 0; k <= n + 1; k++) {
      const p = at(Math.min(1, k / n));
      const ok = k <= n && waterClear(p.x, p.z, half) && !underLowDeck(others, p.x, p.z, half);
      if (ok && start === null) start = Math.min(1, k / n);
      if (!ok && start !== null) {
        const end = Math.max(start, (k - 1) / n);
        if ((end - start) * len >= 8) {
          const ra = at(start);
          const rb = at(end);
          push('arterial', ra, rb, width, zoneAt((ra.x + rb.x) / 2, (ra.z + rb.z) / 2));
        }
        start = null;
      }
    }
  };
  for (const nr of named) {
    for (let i = 0; i < nr.points.length - 1; i++) {
      const a = nr.points[i] as Vec2;
      const b = nr.points[i + 1] as Vec2;
      // Only the segment that starts or ends at a landing continues that bridge's deck.
      const own = (br: Bridge): boolean =>
        [a, b].some((e) => [br.landA, br.landB].some((l) => Math.hypot(l.x - e.x, l.z - e.z) < 1));
      clipped(a, b, nr.width, own);
    }
  }
  for (const zone of ZONES) {
    if (!hasGrid(zone)) continue;
    // Riverside apartment strips are laid out as slab rows along the bank (bankRows), and the
    // palace court as halls on its axis (palaceHalls), not as grids.
    if (zone.kind === 'apartment' && zoneBank(zone.id)) continue;
    if (zone.kind === 'palace') continue;
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
  // Road bridge approach avenues continue 90 m into the districts on both banks.
  for (const br of bridges) {
    if (br.motif === 'railTruss') continue; // rail only: no road continues
    for (const [land, abut] of [
      [br.landA, br.a],
      [br.landB, br.b],
    ] as const) {
      const dx = land.x - abut.x;
      const dz = land.z - abut.z;
      const len = Math.hypot(dx, dz);
      const end = { x: land.x + (dx / len) * 90, z: land.z + (dz / len) * 90 };
      clipped(land, end, br.width, (o) => o === br);
    }
  }
  return roads;
}

interface Lot {
  obb: Obb;
  zone: DistrictZone;
  blockId: number;
  /** Set on tower-field lots of a megacore: fixed height and tier (0 = landmark). */
  tower?: { h: number; tier: number };
  /** Set on 테헤란로 media-slab lots. */
  media?: boolean;
  /** Set on bank-row apartment lots: clear gap (m) to the next row toward the land. */
  rowGap?: number;
}

export const SIDEWALK: Record<string, number> = {
  core: 4,
  midtown: 4,
  sangga: 2,
  hillside: 1,
  apartment: 6,
  industrial: 4,
  megacore: 5,
  corridor: 4,
  oldtown: 2,
  palace: 10,
  brick: 2,
  nightlife: 1.5,
  showroom: 4,
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
    case 'corridor':
    case 'oldtown':
    case 'brick':
    case 'palace':
      return cells(3, 2);
    case 'nightlife':
      return cells(3, 2, SANGGA_ALLEY);
    case 'showroom':
      return cells(2, 2);
    case 'midtown':
      return rng.chance(0.5) ? cells(2, 2) : cells(3, 2);
    case 'sangga':
      return cells(3, 2, SANGGA_ALLEY);
    case 'apartment':
      // One slab row per ~90 m of depth so rows keep 0.8–1.0 × height apart (ART_DIRECTION 4.2).
      return cells(Math.max(1, Math.floor(bw / 85)), Math.max(1, Math.floor(bd / 90)));
    case 'hillside':
      // 별계단동 is the densest quarter: 4 × 4 lots of ~11 m per 45 m block.
      return cells(4, 4);
    default: // core / megacore (megatower lots), industrial
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
      if (!waterClear(p.x, p.z, RIVER_CLEARANCE)) return false;
      if (isForest(p.x, p.z)) return false;
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
    if (!hasGrid(zone)) continue;
    const rng = zoneRng(seed, `lots:${zone.id}`);
    const mega = MEGA[zone.id];
    if (mega) {
      // The tower field lays out the whole cluster (towers first, then podiums between them).
      towerField(zone, mega, zoneRng(seed, `towers:${zone.id}`));
      continue;
    }
    if (zone.kind === 'palace') {
      palaceHalls(zone);
      continue;
    }
    if (zone.kind === 'corridor') mediaRow(zone, rng);
    const bank = zoneBank(zone.id);
    if (bank && zone.kind === 'apartment') {
      bankRows(zone, bank, rng);
      continue;
    }
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
        // Megacore: the tower field took the big sites; the grid fills in with podium lots.
        const dense = zone.kind === 'megacore';
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
          const alleyed = zone.kind === 'sangga' || zone.kind === 'nightlife';
          if (alleyed && Math.abs(fit.z) + SANGGA_ALLEY / 2 < block.d / 2) {
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

  /**
   * Megacore towers: candidate sites every 10 m, nearest the peak first; each tier claims the
   * closest sites where a footprint of its size fits (zone, water, obstacles, ≥ 8 m from other
   * towers). Every tower is a one-lot block.
   */
  function towerField(zone: DistrictZone, plan: MegaPlan, rng: Rng): void {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of zone.polygon) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    const sites: (Vec2 & { r: number })[] = [];
    for (let x = x0; x <= x1; x += 10) {
      for (let z = z0; z <= z1; z += 10) {
        if (zoneAt(x, z).id !== zone.id) continue;
        sites.push({ x, z, r: Math.hypot(x - plan.peak.x, z - plan.peak.z) + rng.range(0, 6) });
      }
    }
    sites.sort((a, b) => a.r - b.r);
    const placed: Obb[] = [];
    // A site whose centre is under a placed tower can never host another; a site that rejected a
    // footprint (accept) rejects any footprint containing it (same centre and rotation, both half
    // extents at least as large), so those are skipped without testing.
    const dead = new Uint8Array(sites.length);
    const failW = new Float64Array(sites.length).fill(Infinity);
    const failD = new Float64Array(sites.length).fill(Infinity);
    plan.tiers.forEach((tier, t) => {
      const hs = Array.from({ length: tier.count }, () => rng.range(tier.h[0], tier.h[1])).sort(
        (a, b) => b - a,
      );
      // Each height takes the nearest site where its footprint fits; a height that fits nowhere
      // is skipped so the smaller ones after it still get their chance.
      for (const h of hs) {
        // The draft insets the lot by 4 % and the depth may be 15 % short: size for that.
        const side = Math.max(rng.range(tier.size[0], tier.size[1]), h / (MAX_SLENDER * 0.8));
        const depth = side * (t === 0 ? rng.range(0.95, 1) : rng.range(0.85, 1));
        for (let si = 0; si < sites.length; si++) {
          if (dead[si]) continue;
          if (side / 2 >= (failW[si] as number) && depth / 2 >= (failD[si] as number)) continue;
          const site = sites[si] as Vec2;
          const o: Obb = {
            x: site.x,
            z: site.z,
            hw: side / 2,
            hd: depth / 2,
            rotY: zone.gridAngle,
          };
          if (placed.some((q) => obbOverlap(q, o, TOWER_GAP))) continue;
          if (h > TALL_H && obbCorners(o).some((c) => terrainHeight(c.x, c.z) > TALL_GROUND))
            continue;
          if (!accept(o, zone)) {
            failW[si] = o.hw;
            failD[si] = o.hd;
            continue;
          }
          placed.push(o);
          sites.forEach((q, qi) => {
            const l = toLocal(q.x - o.x, q.z - o.z, o.rotY);
            if (Math.abs(l.x) < o.hw && Math.abs(l.z) < o.hd) dead[qi] = 1;
          });
          const blockId = blocks.length;
          blocks.push({
            id: blockId,
            zoneId: zone.id,
            district: zone.kind,
            x: o.x,
            z: o.z,
            w: o.hw * 2,
            d: o.hd * 2,
            rotY: o.rotY,
            buildingIds: [],
          });
          lotHash.insert(lots.length, obbBounds(o));
          lots.push({ obb: o, zone, blockId, tower: { h, tier: t } });
          break;
        }
      }
    });
  }

  /**
   * Riverside apartment walls (SEOUL.md 4.2): slab rows parallel to the bank at true bank
   * distances, from just outside the riverside band inland. Rows are ROW_PITCH apart, so a slab
   * may be as tall as the clear gap / 0.8 (ART_DIRECTION 4.2). Every slab is a one-lot block.
   */
  function bankRows(
    zone: DistrictZone,
    bank: { x0: number; x1: number; o0: number; o1: number },
    rng: Rng,
  ): void {
    const side = zoneSide(zone.id) === 'north' ? -1 : 1;
    const first = Math.max(bank.o0, RIVER.bandWidth) + 4 + SLAB_DEPTH / 2;
    for (let o = first; o + SLAB_DEPTH / 2 <= bank.o1; o += ROW_PITCH) {
      // Seed on the row as close to the middle of the strip (world x) as the normal offsets
      // reach (they bunch up or spread out on bends), then trace both ways.
      const mid = (bank.x0 + bank.x1) / 2;
      let seed: Vec2 | null = null;
      for (let x = bank.x0; x <= bank.x1; x += 10) {
        const p = bankPoint(x, side, o);
        if (p.x < bank.x0 || p.x > bank.x1) continue;
        if (!seed || Math.abs(p.x - mid) < Math.abs(seed.x - mid)) seed = p;
      }
      if (!seed) continue;
      const row = bankContour(seed, o, bank.x0, bank.x1);
      // Place slabs by arc length along the row: slab, gap, slab, …
      let s0 = rng.range(0, SLAB_GAP);
      const arc = [0];
      for (let i = 1; i < row.length; i++) {
        const a = row[i - 1] as Vec2;
        const b = row[i] as Vec2;
        arc.push((arc[i - 1] as number) + Math.hypot(b.x - a.x, b.z - a.z));
      }
      const at = (sx: number): Vec2 => {
        let i = 1;
        while (i < row.length - 1 && (arc[i] as number) < sx) i++;
        const a = row[i - 1] as Vec2;
        const b = row[i] as Vec2;
        const t = clamp(
          (sx - (arc[i - 1] as number)) / ((arc[i] as number) - (arc[i - 1] as number) || 1),
          0,
          1,
        );
        return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      };
      const total = arc[arc.length - 1] as number;
      while (s0 < total) {
        const want = rng.range(45, 70);
        if (s0 + want > total) break;
        const a = at(s0);
        const b = at(s0 + want);
        s0 += want + SLAB_GAP;
        const c = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const rotY = Math.atan2(-(b.z - a.z), b.x - a.x);
        const obb: Obb = { x: c.x, z: c.z, hw: len / 2, hd: SLAB_DEPTH / 2, rotY };
        if (!accept(obb, zone)) continue;
        const blockId = blocks.length;
        blocks.push({
          id: blockId,
          zoneId: zone.id,
          district: zone.kind,
          x: obb.x,
          z: obb.z,
          w: obb.hw * 2,
          d: obb.hd * 2,
          rotY,
          buildingIds: [],
        });
        lotHash.insert(lots.length, obbBounds(obb));
        lots.push({ obb, zone, blockId, rowGap: ROW_PITCH - SLAB_DEPTH });
      }
    }
  }

  /**
   * Palace halls on the court's north–south axis, gate to throne hall to inner halls (SEOUL.md
   * 4.3): a generic order of sizes, not any real palace's plan. Each hall is a one-lot block.
   */
  function palaceHalls(zone: DistrictZone): void {
    const cx = (PALACE_RECT.x0 + PALACE_RECT.x1) / 2;
    // [distance north of the south wall, width, depth, height] per hall.
    const halls: readonly (readonly [number, number, number, number])[] = [
      [20, 34, 12, 10],
      [62, 48, 26, 18],
      [104, 40, 22, 15],
      [138, 30, 16, 11],
    ];
    for (const [k, w, d, h] of halls) {
      const obb: Obb = { x: cx, z: PALACE_RECT.z1 - k, hw: w / 2, hd: d / 2, rotY: 0 };
      if (!accept(obb, zone)) continue;
      const blockId = blocks.length;
      blocks.push({
        id: blockId,
        zoneId: zone.id,
        district: zone.kind,
        x: obb.x,
        z: obb.z,
        w,
        d,
        rotY: 0,
        buildingIds: [],
      });
      lotHash.insert(lots.length, obbBounds(obb));
      lots.push({ obb, zone, blockId, tower: { h, tier: 0 } });
    }
  }

  /**
   * 테헤란로's screen canyon (SEOUL.md 4.3): media slabs on both sides of the avenue, long side
   * along it, alternating sides west to east. Placed before the grid lots, which fill around them.
   */
  function mediaRow(zone: DistrictZone, rng: Rng): void {
    const [ta, tb] = TEHERAN;
    const len = Math.hypot(tb.x - ta.x, tb.z - ta.z);
    const ux = (tb.x - ta.x) / len;
    const uz = (tb.z - ta.z) / len;
    const rotY = Math.atan2(-uz, ux);
    const depth = 24;
    // Road half width (25 m) + sidewalk + half the slab depth.
    const off = 25 + 6 + depth / 2;
    let prefer = 1;
    let placed = 0;
    const last = { [-1]: -Infinity, [1]: -Infinity } as Record<number, number>;
    for (let s0 = 30; s0 < len - 30 && placed < MEDIA_SLABS; s0 += 8) {
      const w = rng.range(MEDIA_MIN_FACE + 2, 56);
      // Prefer the other side from the last slab (screens face each other across the avenue);
      // fall back to the same side when that one is blocked here.
      let obb: Obb | null = null;
      let side = prefer;
      for (const sd of [prefer, -prefer]) {
        if (s0 - (last[sd] as number) < w + 12) continue;
        const c = { x: ta.x + ux * s0 - uz * off * sd, z: ta.z + uz * s0 + ux * off * sd };
        const o: Obb = { x: c.x, z: c.z, hw: w / 2, hd: depth / 2, rotY };
        if (accept(o, zone)) {
          obb = o;
          side = sd;
          break;
        }
      }
      if (!obb) continue;
      const blockId = blocks.length;
      blocks.push({
        id: blockId,
        zoneId: zone.id,
        district: zone.kind,
        x: obb.x,
        z: obb.z,
        w,
        d: depth,
        rotY,
        buildingIds: [],
      });
      lotHash.insert(lots.length, obbBounds(obb));
      lots.push({ obb, zone, blockId, media: true });
      placed++;
      last[side] = s0;
      prefer = -side;
    }
  }

  // Riverside pavilions (매점, 펌프장): a thin row between the embankment and the highway corridor.
  const rng = zoneRng(seed, 'lots:riverside');
  const riverside = zoneById('riverside');
  for (const side of [-1, 1] as const) {
    for (let x = -HALF_X + 50; x <= HALF_X - 50; x += 90) {
      if (!rng.chance(0.55)) continue;
      const f = riverFrame(x);
      // Just outside the embankment, inside the band and short of the riverside highways.
      const p = bankPoint(x, side, 9.5);
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
  landmark?: Landmark['id'];
}

/** Archetype of each landmark tower. */
const LANDMARK_ARCHETYPE: Record<Landmark['id'], Archetype> = {
  'yongsan-apex': 'setbackTower',
  'jamsil-blade': 'taperTower',
  'yeouido-gold': 'setbackTower',
  'namsan-mast': 'cylinderTower',
  palace: 'palaceHall',
};

/** Height limit from MAX_SLENDER (with 2 % headroom) for a w × d footprint. */
function slenderCap(w: number, d: number): number {
  return MAX_SLENDER * 0.98 * Math.sqrt(w * d);
}

/**
 * Points every 4 m along the line `o` m beyond the bank, west to east, covering world x in
 * [x0, x1]. Steps follow the level set of riverSignedDistance (along the tangent, then a Newton
 * nudge back onto it), so the row stays even on the inside of a bend where normal offsets bunch
 * up. It is traced both ways from a seed in the middle of the range.
 */
function bankContour(seed: Vec2, o: number, x0: number, x1: number): Vec2[] {
  const f = (x: number, z: number): number => riverSignedDistance(x, z);
  const trace = (east: boolean): Vec2[] => {
    const out: Vec2[] = [];
    let p = seed;
    let dir: Vec2 | null = null;
    for (let k = 0; k < 1500; k++) {
      const gx = (f(p.x + 1, p.z) - f(p.x - 1, p.z)) / 2;
      const gz = (f(p.x, p.z + 1) - f(p.x, p.z - 1)) / 2;
      const gl = Math.hypot(gx, gz) || 1;
      let t = { x: -gz / gl, z: gx / gl };
      const flip = dir ? t.x * dir.x + t.z * dir.z < 0 : east ? t.x < 0 : t.x > 0;
      if (flip) t = { x: -t.x, z: -t.z };
      dir = t;
      const q = { x: p.x + t.x * 4, z: p.z + t.z * 4 };
      const err = o - f(q.x, q.z);
      p = { x: q.x + (gx / gl) * err, z: q.z + (gz / gl) * err };
      if (p.x < x0 || p.x > x1) break;
      out.push(p);
    }
    return out;
  };
  return [...trace(false).reverse(), seed, ...trace(true)];
}

/** Lots this close to 테헤란로's centerline (m) front the avenue. */
const AVENUE_REACH = 110;
/** Media slabs down 테헤란로, and their shortest screen (long side) in m. */
const MEDIA_SLABS = 8;
const MEDIA_MIN_FACE = 40;

/** Apartment slab depth, gap between slabs in a row, and distance between rows (m). */
const SLAB_DEPTH = 14;
const SLAB_GAP = 16;
const ROW_PITCH = 72;

/** Clear gap kept between megacore towers (m). */
const TOWER_GAP = 8;

/** Hillside occupancy reaches its ridge floor at this terrain height (m). */
const HILL_TOP = 120;

const HIGHRISE_MIX: readonly (readonly [Archetype, number])[] = [
  ['setbackTower', 30],
  ['officeSlab', 20],
  ['bracedTower', 15],
  ['cantileverTower', 10],
  ['cylinderTower', 15],
  ['taperTower', 10],
];

/** Low and mid-rise blocks between the megacore towers. */
const PODIUM_MIX: readonly (readonly [Archetype, number])[] = [
  ['officeSlab', 40],
  ['setbackTower', 25],
  ['bracedTower', 15],
  ['cantileverTower', 10],
  ['twinTower', 5],
  ['cylinderTower', 5],
];

const MEGA_BAG: Archetype[] = [
  'setbackTower',
  'setbackTower',
  'setbackTower',
  'cylinderTower',
  'cylinderTower',
  'cylinderTower',
  'bracedTower',
  'bracedTower',
  'cantileverTower',
  'taperTower',
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
    case 'mediaSlab': {
      const d = Math.min(ld * f, (lw * f) / 2);
      return { w: lw * f, d };
    }
    case 'hanokRow':
      return { w: lw * 0.9, d: clamp(ld * 0.55, 6, 14) };
    case 'palaceHall':
      return { w: lw * rng.range(0.4, 0.6), d: ld * rng.range(0.3, 0.45) };
    case 'brickWarehouse':
      return { w: lw * rng.range(0.7, 0.92), d: ld * rng.range(0.7, 0.92) };
    case 'showroomBox':
      return { w: lw * rng.range(0.6, 0.85), d: ld * rng.range(0.6, 0.85) };
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
  const H = zone.heights;
  const jitterable =
    zone.kind === 'sangga' ||
    zone.kind === 'hillside' ||
    zone.kind === 'nightlife' ||
    zone.kind === 'oldtown';
  const make = (lot: Lot, archetype: Archetype, h: number, extra: Partial<Draft> = {}): Draft => {
    const lw = lot.obb.hw * 2;
    const ld = lot.obb.hd * 2;
    let { w, d } = footprint(rng, archetype, lw, ld);
    const ox = jitterable ? rng.range(-1, 1) * Math.max(0, (lw - w) / 2 - 1) * 0.6 : 0;
    const oz = jitterable ? rng.range(-1, 1) * Math.max(0, (ld - d) / 2 - 1) * 0.6 : 0;
    const jitter = jitterable ? rng.range(-4, 4) * (Math.PI / 180) : 0;
    // Shrink so the rotated, offset footprint stays strictly inside its lot.
    const s = fitScale(w, d, jitter, ox, oz, lw, ld);
    w *= s;
    d *= s;
    let hh = extra.corp ? h : Math.min(h, slenderCap(w, d));
    // Tall buildings stand only on low ground (manager rule).
    if (hh > TALL_H && terrainHeight(lot.obb.x, lot.obb.z) > TALL_GROUND) hh = TALL_H;
    return { lot, archetype, w, d, h: hh, ox, oz, jitter, ...extra };
  };

  switch (zone.kind) {
    case 'megacore': {
      const plan = MEGA[zone.id];
      const peak = plan?.peak ?? zone.origin;
      const bag = shuffle(rng, [...MEGA_BAG]);
      let corp = 0;
      for (const lot of lots) {
        const tw = lot.tower;
        if (!tw) continue;
        const mega = tw.h >= MEGA_MIN_H;
        const a: Archetype =
          tw.tier === 0 && plan
            ? LANDMARK_ARCHETYPE[plan.landmark]
            : mega
              ? (bag[corp % bag.length] as Archetype)
              : tw.h < 120
                ? weighted<Archetype>(rng, PODIUM_MIX)
                : weighted<Archetype>(rng, HIGHRISE_MIX);
        const extra: Partial<Draft> = {};
        if (mega) extra.corp = CORPS[corp++ % CORPS.length];
        if (tw.tier === 0 && plan) extra.landmark = plan.landmark;
        // Tower lots are sized for their tower: the footprint fills the lot.
        const w = lot.obb.hw * 2 * 0.96;
        const d = lot.obb.hd * 2 * 0.96;
        drafts.push({ lot, archetype: a, w, d, h: tw.h, ox: 0, oz: 0, jitter: 0, ...extra });
      }
      for (const lot of lots) {
        if (lot.tower) continue;
        // Plazas and sunken squares between the towers.
        if (rng.chance(0.3)) continue;
        const a = weighted<Archetype>(rng, [
          ['officeSlab', 40],
          ['setbackTower', 25],
          ['bracedTower', 15],
          ['cantileverTower', 10],
          ['twinTower', 5],
          ['cylinderTower', 5],
        ]);
        // Podium and mid-rise blocks, lower away from the peak.
        const dist = Math.hypot(lot.obb.x - peak.x, lot.obb.z - peak.z);
        const fall = 1 - 0.5 * clamp(dist / 700, 0, 1);
        drafts.push(make(lot, a, rng.range(40, 110) * fall));
      }
      break;
    }
    case 'corridor': {
      const [ta, tb] = TEHERAN;
      const onAvenue = (l: Lot): boolean => pointSegmentDistance(l.obb, ta, tb) < AVENUE_REACH;
      for (const lot of lots) {
        if (lot.media) {
          // The lot is the slab: keep its full length so the screen spans it.
          const h = Math.min(rng.range(120, H.tallMax), slenderCap(lot.obb.hw * 2, lot.obb.hd * 2));
          drafts.push({
            lot,
            archetype: 'mediaSlab',
            w: lot.obb.hw * 1.96,
            d: lot.obb.hd * 1.96,
            h,
            ox: 0,
            oz: 0,
            jitter: 0,
          });
          continue;
        }
        if (rng.chance(0.06)) continue;
        if (onAvenue(lot)) {
          const a = weighted<Archetype>(rng, [
            ['officeSlab', 40],
            ['setbackTower', 30],
            ['bracedTower', 15],
            ['cantileverTower', 15],
          ]);
          drafts.push(make(lot, a, rng.range(120, H.tallMax)));
        } else {
          const a = weighted<Archetype>(rng, [
            ['sangga', 70],
            ['officeSlab', 30],
          ]);
          drafts.push(make(lot, a, a === 'sangga' ? sanggaHeight(rng) : rng.range(H.min, H.max)));
        }
      }
      break;
    }
    case 'oldtown': {
      const tallBlocks = new Set<number>();
      for (const lot of lots) {
        if (rng.chance(0.1)) continue;
        const a = weighted<Archetype>(rng, [
          ['lowOffice', 50],
          ['sangga', 30],
          ['hanokRow', 20],
        ]);
        let h =
          a === 'hanokRow'
            ? rng.range(4, 8)
            : a === 'sangga'
              ? Math.min(H.max, sanggaHeight(rng))
              : rng.range(18, H.max);
        // At most one old 40–70 m office per block.
        if (a === 'lowOffice' && !tallBlocks.has(lot.blockId) && rng.chance(H.tallShare)) {
          tallBlocks.add(lot.blockId);
          h = rng.range(40, H.tallMax);
        }
        drafts.push(make(lot, a, h));
      }
      break;
    }
    case 'palace':
      for (const lot of lots) {
        // Hall lots are sized for their hall.
        const w = lot.obb.hw * 2 * 0.98;
        const d = lot.obb.hd * 2 * 0.98;
        const h = lot.tower?.h ?? H.min;
        drafts.push({ lot, archetype: 'palaceHall', w, d, h, ox: 0, oz: 0, jitter: 0 });
      }
      break;
    case 'brick':
      for (const lot of lots) {
        if (rng.chance(0.1)) continue;
        const a = weighted<Archetype>(rng, [
          ['brickWarehouse', 70],
          ['sangga', 15],
          ['officeSlab', 15],
        ]);
        const h =
          a === 'brickWarehouse'
            ? rng.range(H.min, H.max)
            : a === 'sangga'
              ? Math.min(H.max, sanggaHeight(rng))
              : rng.range(40, H.tallMax);
        drafts.push(make(lot, a, h));
      }
      break;
    case 'showroom':
      for (const lot of lots) {
        if (rng.chance(0.1)) continue;
        const a = weighted<Archetype>(rng, [
          ['showroomBox', 50],
          ['officeSlab', 30],
          ['setbackTower', 20],
        ]);
        drafts.push(
          make(lot, a, a === 'showroomBox' ? rng.range(H.min, H.max) : rng.range(30, H.tallMax)),
        );
      }
      break;
    case 'midtown':
      for (const lot of lots) {
        if (rng.chance(0.08)) continue;
        const a = weighted<Archetype>(rng, [
          ['officeSlab', 50],
          ['setbackTower', 30],
          ['bracedTower', 10],
          ['sangga', 10],
        ]);
        let h = a === 'sangga' ? sanggaHeight(rng) : rng.range(H.min, H.max);
        if (a !== 'sangga' && rng.chance(H.tallShare)) h = Math.min(h * 1.5, H.tallMax);
        drafts.push(make(lot, a, h));
      }
      break;
    case 'sangga':
    case 'nightlife':
      for (const lot of lots) {
        if (rng.chance(zone.kind === 'nightlife' ? 0.05 : 0.15)) continue;
        const a = weighted<Archetype>(rng, [
          ['sangga', 85],
          ['officeSlab', 10],
          ['cylinderTower', 5],
        ]);
        const h =
          a === 'officeSlab'
            ? rng.range(Math.max(40, H.max), H.tallMax)
            : a === 'cylinderTower'
              ? rng.range(15, 30)
              : Math.min(H.max, sanggaHeight(rng));
        drafts.push(make(lot, a, h));
      }
      break;
    case 'apartment': {
      const fMin = Math.ceil(H.min / 2.8);
      const fMax = Math.floor(H.max / 2.8);
      for (const lot of lots) {
        if (rng.chance(0.1)) {
          drafts.push(make(lot, 'sangga', 4.2 + 3.3 * rng.int(1, 2)));
          continue;
        }
        // Taller zones get taller slabs (SEOUL.md 4.2), but rows stay ≥ 0.8 × height apart:
        // the lot depth minus the slab depth (≈ 13 m) is the gap to the next row.
        const gap = lot.rowGap ?? lot.obb.hd * 2 - 13;
        const fGap = Math.floor(gap / 0.8 / 2.8);
        const fTop = Math.min(Math.floor(H.tallMax / 2.8), fGap);
        const want = rng.chance(H.tallShare)
          ? Math.round(rng.int(fMin, fMax) * 1.2)
          : rng.int(fMin, fMax);
        // Too shallow for a 5-storey slab at 0.8 × height: a low shopping block instead.
        if (fTop < 5) {
          drafts.push(make(lot, 'sangga', 4.2 + 3.3 * rng.int(1, 2)));
          continue;
        }
        const floors = Math.min(fTop, want);
        drafts.push(make(lot, 'apartmentSlab', floors * 2.8));
      }
      break;
    }
    case 'industrial':
      for (const lot of lots) {
        if (rng.chance(0.1)) continue;
        drafts.push(make(lot, 'warehouse', rng.range(10, 30)));
      }
      break;
    case 'hillside':
      for (const lot of lots) {
        // Packed at the foot of the slope (~85 % of lots built), thinning toward the ridge.
        const up = clamp(terrainHeight(lot.obb.x, lot.obb.z) / HILL_TOP, 0, 1);
        if (!rng.chance(HILL_OCCUPANCY_LOW * Math.pow(1 - up, 2.2) + HILL_OCCUPANCY_TOP)) continue;
        drafts.push(make(lot, 'hillHouse', 2.7 * rng.int(2, 4)));
      }
      break;
    case 'riverside':
      for (const lot of lots) drafts.push(make(lot, 'pavilion', rng.range(3, 8)));
      break;
    case 'park':
      break;
    default:
      throw new Error(`layout generator does not support zone kind ${zone.kind}`);
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
 * Caps (the zone's `heights.tallMax`) hold for every non-megatower at the end.
 */
const RATIO_KINDS = new Set<DistrictZone['kind']>([
  'core',
  'megacore',
  'corridor',
  'midtown',
  'sangga',
  'nightlife',
]);
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
    // Only megatowers (corp) may reach MEGA_MIN_H; everything stays within MAX_SLENDER.
    const capOf = (d: Draft): number =>
      d.corp
        ? Infinity
        : Math.min(
            d.lot.zone.heights.tallMax,
            MEGA_MIN_H - 1,
            slenderCap(d.w, d.d),
            terrainHeight(d.lot.obb.x, d.lot.obb.z) > TALL_GROUND ? TALL_H : Infinity,
          );
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

const STOREFRONT_KINDS = new Set<DistrictZone['kind']>(['core', 'megacore', 'midtown', 'corridor']);

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
        d.archetype === 'hanokRow' ||
        d.archetype === 'showroomBox' ||
        (STOREFRONT_KINDS.has(lot.zone.kind) && rng.chance(0.4)) ||
        (d.archetype === 'hillHouse' && rng.chance(0.1)),
      name: fictionalName(rng, d.archetype, lot.zone.name),
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
      tags.complex = `${lot.zone.name} ${n}단지`;
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
    if (d.archetype === 'mediaSlab') {
      // The screen is the long side facing 테헤란로 itself, not whatever street is nearest.
      const t = closestSegmentT({ x, z }, TEHERAN[0], TEHERAN[1]);
      const qx = TEHERAN[0].x + (TEHERAN[1].x - TEHERAN[0].x) * t;
      const qz = TEHERAN[0].z + (TEHERAN[1].z - TEHERAN[0].z) * t;
      spec.tags.mediaFace = sideToward(qx - x, qz - z, rotY);
    }
    if (d.landmark) spec.tags.landmark = d.landmark;
    if (tr.twin) spec.twin = tr.twin;
    if (tr.skybridge) spec.skybridge = tr.skybridge;
    if (tr.cantilever) spec.cantilever = tr.cantilever;
    return spec;
  });
}

const SIGN_STREETS = new Set<DistrictZone['kind']>(['sangga', 'nightlife', 'oldtown']);

/** Street slots (ART_DIRECTION 6.2). */
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
    // Park strips (둔치) are fine; open water, 샛강 included, is not.
    return (
      Math.abs(p.x) < HALF_X &&
      Math.abs(p.z) < HALF_Z &&
      surfaceHeight(p.x, p.z) > RIVER.waterY + 0.5
    );
  };
  const add = (kind: SlotKind, p: Vec2, rotY: number): void => {
    if (!free(p)) return;
    slots.push({ kind, x: p.x, z: p.z, y: surfaceHeight(p.x, p.z), rotY, seed: rng.int(0, 1e9) });
  };
  /** Point on a road at parameter t, `offset` from its center line (side ±1). */
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
    if (!SIGN_STREETS.has(r.district)) {
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
    for (let x = -HALF_X + 40; x <= HALF_X - 40; x += 75) {
      if (!rng.chance(0.75)) continue;
      const f = riverFrame(x);
      // Middle of the park strip (둔치).
      const p = bankPoint(x, side, -parkWidthAt(x) / 2);
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

/** Angle in `ridgeHeight`'s atan2(z, x) convention of a compass heading (0° = north) in degrees. */
const bearing = (deg: number): number => ((deg - 90) * Math.PI) / 180;

function makeRidges(seed: number): Ridge[] {
  const rng = zoneRng(seed, 'ridges');
  // Named peaks (SEOUL.md 5.2): real elevation × 0.6. Compass 0° = north (-Z).
  const peak = (deg: number, height: number, widthDeg: number) => ({
    angle: bearing(deg),
    height,
    width: (widthDeg * Math.PI) / 180,
  });
  return [
    {
      id: 'ridge-near',
      radius: 3200,
      peakNorth: 260,
      peakSouth: 120,
      segments: 512,
      fog: 0.35,
      baseY: -50,
      seed: rng.int(1, 1e6),
      peaks: [peak(-5, 500, 14), peak(190, 380, 12)],
    },
    {
      id: 'ridge-mid',
      radius: 4800,
      peakNorth: 450,
      peakSouth: 180,
      segments: 384,
      fog: 0.6,
      baseY: -50,
      seed: rng.int(1, 1e6),
      peaks: [peak(15, 430, 18), peak(165, 370, 14), peak(90, 300, 30)],
    },
    {
      id: 'ridge-far',
      radius: 7000,
      peakNorth: 700,
      peakSouth: 240,
      segments: 256,
      fog: 0.8,
      baseY: -50,
      seed: rng.int(1, 1e6),
      peaks: [peak(270, 150, 40)],
    },
  ];
}

/** Horizontal reach (m) and vertical margin (m) a sky lane keeps from buildings. */
export const SKY_LANE_CLEAR = 60;
export const SKY_LANE_MARGIN = 30;
const SKY_LANE_STEP = 10;

/**
 * Flying-traffic routes (SEOUL.md 7.5): rings around the 용산, 여의도 and 테헤란로 towers and a
 * long route over the river. Each band starts above every building within SKY_LANE_CLEAR m of
 * the lane, so drones never fly through a tower.
 */
function makeSkyLanes(buildings: readonly BuildingSpec[], hash: GridHash): SkyLane[] {
  const ring = (c: Vec2, r: number, n = 16): Vec2[] =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
    });
  const yeouido = MEGA.yeouido?.peak ?? { x: -1090, z: 200 };
  const [ta, tb] = TEHERAN;
  const tmid = { x: (ta.x + tb.x) / 2, z: (ta.z + tb.z) / 2 };
  const river = RIVER.samples.filter(
    (p, i) => i % 20 === 0 && Math.abs(p.x) < HALF_X - 60 && Math.abs(p.z) < HALF_Z - 60,
  );
  const defs: { id: string; points: Vec2[]; closed: boolean; floor: number }[] = [
    { id: 'sky-yongsan-ring', points: ring(SKYLINE_PEAK, 430), closed: true, floor: 140 },
    { id: 'sky-yeouido-ring', points: ring(yeouido, 320), closed: true, floor: 140 },
    { id: 'sky-gangnam-loop', points: ring(tmid, 330, 12), closed: true, floor: 120 },
    { id: 'sky-river', points: river, closed: false, floor: 110 },
  ];
  return defs.map((d) => {
    const samples = laneSamples(d.points, d.closed);
    let top = 0;
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i] as Vec2;
      const b = samples[i + 1] as Vec2;
      for (const id of hash.query(segmentBounds(a, b, SKY_LANE_CLEAR + 60))) {
        const bd = buildings[id] as BuildingSpec;
        const reach = SKY_LANE_CLEAR + Math.hypot(bd.w, bd.d) / 2;
        if (pointSegmentDistance(bd, a, b) > reach) continue;
        top = Math.max(top, bd.baseY + bd.h + bd.spireH);
      }
    }
    const lo = Math.max(d.floor, Math.ceil(top + SKY_LANE_MARGIN));
    return { id: d.id, points: d.points, samples, closed: d.closed, altitude: [lo, lo + 60] };
  });
}

/** The flown path: centripetal Catmull-Rom through the control points, ~SKY_LANE_STEP m apart. */
function laneSamples(points: readonly Vec2[], closed: boolean): Vec2[] {
  const curve = new CatmullRomCurve3(
    points.map((p) => new Vector3(p.x, 0, p.z)),
    closed,
    'centripetal',
  );
  const n = Math.max(8, Math.ceil(curve.getLength() / SKY_LANE_STEP));
  // getSpacedPoints repeats the first point at the end of a closed curve.
  return curve.getSpacedPoints(n).map((v) => ({ x: v.x, z: v.z }));
}

function buildingHash(buildings: readonly BuildingSpec[]): GridHash {
  const h = new GridHash();
  buildings.forEach((b, id) => h.insert(id, obbBounds(footprintObb(b))));
  return h;
}

function makeLandmarks(buildings: readonly BuildingSpec[]): Landmark[] {
  const out: Landmark[] = [];
  for (const b of buildings) {
    if (b.tags.landmark)
      out.push({ id: b.tags.landmark, buildingId: b.id, x: b.x, z: b.z, h: b.h });
  }
  const namsan = MOUNTAINS.find((m) => m.id === 'namsan');
  if (namsan) {
    out.push({ id: 'namsan-mast', buildingId: null, x: namsan.peak.x, z: namsan.peak.z, h: 180 });
  }
  const palace = zoneById('palace');
  const c = palace.polygon.reduce((a, p) => ({ x: a.x + p.x, z: a.z + p.z }), { x: 0, z: 0 });
  const n = palace.polygon.length;
  out.push({ id: 'palace', buildingId: null, x: c.x / n, z: c.z / n, h: 18 });
  return out;
}

export function generateLayout(seed = 2077): Layout {
  const bridges = makeBridges();
  const highways = makeHighways(bridges);
  const namedRoads = makeNamedRoads(bridges);
  const roads = buildRoads(seed, bridges, namedRoads);

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
  const c = RIVER.samples;
  for (let i = 0; i < c.length - 1; i++) {
    const a = c[i] as Vec2;
    const b = c[i + 1] as Vec2;
    obstacles.add(a, b, Math.max(riverWidthAt(a.x), riverWidthAt(b.x)) / 2 + RIVER_CLEARANCE);
  }
  const sg = SAETGANG.centerline;
  for (let i = 0; i < sg.length - 1; i++) {
    obstacles.add(sg[i] as Vec2, sg[i + 1] as Vec2, SAETGANG.width / 2 + RIVER_CLEARANCE);
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
    extentX: EXTENT_X,
    extentZ: EXTENT_Z,
    districts: [...ZONES],
    river: {
      ...RIVER,
      centerline: RIVER.centerline.map((p) => ({ ...p })),
      widths: [...RIVER.widths],
      parkWidths: [...RIVER.parkWidths],
      samples: RIVER.samples.map((p) => ({ ...p })),
      channels: RIVER.channels.map((ch) => ({
        ...ch,
        centerline: ch.centerline.map((p) => ({ ...p })),
      })),
    },
    bridges,
    highways,
    ridges: makeRidges(seed),
    roads,
    blocks: usedBlocks,
    buildings,
    slots,
    islands: ISLANDS.map((i) => ({ ...i, polygon: i.polygon.map((p) => ({ ...p })) })),
    mountains: MOUNTAINS.map((m) => ({ ...m, peak: { ...m.peak } })),
    namedRoads,
    landmarks: makeLandmarks(buildings),
    skyLanes: makeSkyLanes(buildings, buildingHash(buildings)),
  };
}
