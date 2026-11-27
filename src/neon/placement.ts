import { createRng, type Rng } from '../core/random';
import type { NeonName } from '../core/palette';
import {
  baseKind,
  baseKindOf,
  isUnbuilt,
  type BaseKind,
  type BuildingFace,
  type BuildingSpec,
  type DistrictKind,
  type Layout,
  type Tier,
  surfaceHeight,
} from '../city/layout';
import type { Catalog } from './catalog';
import { CARGO_CROWN } from './content';
import { firstHit, type Solid } from './solids';
import { baseArchetype, type BaseArchetype } from '../buildings/params';
import { pointSegmentDistance } from '../city/math';

export const Anim = { none: 0, flicker: 1, scroll: 2, broken: 3, fill: 4 } as const;
export type AnimMode = (typeof Anim)[keyof typeof Anim];

export type FlatKind = 'band' | 'blade' | 'vtext' | 'crown' | 'panel' | 'ad' | 'tent';

export interface FlatSign {
  kind: FlatKind;
  building: number;
  face: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
  w: number;
  h: number;
  cell: number;
  color: NeonName;
  anim: AnimMode;
  zone: number;
  seed: number;
  doubleSided: boolean;
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  vol: Solid | null;
}

export interface Tube {
  building: number;
  face: number;
  x: number;
  z: number;
  y0: number;
  y1: number;
  radius: number;
  color: NeonName;
  anim: AnimMode;
  zone: number;
  seed: number;
  vol: Solid;
}

export interface Cross {
  building: number;
  x: number;
  z: number;
  roofY: number;
  poleH: number;
  h: number;
  rotY: number;
  zone: number;
}

export interface Screen {
  building: number;
  face: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
  w: number;
  h: number;
  hue: number;
  seed: number;
  cell: number;
  logo: number;
  zone: number;
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  vol: Solid;
}

export interface Ring {
  building: number;
  x: number;
  z: number;
  y: number;
  radius: number;
  h: number;
  cell: number;
  color: NeonName;
  rate: number;
  zone: number;
}

export interface Holo {
  x: number;
  y: number;
  z: number;
  size: number;
  cell: number;
  spin: number;
  alpha: number;
  seed: number;
  zone: number;
}

export interface Placement {
  flats: FlatSign[];
  tubes: Tube[];
  crosses: Cross[];
  screens: Screen[];
  rings: Ring[];
  holos: Holo[];
}

export const WALL_GAP = { band: 0.12, vtext: 0.35, blade: 0.15, screen: 0.4 } as const;
export const EDGE_IN = 1;
const BLADE_CLEARANCE = 0.03;
export const TIER_MARGIN = 2;

interface DistrictSigns {
  /** Power-on delay range (boot fade-in sweeps the city by district). */
  zone: [number, number];
  /** Street-level shop signs (bands, blades) on shop buildings at all. */
  street: boolean;
  /** Office slabs get street-level shop signs like sangga blocks. */
  shops: boolean;
  tubes: boolean;
  vtext: boolean;
  holos: boolean;
  /** Multiplier on shop band and blade chances (1 = the v2 density). */
  shopScale: number;
  /** Extra multiplier on blades only (brick keeps signs flat and small). */
  bladeScale?: number;
  /** Vertical signs: minimum sign height, buildings from this height, signs per building. */
  vtextMinH?: number;
  vtextFromH?: number;
  vtextCount?: number;
  /** Street-facing media screens on mid-rise towers (Teheran-ro canyon). */
  media?: boolean;
  /** Banners strung across alleys. */
  banners?: boolean;
}

const MIDTOWN: DistrictSigns = {
  zone: [0.3, 0.45],
  street: true,
  shops: false,
  tubes: true,
  vtext: true,
  holos: true,
  shopScale: 1,
};

const SANGGA: DistrictSigns = {
  zone: [0.4, 0.62],
  street: true,
  shops: true,
  tubes: false,
  vtext: true,
  holos: false,
  shopScale: 1,
};

const DARK: DistrictSigns = {
  zone: [0.62, 0.8],
  street: false,
  shops: false,
  tubes: false,
  vtext: false,
  holos: false,
  shopScale: 0,
};

// Keyed by the v2 base kind (src/city/kinds.ts); unbuilt kinds (palace, park) get DARK.
const DISTRICT_SIGNS: Readonly<Record<Exclude<BaseKind, 'palace' | 'park'>, DistrictSigns>> = {
  riverside: {
    zone: [0, 0.12],
    street: true,
    shops: false,
    tubes: false,
    vtext: true,
    holos: false,
    shopScale: 1,
  },
  core: { ...MIDTOWN, zone: [0.12, 0.35] },
  midtown: MIDTOWN,
  sangga: SANGGA,
  industrial: {
    zone: [0.5, 0.65],
    street: true,
    shops: false,
    tubes: false,
    vtext: true,
    holos: false,
    shopScale: 1,
  },
  hillside: DARK,
  apartment: {
    zone: [0.8, 0.95],
    street: true,
    shops: false,
    tubes: false,
    vtext: false,
    holos: false,
    shopScale: 1,
  },
};

// v3 kinds that share a base kind but not its mood (SEOUL.md 4.4): old Jongno stays quiet,
// Hongdae carries the densest street signage.
const KIND_OVERRIDES: ReadonlyMap<string, Partial<DistrictSigns>> = new Map([
  ['oldtown', { shopScale: 0.3, vtext: false }],
  [
    'nightlife',
    {
      shopScale: 1.3,
      tubes: true,
      holos: true,
      vtextMinH: 8,
      vtextFromH: 9,
      vtextCount: 2,
      banners: true,
    },
  ],
  ['brick', { shopScale: 0.45, bladeScale: 0.15 }],
  ['corridor', { media: true }],
]);

export function districtSigns(district: DistrictKind): DistrictSigns {
  if (isUnbuilt(district)) return DARK;
  const base = baseKindOf(district);
  // Kinds newer than the shared table fall back to midtown so they never go dark.
  const rules =
    base !== undefined && Object.hasOwn(DISTRICT_SIGNS, base)
      ? DISTRICT_SIGNS[base as keyof typeof DISTRICT_SIGNS]
      : MIDTOWN;
  const over = KIND_OVERRIDES.get(district);
  return over ? { ...rules, ...over } : rules;
}

export function zoneDelay(district: DistrictKind, rng: Rng): number {
  const [a, b] = districtSigns(district).zone;
  return rng.range(a, b);
}

const TOWERS: ReadonlySet<BaseArchetype> = new Set([
  'setbackTower',
  'bracedTower',
  'cantileverTower',
  'twinTower',
]);

export function insideFace(
  f: BuildingFace,
  u0: number,
  u1: number,
  y0: number,
  y1: number,
): boolean {
  const half = f.width / 2 - EDGE_IN;
  return (
    u0 >= -half - 1e-6 &&
    u1 <= half + 1e-6 &&
    y0 >= f.y0 + TIER_MARGIN - 1e-6 &&
    y1 <= f.y1 - TIER_MARGIN + 1e-6 &&
    u1 > u0 &&
    y1 > y0
  );
}

export function wallVolume(
  f: BuildingFace,
  b: BuildingSpec,
  u0: number,
  u1: number,
  y0: number,
  y1: number,
  gap0: number,
  gap1: number,
): Solid {
  const uc = (u0 + u1) / 2;
  const gc = (gap0 + gap1) / 2;
  const x = f.center.x + f.tangent.x * uc + f.normal.x * gc;
  const z = f.center.z + f.tangent.z * uc + f.normal.z * gc;
  const alongX = f.side === 'px' || f.side === 'nx';
  const hu = (u1 - u0) / 2;
  const hg = (gap1 - gap0) / 2;
  return {
    kind: 'box',
    x,
    z,
    hw: alongX ? hg : hu,
    hd: alongX ? hu : hg,
    rotY: b.rotY,
    y0,
    y1,
    building: b.id,
    tier: -10,
    stack: 0,
  };
}

interface Rect {
  u0: number;
  u1: number;
  y0: number;
  y1: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.u0 < b.u1 && b.u0 < a.u1 && a.y0 < b.y1 && b.y0 < a.y1;
}

interface Ctx {
  L: Layout;
  faces: readonly (readonly BuildingFace[])[];
  cat: Catalog;
  out: Placement;
  occupied: Map<string, Rect[]>;
  roadGap: (x: number, z: number) => number;
}

// Distances are exact up to `pad` m past a road edge; farther points may read Infinity.
export function roadGapIndex(L: Pick<Layout, 'roads'>, pad = 0): (x: number, z: number) => number {
  const cell = 64;
  const grid = new Map<string, Layout['roads']>();
  for (const r of L.roads) {
    if (r.kind === 'stair') continue;
    const m = r.width + pad;
    const x0 = Math.floor((Math.min(r.a.x, r.b.x) - m) / cell);
    const x1 = Math.floor((Math.max(r.a.x, r.b.x) + m) / cell);
    const z0 = Math.floor((Math.min(r.a.z, r.b.z) - m) / cell);
    const z1 = Math.floor((Math.max(r.a.z, r.b.z) + m) / cell);
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const k = `${i},${j}`;
        const list = grid.get(k) ?? [];
        list.push(r);
        grid.set(k, list);
      }
    }
  }
  return (x, z) => {
    let best = Infinity;
    for (const r of grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? []) {
      best = Math.min(best, pointSegmentDistance({ x, z }, r.a, r.b) - r.width / 2);
    }
    return best;
  };
}

function reserve(c: Ctx, b: number, fi: number, r: Rect): boolean {
  const key = `${b}:${fi}`;
  const list = c.occupied.get(key) ?? [];
  if (list.some((o) => overlaps(o, r))) return false;
  list.push(r);
  c.occupied.set(key, list);
  return true;
}

function pickCell(c: Ctx, kind: keyof Catalog['byKind'], rng: Rng): number {
  const list = c.cat.byKind[kind];
  return list.length ? rng.pick(list) : -1;
}

function cellColor(c: Ctx, cell: number, fallback: NeonName): NeonName {
  return c.cat.cells[cell]?.color ?? fallback;
}

function tryWallSign(
  c: Ctx,
  b: BuildingSpec,
  fi: number,
  kind: FlatKind,
  r: Rect,
  gap: number,
  depth: number,
  props: Pick<FlatSign, 'cell' | 'color' | 'anim' | 'zone' | 'seed'>,
): FlatSign | null {
  const f = c.faces[b.id]?.[fi];
  if (!f || !insideFace(f, r.u0, r.u1, r.y0, r.y1)) return null;
  const vol = wallVolume(f, b, r.u0, r.u1, r.y0, r.y1, 0.02, gap + depth);
  if (firstHit(c.L, vol)) return null;
  if (!reserve(c, b.id, fi, r)) return null;
  const uc = (r.u0 + r.u1) / 2;
  const s: FlatSign = {
    kind,
    building: b.id,
    face: fi,
    x: f.center.x + f.tangent.x * uc + f.normal.x * gap,
    y: (r.y0 + r.y1) / 2,
    z: f.center.z + f.tangent.z * uc + f.normal.z * gap,
    nx: f.normal.x,
    nz: f.normal.z,
    w: r.u1 - r.u0,
    h: r.y1 - r.y0,
    doubleSided: false,
    ...props,
    ...r,
    vol,
  };
  c.out.flats.push(s);
  return s;
}

function animFor(rng: Rng, scrollP: number): AnimMode {
  const r = rng.next();
  if (r < 0.04) return Anim.flicker;
  if (r < 0.05) return Anim.broken;
  if (r < 0.05 + scrollP) return Anim.scroll;
  return Anim.none;
}

const OPPOSITE: Record<string, string> = { px: 'nx', nx: 'px', pz: 'nz', nz: 'pz' };

function shopFaces(c: Ctx, b: BuildingSpec): number[] {
  const faces = c.faces[b.id] ?? [];
  const front = faces.findIndex((f) => f.street && f.tier === 0 && f.stack === 0);
  const fr = faces[front];
  if (!fr) return [];
  const out = [front];
  faces.forEach((f, fi) => {
    if (fi === front || f.tier !== 0 || f.stack !== 0) return;
    const near = c.roadGap(f.center.x + f.normal.x * 2, f.center.z + f.normal.z * 2) < 6;
    if (near || f.side === OPPOSITE[fr.side]) out.push(fi);
  });
  return out;
}

function placeBands(
  c: Ctx,
  b: BuildingSpec,
  rng: Rng,
  zone: number,
  fi: number,
  pScale: number,
): void {
  const faces = c.faces[b.id] ?? [];
  const f = faces[fi];
  if (!f) return;
  const isSangga = baseArchetype(b) === 'sangga';
  const top = Math.min(6, b.floors);
  const p = (isSangga ? 0.3 : 0.15) * pScale;
  for (let floor = 2; floor <= top; floor++) {
    if (!rng.chance(p)) continue;
    const h = rng.range(1.0, 1.6);
    const fy0 = b.baseY + b.groundFloorH + (floor - 2) * b.floorH;
    const y0 = fy0 + 0.25;
    const usable = f.width - 2 * EDGE_IN;
    const w = Math.min(usable, f.width * rng.range(0.6, 0.95));
    const pair = rng.chance(0.3) && w > 8;
    const uStart = rng.range(-usable / 2, usable / 2 - w);
    const parts: [number, number][] = pair
      ? [
          [uStart, uStart + w / 2 - 0.15],
          [uStart + w / 2 + 0.15, uStart + w],
        ]
      : [[uStart, uStart + w]];
    for (const [u0, u1] of parts) {
      const cell = pickCell(c, 'band', rng);
      tryWallSign(c, b, fi, 'band', { u0, u1, y0, y1: y0 + h }, WALL_GAP.band, 0.15, {
        cell,
        color: cellColor(c, cell, 'neonOrange'),
        anim: animFor(rng, 0.045),
        zone,
        seed: rng.int(0, 1e6),
      });
    }
  }
}

function placeBlades(c: Ctx, b: BuildingSpec, rng: Rng, zone: number, p: number, fi: number): void {
  const faces = c.faces[b.id] ?? [];
  const f = faces[fi];
  if (!f || f.width < 6) return;
  for (const end of [-1, 1]) {
    if (!rng.chance(p)) continue;
    const w = rng.range(0.9, 1.6);
    const y0 = b.baseY + b.groundFloorH + 0.4;
    const h = Math.min(rng.range(4, 14), f.y1 - TIER_MARGIN - y0);
    if (h < 4) continue;
    const uc = end * (f.width / 2 - EDGE_IN - 0.1);
    const r: Rect = { u0: uc - 0.1, u1: uc + 0.1, y0, y1: y0 + h };
    if (!insideFace(f, r.u0, r.u1, r.y0, r.y1)) continue;
    const g0 = WALL_GAP.blade;
    const vol = wallVolume(f, b, r.u0, r.u1, r.y0, r.y1, 0.02, g0 + w);
    // The blade tip must clear a neighbouring wall, not merely touch it.
    if (firstHit(c.L, wallVolume(f, b, r.u0, r.u1, r.y0, r.y1, 0.02, g0 + w + BLADE_CLEARANCE)))
      continue;
    if (!reserve(c, b.id, fi, r)) continue;
    const cell = pickCell(c, 'blade', rng);
    c.out.flats.push({
      kind: 'blade',
      building: b.id,
      face: fi,
      x: f.center.x + f.tangent.x * uc + f.normal.x * (g0 + w / 2),
      y: y0 + h / 2,
      z: f.center.z + f.tangent.z * uc + f.normal.z * (g0 + w / 2),
      nx: f.tangent.x,
      nz: f.tangent.z,
      w,
      h,
      cell,
      color: cellColor(c, cell, 'neonRed'),
      anim: animFor(rng, 0),
      zone,
      seed: rng.int(0, 1e6),
      doubleSided: true,
      ...r,
      vol,
    });
  }
}

const TUBE_COLORS: readonly NeonName[] = [
  'neonRed',
  'neonOrange',
  'neonRed',
  'neonOrange',
  'neonAmber',
];

function placeTubes(c: Ctx, b: BuildingSpec, rng: Rng, zone: number): void {
  const faces = c.faces[b.id] ?? [];
  let placed = 0;
  const maxTubes = b.h > 150 ? 4 : 2;
  faces.forEach((f, fi) => {
    if (placed >= maxTubes || f.shape === 'cylinder') return;
    const tierH = f.y1 - f.y0;
    if (tierH < 14 + 2 * TIER_MARGIN || f.width < 8) return;
    if (!rng.chance(f.street ? 0.75 : 0.3)) return;
    const len = Math.min(60, tierH - 2 * TIER_MARGIN) * rng.range(0.55, 1);
    if (len < 10) return;
    const radius = rng.range(0.075, 0.15);
    const end = rng.chance(0.5) ? -1 : 1;
    const uc = end * (f.width / 2 - EDGE_IN - radius);
    const y0 = f.y0 + TIER_MARGIN + rng.range(0, tierH - 2 * TIER_MARGIN - len);
    const r: Rect = { u0: uc - radius, u1: uc + radius, y0, y1: y0 + len };
    if (!insideFace(f, r.u0, r.u1, r.y0, r.y1)) return;
    const gap = 0.15 + radius;
    const vol = wallVolume(f, b, r.u0, r.u1, r.y0, r.y1, 0.02, gap + radius);
    if (firstHit(c.L, vol) || !reserve(c, b.id, fi, r)) return;
    placed++;
    c.out.tubes.push({
      building: b.id,
      face: fi,
      x: f.center.x + f.tangent.x * uc + f.normal.x * gap,
      z: f.center.z + f.tangent.z * uc + f.normal.z * gap,
      y0: r.y0,
      y1: r.y1,
      radius,
      color: rng.pick(TUBE_COLORS),
      anim: rng.chance(0.15) ? Anim.fill : rng.chance(0.03) ? Anim.flicker : Anim.none,
      zone,
      seed: rng.int(0, 1e6),
      vol,
    });
  });
}

function placeVText(c: Ctx, b: BuildingSpec, rng: Rng, zone: number, minH = 18): void {
  const faces = c.faces[b.id] ?? [];
  const front = faces.find((f) => f.street && f.tier === 0 && f.stack === 0);
  if (!front) return;
  const sides = faces
    .map((f, fi) => ({ f, fi }))
    .filter(
      ({ f }) =>
        f.tier === 0 &&
        f.stack === 0 &&
        Math.abs(f.normal.x * front.normal.x + f.normal.z * front.normal.z) < 0.5,
    );
  if (!sides.length) return;
  const { f, fi } = rng.pick(sides);
  const cell = pickCell(c, 'vtext', rng);
  const n = Math.max(3, c.cat.cells[cell]?.chars ?? 4);
  let w = rng.range(3, 6);
  let h = w * n * 1.08;
  if (h < minH) {
    w = minH / (n * 1.08);
    h = minH;
  }
  if (w > 6 || h > 45) return;
  const top = f.y1 - TIER_MARGIN;
  const y0 = Math.max(f.y0 + TIER_MARGIN, b.baseY + 6, top - h - rng.range(0, 4));
  if (y0 + h > top) return;
  const toward = Math.sign(f.tangent.x * front.normal.x + f.tangent.z * front.normal.z) || 1;
  const uc = toward * (f.width / 2 - EDGE_IN - w / 2 - rng.range(0, 1.5));
  tryWallSign(
    c,
    b,
    fi,
    'vtext',
    { u0: uc - w / 2, u1: uc + w / 2, y0, y1: y0 + h },
    WALL_GAP.vtext,
    0.2,
    {
      cell,
      color: cellColor(c, cell, 'neonRed'),
      anim: rng.chance(0.04) ? Anim.flicker : Anim.none,
      zone,
      seed: rng.int(0, 1e6),
    },
  );
}

function topTier(b: BuildingSpec): Tier | undefined {
  return b.tiers[b.tiers.length - 1];
}

function placeCrown(
  c: Ctx,
  b: BuildingSpec,
  rng: Rng,
  zone: number,
  cell: number,
  faces: number,
): void {
  const t = topTier(b);
  if (!t || t.shape === 'cylinder' || cell < 0) return;
  const tierIdx = b.tiers.length - 1;
  const fs = (c.faces[b.id] ?? [])
    .filter((f) => f.stack === 0 && f.tier === tierIdx && f.width >= 12)
    .sort((a, z) => Number(z.street) - Number(a.street) || z.normal.z - a.normal.z);
  for (const f of fs.slice(0, faces)) {
    const w = Math.min(f.width * 0.7, f.width - 2 * EDGE_IN);
    const h = Math.min(8, Math.max(3, w / 6.5));
    const leg = 0.6;
    const inset = 1.5;
    const x = f.center.x - f.normal.x * inset;
    const z = f.center.z - f.normal.z * inset;
    const y0 = t.y1 + leg;
    const alongX = f.side === 'px' || f.side === 'nx';
    const vol: Solid = {
      kind: 'box',
      x,
      z,
      hw: alongX ? 0.15 : w / 2,
      hd: alongX ? w / 2 : 0.15,
      rotY: b.rotY,
      y0: t.y1 + 0.05,
      y1: y0 + h,
      building: b.id,
      tier: -10,
      stack: 0,
    };
    if (firstHit(c.L, vol)) continue;
    c.out.flats.push({
      kind: 'crown',
      building: b.id,
      face: -1,
      x,
      y: y0 + h / 2,
      z,
      nx: f.normal.x,
      nz: f.normal.z,
      w,
      h,
      cell,
      color: cellColor(c, cell, 'neonWhite'),
      anim: Anim.none,
      zone,
      seed: rng.int(0, 1e6),
      doubleSided: false,
      u0: -w / 2,
      u1: w / 2,
      y0,
      y1: y0 + h,
      vol,
    });
  }
}

function placeCross(c: Ctx, b: BuildingSpec, rng: Rng, zone: number): void {
  const t = topTier(b);
  if (!t) return;
  const h = rng.range(4, 8);
  const poleH = rng.range(3, 6);
  const rotY = b.rotY + rng.range(-0.3, 0.3);
  const vol: Solid = {
    kind: 'box',
    x: t.x,
    z: t.z,
    hw: 0.55 * h * 0.5,
    hd: 0.3,
    rotY,
    y0: t.y1 + 0.05,
    y1: t.y1 + poleH + h,
    building: b.id,
    tier: -10,
    stack: 0,
  };
  if (firstHit(c.L, vol)) return;
  c.out.crosses.push({
    building: b.id,
    x: t.x,
    z: t.z,
    roofY: t.y1,
    poleH,
    h,
    rotY,
    zone,
  });
}

function placeScreens(c: Ctx, b: BuildingSpec, rng: Rng, zone: number, maxScreens: number): void {
  const lo = b.baseY + b.h * 0.25;
  const hi = b.baseY + b.h * 0.75;
  const cands: { f: BuildingFace; fi: number; h: number; w: number; y0: number; score: number }[] =
    [];
  (c.faces[b.id] ?? []).forEach((f, fi) => {
    if (f.shape === 'cylinder') return;
    const tierH = f.y1 - f.y0;
    const y0 = Math.max(lo, f.y0 + TIER_MARGIN);
    const y1 = Math.min(hi, f.y1 - TIER_MARGIN);
    const h = Math.min(150, tierH * 0.85, y1 - y0);
    const w = Math.min(28, f.width - 2 * EDGE_IN, h / 3);
    if (h < 60 || w < 12) return;
    const score = w * h * (1 + 0.6 * f.normal.z + (f.street ? 0.2 : 0));
    cands.push({ f, fi, h, w, y0, score });
  });
  cands.sort((a, z) => z.score - a.score);
  const usedSides = new Set<string>();
  let placed = 0;
  for (const k of cands) {
    if (placed >= maxScreens) break;
    if (usedSides.has(`${k.f.stack}:${k.f.side}`)) continue;
    const yTop = Math.min(hi, k.f.y1 - TIER_MARGIN);
    const y0 = Math.max(k.y0, yTop - k.h - rng.range(0, Math.max(0, yTop - k.h - k.y0)));
    const r: Rect = { u0: -k.w / 2, u1: k.w / 2, y0, y1: y0 + k.h };
    if (!insideFace(k.f, r.u0, r.u1, r.y0, r.y1)) continue;
    const vol = wallVolume(k.f, b, r.u0, r.u1, r.y0, r.y1, 0.02, WALL_GAP.screen + 0.3);
    if (firstHit(c.L, vol) || !reserve(c, b.id, k.fi, r)) continue;
    usedSides.add(`${k.f.stack}:${k.f.side}`);
    placed++;
    c.out.screens.push({
      building: b.id,
      face: k.fi,
      x: k.f.center.x + k.f.normal.x * WALL_GAP.screen,
      y: y0 + k.h / 2,
      z: k.f.center.z + k.f.normal.z * WALL_GAP.screen,
      nx: k.f.normal.x,
      nz: k.f.normal.z,
      w: k.w,
      h: k.h,
      hue: rng.int(0, 2),
      seed: rng.int(0, 1e6),
      cell: pickCell(c, 'line', rng),
      logo: pickCell(c, 'logo', rng),
      zone,
      ...r,
      vol,
    });
  }
}

function placeRings(c: Ctx, b: BuildingSpec, rng: Rng, zone: number, budget: number): number {
  const t = b.tiers[0];
  if (!t || t.shape !== 'cylinder' || budget <= 0) return 0;
  const n = Math.min(budget, b.h >= 200 ? 3 : b.h >= 100 ? 2 : 1);
  const lo = b.baseY + b.h * 0.3;
  const hi = b.baseY + b.h * 0.6;
  let placed = 0;
  const ys: number[] = [];
  for (let k = 0; k < n * 3 && placed < n; k++) {
    const h = rng.range(8, 14);
    const y = rng.range(lo + h / 2, hi - h / 2);
    if (y - h / 2 < t.y0 + TIER_MARGIN || y + h / 2 > t.y1 - TIER_MARGIN) continue;
    if (ys.some((o) => Math.abs(o - y) < 25)) continue;
    const radius = t.w / 2 + 3;
    const vol: Solid = {
      kind: 'cyl',
      x: t.x,
      z: t.z,
      hw: radius + 0.3,
      hd: radius + 0.3,
      rotY: 0,
      y0: y - h / 2,
      y1: y + h / 2,
      building: b.id,
      tier: -10,
      stack: 0,
    };
    // The ring wraps its own tier-0 cylinder; every other solid is a collision.
    if (firstHit(c.L, vol, (s) => s.building === b.id && s.tier === 0 && s.stack === 0)) continue;
    ys.push(y);
    placed++;
    const cell = pickCell(c, 'ring', rng);
    c.out.rings.push({
      building: b.id,
      x: t.x,
      z: t.z,
      y,
      radius,
      h,
      cell,
      color: placed % 2 ? 'neonCyan' : 'neonOrange',
      rate: rng.range(0.02, 0.05) * (rng.chance(0.5) ? 1 : -1),
      zone,
    });
  }
  return placed;
}

function placeHolo(
  c: Ctx,
  x: number,
  z: number,
  roofY: number,
  rng: Rng,
  zone: number,
  cell: number,
): boolean {
  const size = rng.range(10, 40);
  const y = roofY + rng.range(20, 60) + size / 2;
  const vol: Solid = {
    kind: 'cyl',
    x,
    z,
    hw: size / 2,
    hd: size / 2,
    rotY: 0,
    y0: y - size / 2,
    y1: y + size / 2,
    building: -1,
    tier: -10,
    stack: 0,
  };
  if (firstHit(c.L, vol)) return false;
  c.out.holos.push({
    x,
    y,
    z,
    size,
    cell,
    spin: rng.range(0.05, 0.15) * (rng.chance(0.5) ? 1 : -1),
    alpha: rng.range(0.35, 0.55),
    seed: rng.int(0, 1e6),
    zone,
  });
  return true;
}

const MEDIA_MAX = 24;
const MEDIA_MAIN_GAP = 40;
const BANNER_MAX = 400;

// Teheran-ro canyon: one street-facing screen per mid-rise tower; a tagged media face is covered
// edge to edge (SEOUL.md 4.3 mediaSlab).
function placeMediaScreen(
  c: Ctx,
  b: BuildingSpec,
  rng: Rng,
  zone: number,
  mainGap: (x: number, z: number) => number,
): boolean {
  const media = b.tags.mediaFace;
  // Faces looking onto the arterial (Teheran-ro itself) first, then the biggest wall.
  const toMain = (f: BuildingFace): number =>
    Math.min(MEDIA_MAIN_GAP, mainGap(f.center.x + f.normal.x * 8, f.center.z + f.normal.z * 8));
  const cands = (c.faces[b.id] ?? [])
    .map((f, fi) => ({ f, fi, main: toMain(f) }))
    .filter(
      ({ f }) => f.shape !== 'cylinder' && f.stack === 0 && (media ? f.side === media : f.street),
    )
    .sort(
      (a, z) => a.main - z.main || z.f.width * (z.f.y1 - z.f.y0) - a.f.width * (a.f.y1 - a.f.y0),
    );
  for (const { f, fi } of cands) {
    const tierH = f.y1 - f.y0 - 2 * TIER_MARGIN;
    const h = media ? Math.min(150, tierH) : Math.min(90, tierH * 0.6);
    const w = media
      ? Math.min(70, f.width - 2 * EDGE_IN)
      : Math.min(28, f.width - 2 * EDGE_IN, h / 1.6);
    // A tagged media face is covered whatever its width; free screens need a real wall.
    if (h < 25 || w < (media ? 4 : 10)) continue;
    const y0 = f.y0 + TIER_MARGIN + (media ? 0 : (tierH - h) * rng.range(0.3, 0.9));
    const r: Rect = { u0: -w / 2, u1: w / 2, y0, y1: y0 + h };
    if (!insideFace(f, r.u0, r.u1, r.y0, r.y1)) continue;
    const vol = wallVolume(f, b, r.u0, r.u1, r.y0, r.y1, 0.02, WALL_GAP.screen + 0.3);
    if (firstHit(c.L, vol) || !reserve(c, b.id, fi, r)) continue;
    c.out.screens.push({
      building: b.id,
      face: fi,
      x: f.center.x + f.normal.x * WALL_GAP.screen,
      y: y0 + h / 2,
      z: f.center.z + f.normal.z * WALL_GAP.screen,
      nx: f.normal.x,
      nz: f.normal.z,
      w,
      h,
      hue: rng.int(0, 2),
      seed: rng.int(0, 1e6),
      cell: pickCell(c, 'line', rng),
      logo: pickCell(c, 'logo', rng),
      zone,
      ...r,
      vol,
    });
    return true;
  }
  return false;
}

// Hongdae: banners strung across alleys and narrow streets, 5.5–7.5 m above the road.
function placeBanners(c: Ctx, rng: Rng): void {
  let placed = 0;
  for (const r of c.L.roads) {
    if (placed >= BANNER_MAX) return;
    if (!districtSigns(r.district).banners) continue;
    if ((r.kind !== 'alley' && r.kind !== 'street') || r.width > 14) continue;
    const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z);
    if (len < 30) continue;
    const dir = { x: (r.b.x - r.a.x) / len, z: (r.b.z - r.a.z) / len };
    const across = { x: -dir.z, z: dir.x };
    for (
      let t = 10 + rng.range(0, 6);
      t < len - 10 && placed < BANNER_MAX;
      t += rng.range(12, 20)
    ) {
      const x = r.a.x + dir.x * t;
      const z = r.a.z + dir.z * t;
      const w = r.width * 0.9 + 1;
      const h = rng.range(0.9, 1.3);
      const y0 = surfaceHeight(x, z) + rng.range(5.5, 7.5);
      const vol: Solid = {
        kind: 'box',
        x,
        z,
        hw: w / 2,
        hd: 0.1,
        rotY: Math.atan2(-across.z, across.x),
        y0,
        y1: y0 + h,
        building: -1,
        tier: -10,
        stack: 0,
      };
      if (firstHit(c.L, vol)) continue;
      const cell = pickCell(c, 'band', rng);
      c.out.flats.push({
        kind: 'band',
        building: -1,
        face: -1,
        x,
        y: y0 + h / 2,
        z,
        nx: dir.x,
        nz: dir.z,
        w,
        h,
        cell,
        color: cellColor(c, cell, 'neonMagenta'),
        anim: animFor(rng, 0.03),
        zone: zoneDelay(r.district, rng),
        seed: rng.int(0, 1e6),
        doubleSided: true,
        u0: -w / 2,
        u1: w / 2,
        y0,
        y1: y0 + h,
        vol,
      });
      placed++;
    }
  }
}

/** Hard ceiling on all sign instances (ART_DIRECTION 5.1); smaller maps get a share by area. */
export const SIGN_CAP = 16000;
const SIGNS_PER_KM2 = 1540;
// Hot streets keep every sign when the budget forces thinning (SEOUL.md 4.4).
const HOT_KINDS: ReadonlySet<string> = new Set(['nightlife', 'corridor', 'megacore']);
const MAIN_ROAD_GAP = 20;

export function signBudget(L: Pick<Layout, 'extentX' | 'extentZ'>): number {
  return Math.min(SIGN_CAP, Math.round(((L.extentX * L.extentZ) / 1e6) * SIGNS_PER_KM2));
}

export function signCount(P: Placement): number {
  return (
    P.flats.length +
    P.tubes.length +
    P.crosses.length +
    P.screens.length +
    P.rings.length +
    P.holos.length
  );
}

// Over budget, drop signs in tiers: side-street shop signs outside hot districts first, then
// hot-district shop signs, then any other wall sign. A no-op when the map fits (v2).
function thinToBudget(c: Ctx, budget: number): void {
  const excess = signCount(c.out) - budget;
  if (excess <= 0) return;
  const mainGap = roadGapIndex(
    { roads: c.L.roads.filter((r) => r.kind === 'arterial') },
    MAIN_ROAD_GAP,
  );
  const tier = (s: FlatSign): number => {
    const shop = s.kind === 'band' || s.kind === 'blade';
    if (!shop) return s.kind === 'crown' ? 6 : 4;
    return s.building < 0 || HOT_KINDS.has(c.L.buildings[s.building]?.district ?? '') ? 2 : 0;
  };
  const order = c.out.flats
    .map((s, i) => ({
      i,
      key: tier(s) + (mainGap(s.x, s.z) < MAIN_ROAD_GAP ? 1 : 0) + (s.seed % 9973) / 9973 / 2,
    }))
    .sort((a, z) => a.key - z.key || a.i - z.i);
  const drop = new Set(order.slice(0, excess).map((k) => k.i));
  c.out.flats = c.out.flats.filter((_, i) => !drop.has(i));
  if (signCount(c.out) > budget) {
    console.warn(`neon: ${signCount(c.out)} signs exceed the budget of ${budget}`);
  }
}

export interface PlacementOptions {
  seed?: number;
  /** Sign instances placed elsewhere (street panels and ads) that share the budget. */
  reserved?: number;
  maxScreens?: number;
  maxRings?: number;
  maxHolos?: number;
}

// `faces[id]` must equal `buildingFaces(L.buildings[id])`. Wall signs stay inside one tier face
// (y0 + 2 ≤ y ≤ y1 − 2, 1 m in from the edges) and never cut into any building solid.
export function placeSigns(
  L: Layout,
  faces: readonly (readonly BuildingFace[])[],
  cat: Catalog,
  opts: PlacementOptions = {},
): Placement {
  const seed = opts.seed ?? 0x5eed;
  const c: Ctx = {
    L,
    faces,
    cat,
    out: { flats: [], tubes: [], crosses: [], screens: [], rings: [], holos: [] },
    occupied: new Map(),
    roadGap: roadGapIndex(L),
  };
  const maxScreens = opts.maxScreens ?? 20;
  let ringBudget = opts.maxRings ?? 14;
  let mediaCount = 0;
  let mediaGapIndex: ((x: number, z: number) => number) | undefined;
  const mediaGap = (): ((x: number, z: number) => number) =>
    (mediaGapIndex ??= roadGapIndex(
      { roads: L.roads.filter((r) => r.kind === 'arterial') },
      MEDIA_MAIN_GAP,
    ));
  const maxHolos = opts.maxHolos ?? 36;

  // Unbuilt districts (palace grounds, parks) stay dark: no sign of any kind.
  const lit = L.buildings.filter((b) => !isUnbuilt(b.district));
  const byHeight = [...lit].sort((a, z) => z.h - a.h);
  for (const b of byHeight) {
    const rng = createRng((seed ^ Math.imul(b.seed | 0, 0x9e3779b1)) >>> 0);
    const zone = zoneDelay(b.district, rng);
    if (b.h >= 160 && c.out.screens.length < maxScreens) {
      placeScreens(
        c,
        b,
        rng,
        zone,
        Math.min(b.h >= 250 ? 2 : 1, maxScreens - c.out.screens.length),
      );
    }
    if (baseArchetype(b) === 'cylinderTower' && b.h >= 60) {
      ringBudget -= placeRings(c, b, rng, zone, ringBudget);
    }
    if (mediaCount < MEDIA_MAX && b.h >= 50 && districtSigns(b.district).media) {
      const a = baseArchetype(b);
      if (TOWERS.has(a) || a === 'officeSlab')
        mediaCount += placeMediaScreen(c, b, rng, zone, mediaGap()) ? 1 : 0;
    }
  }

  for (const b of lit) {
    const rng = createRng((seed ^ Math.imul((b.seed | 0) + 17, 0x85ebca6b)) >>> 0);
    const zone = zoneDelay(b.district, rng);
    const a = baseArchetype(b);
    const d = districtSigns(b.district);
    const tower = TOWERS.has(a);
    if (d.street && (a === 'sangga' || (a === 'officeSlab' && d.shops))) {
      const sc = d.shopScale;
      shopFaces(c, b).forEach((fi, k) => {
        placeBands(c, b, rng, zone, fi, (k === 0 ? 1.6 : 0.7) * sc);
        const bp = (a === 'sangga' ? 0.5 : 0.3) * (k === 0 ? 1.3 : 0.6) * sc;
        placeBlades(c, b, rng, zone, d.bladeScale === undefined ? bp : bp * d.bladeScale, fi);
      });
    } else if (d.street && a === 'officeSlab' && b.h < 40) {
      const fi = shopFaces(c, b)[0];
      if (fi !== undefined) placeBlades(c, b, rng, zone, 0.15, fi);
    }
    if (d.tubes && (tower || a === 'officeSlab')) {
      placeTubes(c, b, rng, zone);
    }
    if (b.h >= (d.vtextFromH ?? 20) && b.h <= 80 && d.vtext && rng.chance(0.6)) {
      for (let k = 0; k < (d.vtextCount ?? 1); k++) placeVText(c, b, rng, zone, d.vtextMinH);
    }
    if (b.tags.corp) {
      const cell = cat.cells.findIndex((k) => k.kind === 'crown' && k.key === b.tags.corp);
      placeCrown(c, b, rng, zone, cell, 2);
    } else if (a === 'apartmentSlab' && b.tags.complex) {
      const cell = cat.cells.findIndex((k) => k.kind === 'crown' && k.key === b.tags.complex);
      placeCrown(c, b, rng, zone, cell, 1);
    } else if ((tower || a === 'officeSlab') && b.h >= 40 && rng.chance(0.3)) {
      placeCrown(c, b, rng, zone, pickCell(c, 'crown', rng), 1);
    } else if (a === 'warehouse' && rng.chance(0.25)) {
      const cell = cat.cells.findIndex((k) => k.kind === 'crown' && k.key === CARGO_CROWN.name);
      placeCrown(c, b, rng, zone, cell, 1);
    }
    if (b.tags.cross)
      placeCross(c, b, rng, baseKind(b.district) === 'hillside' ? rng.range(0.62, 0.8) : zone);
  }

  const hrng = createRng(seed + 77);
  const koi = cat.byKind.koi[0] ?? -1;
  const logos = cat.byKind.logo;
  const roofs = lit
    .filter((b) => districtSigns(b.district).holos && b.h >= 60 && b.h <= 220)
    .sort((a, z) => a.seed - z.seed);
  for (const b of roofs) {
    if (c.out.holos.length >= maxHolos - 3) break;
    if (!hrng.chance(0.35) || logos.length === 0) continue;
    const t = topTier(b);
    if (!t) continue;
    placeHolo(c, t.x, t.z, t.y1 + b.spireH, hrng, zoneDelay(b.district, hrng), hrng.pick(logos));
  }
  if (koi >= 0) {
    const cl = L.river.centerline;
    for (const f of [0.3, 0.55, 0.8]) {
      const p = cl[Math.round(f * (cl.length - 1))];
      if (p) placeHolo(c, p.x, p.z, L.river.waterY + 14, hrng, 0.02, koi);
    }
  }
  placeBanners(c, createRng(seed + 99));
  thinToBudget(c, signBudget(L) - (opts.reserved ?? 0));
  return c.out;
}

export function hostTier(b: BuildingSpec, f: BuildingFace): Tier | undefined {
  return f.stack === 0 ? b.tiers[f.tier] : b.twin?.[f.tier];
}
