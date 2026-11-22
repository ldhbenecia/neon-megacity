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
import { ZONES, zoneAt } from './districts';
import { highwaySamples, makeBridges, makeHighways, onBridge } from './highways';
import {
  clamp,
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
import { RIVER, riverFrame, riverSignedDistance, surfaceHeight, terrainHeight } from './river';
import { GridHash, segmentBounds } from './spatial';
import type {
  Archetype,
  Block,
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
): { a: Vec2; b: Vec2 }[] {
  const runs: { a: Vec2; b: Vec2 }[] = [];
  let start: number | null = null;
  const at = (t: number): Vec2 =>
    along === 'v' ? gridToWorld(zone, fixed, t) : gridToWorld(zone, t, fixed);
  const n = Math.ceil((t1 - t0) / ROAD_STEP);
  for (let i = 0; i <= n + 1; i++) {
    const t = t0 + i * ROAD_STEP;
    const p = at(t);
    const inside = i <= n && zoneAt(p.x, p.z).id === zone.id;
    if (inside && start === null) start = t;
    if (!inside && start !== null) {
      const end = t - ROAD_STEP;
      if (end - start >= 8) runs.push({ a: at(start), b: at(end) });
      start = null;
    }
  }
  return runs;
}

function buildRoads(seed: number, bridges: ReturnType<typeof makeBridges>): Road[] {
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
      for (const { a, b } of clipLine(zone, i * P, 'v', v0, v1)) {
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
              stair ? 3 : zone.roadWidth,
              zone,
            );
          }
          s = e;
        }
      }
    }
    for (let j = Math.floor(v0 / Q); j <= Math.ceil(v1 / Q); j++) {
      for (const { a, b } of clipLine(zone, j * Q, 'u', u0, u1)) {
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
  /** Row/column inside the block (for neighbour rules). */
  slot: number;
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

/** Local lot rectangles (center u, v and size) inside a block centered at 0. */
function lotGrid(
  kind: DistrictZone['kind'] | 'coreDense',
  bw: number,
  bd: number,
  rng: Rng,
): { u: number; v: number; w: number; d: number }[] {
  const cells = (nu: number, nv: number, gapV = 0) => {
    const out: { u: number; v: number; w: number; d: number }[] = [];
    const lw = bw / nu;
    const ld = (bd - gapV) / nv;
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const v = -bd / 2 + ld * (j + 0.5) + (j >= nv / 2 ? gapV : 0);
        out.push({ u: -bw / 2 + lw * (i + 0.5), v, w: lw, d: ld });
      }
    }
    return out;
  };
  switch (kind) {
    case 'core':
      return cells(2, 2);
    case 'coreDense':
      return cells(3, 3);
    case 'midtown':
      return rng.chance(0.5) ? cells(2, 2) : cells(3, 2);
    case 'sangga':
      return cells(3, 2, SANGGA_ALLEY);
    case 'apartment':
      return cells(Math.max(1, Math.floor(bw / 85)), 3);
    case 'industrial':
      return cells(2, 2);
    case 'hillside':
      return cells(2, 2);
    default:
      return [];
  }
}

interface LotsResult {
  lots: Lot[];
  blocks: Block[];
  alleys: { a: Vec2; b: Vec2; zone: DistrictZone }[];
}

function buildLots(seed: number, obstacles: Obstacles): LotsResult {
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
        grid.forEach((g, slot) => {
          const off = toWorld(g.u, g.v, zone.gridAngle);
          const obb: Obb = {
            x: c.x + off.x,
            z: c.z + off.z,
            hw: g.w / 2,
            hd: g.d / 2,
            rotY: zone.gridAngle,
          };
          if (!accept(obb, zone)) return;
          lotHash.insert(lots.length, obbBounds(obb));
          lots.push({ obb, zone, blockId: block.id, slot });
        });
        if (lots.length > before) {
          blocks.push(block);
          if (zone.kind === 'sangga') {
            const e = toWorld(bw / 2, 0, zone.gridAngle);
            alleys.push({
              a: { x: c.x - e.x, z: c.z - e.z },
              b: { x: c.x + e.x, z: c.z + e.z },
              zone,
            });
          }
        }
      }
    }
  }

  // Riverside pavilions (매점, 펌프장): a thin row between the embankment and the highway corridor.
  const rng = zoneRng(seed, 'lots:riverside');
  const riverside = ZONES[0] as DistrictZone;
  const bridges = makeBridges();
  let blockId = -1;
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
      if (blockId < 0) {
        blockId = blocks.length;
        blocks.push({
          id: blockId,
          zoneId: riverside.id,
          district: 'riverside',
          x: 0,
          z: 150,
          w: EXTENT,
          d: RIVER.width + 2 * RIVER.bandWidth,
          rotY: 0,
          buildingIds: [],
        });
      }
      lotHash.insert(lots.length, obbBounds(obb));
      lots.push({ obb, zone: riverside, blockId, slot: lots.length });
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
  corp?: string;
  mega?: boolean;
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
      return { w: Math.min(s * rng.range(0.9, 1.1), lw * 0.85), d: Math.min(s, ld * 0.85) };
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

function draftsFor(zone: DistrictZone, lots: Lot[], rng: Rng): Draft[] {
  const drafts: Draft[] = [];
  const make = (lot: Lot, archetype: Archetype, h: number, extra: Partial<Draft> = {}): Draft => {
    const lw = lot.obb.hw * 2;
    const ld = lot.obb.hd * 2;
    const { w, d } = footprint(rng, archetype, lw, ld);
    const jitterable = zone.kind === 'sangga' || zone.kind === 'hillside';
    const ox = jitterable ? rng.range(-1, 1) * Math.max(0, (lw - w) / 2 - 1) * 0.6 : 0;
    const oz = jitterable ? rng.range(-1, 1) * Math.max(0, (ld - d) / 2 - 1) * 0.6 : 0;
    const jitter = jitterable ? rng.range(-4, 4) * (Math.PI / 180) : 0;
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
      const rest = Array.from({ length: big.length - MEGA_TOP.length }, () =>
        rng.range(MEGA_MIN_H + 10, 420),
      ).sort((a, b) => b - a);
      const heights = [...MEGA_TOP, ...rest];
      const megaSet = new Set(big);
      big.forEach((lot, i) => {
        drafts.push(
          make(lot, bag[i % bag.length] as Archetype, heights[i] as number, {
            mega: true,
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
        // Denser near the bottom of the slope, thinning toward the ridge.
        const up = clamp((-650 - lot.obb.z) / 550, 0, 1);
        if (!rng.chance(0.55 * (1 - 0.45 * up))) continue;
        drafts.push(make(lot, 'hillHouse', 2.7 * rng.int(2, 4)));
      }
      break;
    case 'riverside':
      for (const lot of lots) drafts.push(make(lot, 'pavilion', rng.range(3, 8)));
      break;
  }
  return drafts;
}

function sanggaHeight(rng: Rng): number {
  return 4.2 + 3.3 * (rng.int(4, 9) - 1);
}

/** Height rules inside a block (ART_DIRECTION 2.2): neighbours differ by > 10 %, max/min ≥ 3. */
const RATIO_KINDS = new Set(['core', 'midtown', 'sangga']);
const MIN_STOREY = 4.2;
function applyBlockHeightRules(drafts: Draft[], rng: Rng): void {
  const byBlock = new Map<number, Draft[]>();
  for (const d of drafts) {
    if (!RATIO_KINDS.has(d.lot.zone.kind)) continue;
    const list = byBlock.get(d.lot.blockId);
    if (list) list.push(d);
    else byBlock.set(d.lot.blockId, [d]);
  }
  for (const list of byBlock.values()) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1] as Draft;
      const cur = list[i] as Draft;
      if (cur.mega) continue;
      const cap = HEIGHT_CAP[cur.lot.zone.kind] ?? Infinity;
      for (let k = 0; k < 4 && Math.abs(cur.h - prev.h) <= 0.1 * Math.max(cur.h, prev.h); k++) {
        cur.h *= rng.chance(0.5) ? rng.range(1.15, 1.4) : rng.range(0.6, 0.85);
        cur.h = Math.min(cur.h, cap);
      }
    }
    if (list.length < 2) continue;
    const top = list.reduce((x, y) => (y.h > x.h ? y : x));
    const low = list.filter((d) => !d.mega && d !== top);
    if (low.length === 0) continue;
    // A single-storey shop (4.2 m) is the floor, so the tallest must reach at least 12.6 m.
    if (top.h < 3 * MIN_STOREY) top.h = 3 * MIN_STOREY + 1.5;
    const lowest = low.reduce((x, y) => (y.h < x.h ? y : x));
    if (top.h / lowest.h < 3) {
      lowest.h = Math.max(MIN_STOREY, (top.h / 3) * rng.range(0.6, 0.95));
      // Short sangga blocks get a 1–2 storey shop; tall blocks get a low podium building.
      if (lowest.archetype !== 'sangga' && lowest.h < 30) lowest.archetype = 'officeSlab';
    }
  }
}

function nearestRoadSide(
  roads: readonly Road[],
  roadHash: GridHash,
  x: number,
  z: number,
  rotY: number,
): Side {
  let best = Infinity;
  let dir: Vec2 = { x: 0, z: 1 };
  const p = { x, z };
  for (const id of roadHash.query({ minX: x - 80, minZ: z - 80, maxX: x + 80, maxZ: z + 80 })) {
    const r = roads[id] as Road;
    const dist = pointSegmentDistance(p, r.a, r.b);
    if (dist < best) {
      best = dist;
      // Direction from the building to the closest point on the road.
      const abx = r.b.x - r.a.x;
      const abz = r.b.z - r.a.z;
      const t = clamp(((x - r.a.x) * abx + (z - r.a.z) * abz) / (abx * abx + abz * abz || 1), 0, 1);
      dir = { x: r.a.x + abx * t - x, z: r.a.z + abz * t - z };
    }
  }
  const l = toLocal(dir.x, dir.z, rotY);
  if (Math.abs(l.x) > Math.abs(l.z)) return l.x > 0 ? 'px' : 'nx';
  return l.z > 0 ? 'pz' : 'nz';
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
    const rotY = lot.obb.rotY + d.jitter;
    const off = toWorld(d.ox, d.oz, lot.obb.rotY);
    const x = lot.obb.x + off.x;
    const z = lot.obb.z + off.z;
    const obb: Obb = { x, z, hw: d.w / 2, hd: d.d / 2, rotY };
    const baseY = Math.min(
      terrainHeight(x, z),
      ...obbCorners(obb).map((p) => terrainHeight(p.x, p.z)),
    );
    const [floorH, groundFloorH0] = FLOOR_H[d.archetype];
    const piloti = d.archetype === 'apartmentSlab' && rng.chance(0.3);
    const groundFloorH = piloti ? 5 : groundFloorH0;
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
      front: nearestRoadSide(roads, roadHash, x, z, rotY),
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
  bridges: ReturnType<typeof makeBridges>,
  alleys: LotsResult['alleys'],
): StreetSlot[] {
  const rng = zoneRng(seed, 'slots');
  const hash = new GridHash();
  buildings.forEach((b) =>
    hash.insert(b.id, obbBounds({ x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, rotY: b.rotY })),
  );
  const slots: StreetSlot[] = [];
  const free = (p: Vec2): boolean => {
    const probe: Obb = { x: p.x, z: p.z, hw: 0.8, hd: 0.8, rotY: 0 };
    for (const id of hash.query(obbBounds(probe))) {
      const b = buildings[id] as BuildingSpec;
      if (obbOverlap({ x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, rotY: b.rotY }, probe)) {
        return false;
      }
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

  const { lots, blocks, alleys } = buildLots(seed, obstacles);
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
    districts: [...ZONES],
    river: { ...RIVER, centerline: RIVER.centerline.map((p) => ({ ...p })) },
    bridges,
    highways,
    ridges: makeRidges(seed),
    roads,
    blocks: usedBlocks,
    buildings,
    slots,
  };
}
