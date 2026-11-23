// District zones (layout v3, docs/SEOUL.md 4.2). `zoneAt` is the single classification
// function every other piece of the layout uses. The riverside band (channel + 60 m) wins
// first; every other zone belongs to one side of the river and the first zone containing the
// point wins, so zone polygons may overlap and the fill zones cover whatever is left. Bank
// strips are tested by distance from the bank (their offset polygons fold on the inner side of
// a bend), so their `polygon` is only an outline.
import { clamp, pointInPolygon } from './math';
import {
  HALF_X,
  HALF_Z,
  ISLANDS,
  RIVER,
  isNorthOfRiver,
  riverFrame,
  riverOffset,
  riverBeyondBounds,
  riverNearest,
  riverWidthAt,
} from './river';
import type { DistrictKind, DistrictZone, RoadKind, Vec2, ZoneHeights } from './types';

/** Half extent along x (kept for v2 callers; the map is not square). */
export const MAP_HALF = HALF_X;
const DEG = Math.PI / 180;

/** Distance from the centerline to the outer edge of the riverside band at x. */
export function riversideHalfAt(x: number): number {
  return riverWidthAt(x) / 2 + RIVER.bandWidth;
}

/** Outer edge of the riverside band at x, on the north (-1) or south (+1) side. */
export function bandEdgeZ(x: number, side: -1 | 1): number {
  return riverOffset(x, side * riversideHalfAt(x)).z;
}

type Side = 'north' | 'south';

interface BankStrip {
  x0: number;
  x1: number;
  o0: number;
  o1: number;
}

interface ZoneDef {
  id: string;
  kind: DistrictKind;
  name: string;
  nameEn: string;
  side: Side;
  polygon: Vec2[];
  /** Bank strip: x range of the point and its distance beyond the embankment (m). */
  bank?: BankStrip;
  gridAngle: number;
  origin: Vec2;
  pitch: [number, number];
  roadWidth: number;
  roadKind: RoadKind;
  heights: ZoneHeights;
  coverage: number;
  litScale: number;
}

const rect = (x0: number, x1: number, z0: number, z1: number): Vec2[] => [
  { x: x0, z: z0 },
  { x: x1, z: z0 },
  { x: x1, z: z1 },
  { x: x0, z: z1 },
];

function circle(cx: number, cz: number, r: number, n = 32): Vec2[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r };
  });
}

/** Strip along a bank between bank offsets o0..o1 (m outside the embankment), x0..x1. */
function bankStrip(x0: number, x1: number, side: Side, o0: number, o1: number): Vec2[] {
  const s = side === 'north' ? -1 : 1;
  const n = Math.max(2, Math.ceil((x1 - x0) / 25) + 1);
  const inner: Vec2[] = [];
  const outer: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / (n - 1);
    const bank = riverWidthAt(x) / 2;
    inner.push(riverOffset(x, s * (bank + o0)));
    outer.push(riverOffset(x, s * (bank + o1)));
  }
  return [...inner, ...outer.reverse()];
}

/** Rectangle of half widths around segment a→b (a road corridor). */
function corridor(a: Vec2, b: Vec2, half: number, ext = 0): Vec2[] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const nx = -uz * half;
  const nz = ux * half;
  const a2 = { x: a.x - ux * ext, z: a.z - uz * ext };
  const b2 = { x: b.x + ux * ext, z: b.z + uz * ext };
  return [
    { x: a2.x + nx, z: a2.z + nz },
    { x: b2.x + nx, z: b2.z + nz },
    { x: b2.x - nx, z: b2.z - nz },
    { x: a2.x - nx, z: a2.z - nz },
  ];
}

/** Grid angle (rotY convention) that aligns a grid's local x with the river at x. */
function riverAngle(x: number): number {
  const { along } = riverFrame(x);
  return Math.atan2(-along.z, along.x);
}

/** Grid angle that aligns local x with the direction a→b. */
function angleOf(a: Vec2, b: Vec2): number {
  return Math.atan2(-(b.z - a.z), b.x - a.x);
}

/** 테헤란로 end points (강남역 → 삼성역, SEOUL.md 5.3). */
export const TEHERAN: readonly [Vec2, Vec2] = [
  { x: 559, z: 592 },
  { x: 1073, z: 389 },
];

const H = (min: number, max: number, tallShare = 0, tallMax = max): ZoneHeights => ({
  min,
  max,
  tallShare,
  tallMax,
});

const yeouido = ISLANDS.find((i) => i.id === 'yeouido');
if (!yeouido) throw new Error('yeouido island missing');

const DEFS: ZoneDef[] = [
  // --- north bank, specific zones first ---
  {
    id: 'namsan',
    kind: 'park',
    name: '남산',
    nameEn: 'NAMSAN',
    side: 'north',
    polygon: circle(-176, -389, 170),
    gridAngle: 0,
    origin: { x: -176, z: -389 },
    pitch: [0, 0],
    roadWidth: 0,
    roadKind: 'alley',
    heights: H(0, 0),
    coverage: 0,
    litScale: 0,
  },
  {
    id: 'palace',
    kind: 'palace',
    name: '궁궐',
    nameEn: 'PALACE',
    side: 'north',
    polygon: rect(-400, 20, -1090, -890),
    gridAngle: 0,
    origin: { x: -400, z: -1090 },
    pitch: [210, 200],
    roadWidth: 8,
    roadKind: 'street',
    heights: H(6, 18),
    coverage: 0.12,
    litScale: 0,
  },
  {
    id: 'bugak',
    kind: 'park',
    name: '북악·인왕',
    nameEn: 'BUGAK',
    side: 'north',
    polygon: rect(-760, 200, -1300, -1050),
    gridAngle: 0,
    origin: { x: -200, z: -1180 },
    pitch: [0, 0],
    roadWidth: 0,
    roadKind: 'alley',
    heights: H(0, 0),
    coverage: 0,
    litScale: 0,
  },
  {
    id: 'jongno',
    kind: 'oldtown',
    name: '종로·광화문',
    nameEn: 'JONGNO',
    side: 'north',
    polygon: rect(-520, 320, -890, -580),
    gridAngle: 0,
    origin: { x: -190, z: -820 },
    pitch: [48, 48],
    roadWidth: 6,
    roadKind: 'street',
    heights: H(8, 30, 0.05, 70),
    coverage: 0.55,
    litScale: 0.5,
  },
  {
    id: 'apt-ichon',
    kind: 'apartment',
    name: '이촌',
    nameEn: 'ICHON',
    side: 'north',
    polygon: bankStrip(-300, -60, 'north', 0, 170),
    bank: { x0: -300, x1: -60, o0: 0, o1: 170 },
    gridAngle: riverAngle(-265),
    origin: riverOffset(-265, -(riverWidthAt(-265) / 2 + 60)),
    pitch: [130, 90],
    roadWidth: 10,
    roadKind: 'street',
    heights: H(70, 100),
    coverage: 0.25,
    litScale: 1,
  },
  {
    id: 'itaewon',
    kind: 'hillside',
    name: '이태원·해방촌',
    nameEn: 'ITAEWON',
    side: 'north',
    polygon: rect(-110, 300, -400, 260),
    gridAngle: 4 * DEG,
    origin: { x: 0, z: -200 },
    pitch: [48, 48],
    roadWidth: 3,
    roadKind: 'alley',
    heights: H(6, 16),
    coverage: 0.65,
    litScale: 0.8,
  },
  {
    id: 'yongsan',
    kind: 'megacore',
    name: '용산 국제업무지구',
    nameEn: 'YONGSAN',
    side: 'north',
    polygon: rect(-640, -110, -420, 260),
    gridAngle: -20 * DEG,
    origin: { x: -380, z: -80 },
    pitch: [120, 120],
    roadWidth: 20,
    roadKind: 'arterial',
    heights: H(80, 260, 0.1, 600),
    coverage: 0.3,
    litScale: 0.9,
  },
  {
    id: 'hongdae',
    kind: 'nightlife',
    name: '홍대·마포',
    nameEn: 'HONGDAE',
    side: 'north',
    polygon: rect(-1400, -840, -820, 260),
    gridAngle: 12 * DEG,
    origin: { x: -990, z: -480 },
    pitch: [56, 56],
    roadWidth: 10,
    roadKind: 'street',
    heights: H(9, 30, 0.1, 60),
    coverage: 0.7,
    litScale: 0.7,
  },
  {
    id: 'mapo',
    kind: 'midtown',
    name: '마포·공덕',
    nameEn: 'MAPO',
    side: 'north',
    polygon: rect(-840, -400, -900, 260),
    gridAngle: -15 * DEG,
    origin: { x: -573, z: -259 },
    pitch: [110, 110],
    roadWidth: 16,
    roadKind: 'street',
    heights: H(30, 140, 0.15, 210),
    coverage: 0.4,
    litScale: 1,
  },
  {
    id: 'seongsu',
    kind: 'brick',
    name: '성수',
    nameEn: 'SEONGSU',
    side: 'north',
    polygon: rect(760, 1300, -760, 260),
    gridAngle: 8 * DEG,
    origin: { x: 980, z: -420 },
    pitch: [70, 70],
    roadWidth: 16,
    roadKind: 'street',
    heights: H(8, 24, 0.1, 90),
    coverage: 0.6,
    litScale: 0.6,
  },
  {
    id: 'apt-gwangjin',
    kind: 'apartment',
    name: '광진',
    nameEn: 'GWANGJIN',
    side: 'north',
    polygon: rect(1300, 2000, -1000, 260),
    gridAngle: riverAngle(1650),
    origin: riverOffset(1650, -(riverWidthAt(1650) / 2 + 60)),
    pitch: [130, 90],
    roadWidth: 10,
    roadKind: 'street',
    heights: H(40, 90),
    coverage: 0.25,
    litScale: 1,
  },
  {
    id: 'wangsimni',
    kind: 'sangga',
    name: '왕십리·옥수',
    nameEn: 'WANGSIMNI',
    side: 'north',
    polygon: rect(290, 760, -1000, 260),
    gridAngle: 5 * DEG,
    origin: { x: 450, z: -500 },
    pitch: [72, 72],
    roadWidth: 12,
    roadKind: 'street',
    heights: H(12, 40, 0.1, 70),
    coverage: 0.5,
    litScale: 1,
  },
  {
    id: 'fill-north',
    kind: 'sangga',
    name: '서울 북부',
    nameEn: 'SEOUL NORTH',
    side: 'north',
    polygon: rect(-HALF_X, HALF_X, -HALF_Z, HALF_Z),
    gridAngle: -6 * DEG,
    origin: { x: 0, z: -900 },
    pitch: [72, 72],
    roadWidth: 12,
    roadKind: 'street',
    heights: H(12, 40, 0.1, 60),
    coverage: 0.5,
    litScale: 1,
  },
  // --- south bank ---
  {
    id: 'yeouido',
    kind: 'megacore',
    name: '여의도',
    nameEn: 'YEOUIDO',
    side: 'south',
    polygon: yeouido.polygon,
    gridAngle: riverAngle(-930),
    origin: riverOffset(-1090, riverWidthAt(-1090) / 2 + 170),
    pitch: [120, 120],
    roadWidth: 20,
    roadKind: 'arterial',
    heights: H(120, 250, 0.1, 430),
    coverage: 0.35,
    litScale: 0.9,
  },
  {
    id: 'apt-banpo',
    kind: 'apartment',
    name: '반포',
    nameEn: 'BANPO',
    side: 'south',
    polygon: bankStrip(-250, 420, 'south', 0, 280),
    bank: { x0: -250, x1: 420, o0: 0, o1: 280 },
    gridAngle: riverAngle(90),
    origin: riverOffset(90, riverWidthAt(90) / 2 + 60),
    pitch: [130, 90],
    roadWidth: 10,
    roadKind: 'street',
    heights: H(70, 100, 0.1, 120),
    coverage: 0.25,
    litScale: 1,
  },
  {
    id: 'apt-apgu',
    kind: 'apartment',
    name: '압구정',
    nameEn: 'APGUJEONG',
    side: 'south',
    polygon: bankStrip(420, 900, 'south', 0, 250),
    bank: { x0: 420, x1: 900, o0: 0, o1: 250 },
    gridAngle: riverAngle(660),
    origin: riverOffset(660, riverWidthAt(660) / 2 + 60),
    pitch: [130, 90],
    roadWidth: 10,
    roadKind: 'street',
    heights: H(40, 70),
    coverage: 0.25,
    litScale: 1,
  },
  {
    id: 'apt-jamsil',
    kind: 'apartment',
    name: '잠실 강변',
    nameEn: 'JAMSIL RIVERSIDE',
    side: 'south',
    polygon: bankStrip(1150, 1450, 'south', 0, 250),
    bank: { x0: 1150, x1: 1450, o0: 0, o1: 250 },
    gridAngle: riverAngle(1300),
    origin: riverOffset(1300, riverWidthAt(1300) / 2 + 60),
    pitch: [130, 90],
    roadWidth: 10,
    roadKind: 'street',
    heights: H(70, 100),
    coverage: 0.25,
    litScale: 1,
  },

  {
    id: 'gangnam',
    kind: 'corridor',
    name: '강남·테헤란로',
    nameEn: 'TEHERAN-RO',
    side: 'south',
    polygon: corridor(TEHERAN[0], TEHERAN[1], 160, 40),
    gridAngle: angleOf(TEHERAN[0], TEHERAN[1]),
    origin: TEHERAN[0],
    pitch: [90, 90],
    roadWidth: 14,
    roadKind: 'street',
    heights: H(30, 80, 0.4, 260),
    coverage: 0.45,
    litScale: 1,
  },
  {
    id: 'cheongdam',
    kind: 'showroom',
    name: '압구정·청담',
    nameEn: 'CHEONGDAM',
    side: 'south',
    polygon: bankStrip(480, 1150, 'south', 250, 430),
    bank: { x0: 480, x1: 1150, o0: 250, o1: 430 },
    gridAngle: -10 * DEG,
    origin: { x: 700, z: 230 },
    pitch: [80, 80],
    roadWidth: 20,
    roadKind: 'street',
    heights: H(6, 18, 0.5, 70),
    coverage: 0.4,
    litScale: 1,
  },
  {
    id: 'jamsil',
    kind: 'megacore',
    name: '잠실',
    nameEn: 'JAMSIL',
    side: 'south',
    polygon: rect(1400, 2000, -400, 760),
    gridAngle: 0,
    origin: { x: 1650, z: 330 },
    pitch: [200, 200],
    roadWidth: 30,
    roadKind: 'arterial',
    heights: H(80, 160, 0, 500),
    coverage: 0.25,
    litScale: 0.9,
  },
  {
    id: 'seocho',
    kind: 'midtown',
    name: '서초·동작',
    nameEn: 'SEOCHO',
    side: 'south',
    polygon: rect(-900, 520, 560, HALF_Z),
    gridAngle: 10 * DEG,
    origin: { x: -200, z: 800 },
    pitch: [120, 120],
    roadWidth: 16,
    roadKind: 'street',
    heights: H(30, 120, 0.1, 160),
    coverage: 0.35,
    litScale: 1,
  },
  {
    id: 'yeongdeungpo',
    kind: 'sangga',
    name: '영등포',
    nameEn: 'YEONGDEUNGPO',
    side: 'south',
    polygon: rect(-HALF_X, -700, -1000, HALF_Z),
    gridAngle: -4 * DEG,
    origin: { x: -1100, z: 450 },
    pitch: [72, 72],
    roadWidth: 12,
    roadKind: 'street',
    heights: H(12, 40, 0.1, 120),
    coverage: 0.55,
    litScale: 1,
  },
  {
    id: 'fill-south',
    kind: 'midtown',
    name: '서울 남부',
    nameEn: 'SEOUL SOUTH',
    side: 'south',
    polygon: rect(-HALF_X, HALF_X, -HALF_Z, HALF_Z),
    gridAngle: 6 * DEG,
    origin: { x: 0, z: 900 },
    pitch: [110, 110],
    roadWidth: 16,
    roadKind: 'street',
    heights: H(30, 100, 0.1, 140),
    coverage: 0.4,
    litScale: 1,
  },
];

function bandPolygon(): Vec2[] {
  const north: Vec2[] = [];
  const south: Vec2[] = [];
  for (let x = -HALF_X; x <= HALF_X + 1e-6; x += 25) {
    north.push(riverOffset(x, -riversideHalfAt(x)));
    south.push(riverOffset(x, riversideHalfAt(x)));
  }
  return [...north, ...south.reverse()];
}

const riversideZone: DistrictZone = {
  id: 'riverside',
  kind: 'riverside',
  name: '강변·둔치',
  nameEn: 'HANGANG PARK',
  polygon: bandPolygon(),
  gridAngle: 0,
  origin: { x: 0, z: 0 },
  roadPitch: 0,
  roadPitchV: 0,
  roadWidth: 0,
  roadKind: 'street',
  heights: H(0, 8),
  coverage: 0.05,
  litScale: 1,
};

const SIDE_OF = new Map<string, Side>(DEFS.map((d) => [d.id, d.side]));
const BANK_OF = new Map<string, BankStrip>(
  DEFS.flatMap((d) => (d.bank ? [[d.id, d.bank] as const] : [])),
);

/** All zones, in classification order. The riverside band comes first. */
export const ZONES: readonly DistrictZone[] = [
  riversideZone,
  ...DEFS.map((d): DistrictZone => ({
    id: d.id,
    kind: d.kind,
    name: d.name,
    nameEn: d.nameEn,
    polygon: d.polygon,
    gridAngle: d.gridAngle,
    origin: d.origin,
    roadPitch: d.pitch[0],
    roadPitchV: d.pitch[1],
    roadWidth: d.roadWidth,
    roadKind: d.roadKind,
    heights: d.heights,
    coverage: d.coverage,
    litScale: d.litScale,
  })),
];

const NORTH = ZONES.filter((z) => SIDE_OF.get(z.id) === 'north');
const SOUTH = ZONES.filter((z) => SIDE_OF.get(z.id) === 'south');

const ZONE_BY_ID = new Map(ZONES.map((z) => [z.id, z]));

export function zoneById(id: string): DistrictZone {
  const z = ZONE_BY_ID.get(id);
  if (!z) throw new Error(`unknown zone ${id}`);
  return z;
}

/** Side of the river a zone belongs to (null for the riverside band). */
export function zoneSide(id: string): Side | null {
  return SIDE_OF.get(id) ?? null;
}

/** Zone containing (x, z). Points outside the map are clamped onto it. */
export function zoneAt(x: number, z: number): DistrictZone {
  const e = 1e-6;
  const p = { x: clamp(x, -HALF_X + e, HALF_X - e), z: clamp(z, -HALF_Z + e, HALF_Z - e) };
  // The distance beyond the bank is only computed exactly when a threshold (band edge, bank
  // strip offsets) falls inside its cheap bounds.
  const b = riverBeyondBounds(p.x, p.z);
  let exact: number | null = null;
  const beyond = (): number => {
    if (exact === null) {
      const n = riverNearest(p.x, p.z);
      exact = n.d - riverWidthAt(n.cx) / 2;
    }
    return exact;
  };
  /** v ≤ t, deciding from the bounds when they do not straddle t. */
  const atMost = (t: number): boolean => (b.hi <= t ? true : b.lo > t ? false : beyond() <= t);
  /** v < t, likewise. */
  const below = (t: number): boolean => (b.hi < t ? true : b.lo >= t ? false : beyond() < t);
  if (atMost(RIVER.bandWidth)) return riversideZone;
  const list = isNorthOfRiver(p.x, p.z) ? NORTH : SOUTH;
  for (const zone of list) {
    const bank = BANK_OF.get(zone.id);
    if (bank) {
      if (p.x >= bank.x0 && p.x <= bank.x1 && !below(bank.o0) && below(bank.o1)) {
        return zone;
      }
    } else if (pointInPolygon(p, zone.polygon)) {
      return zone;
    }
  }
  // The fill zones cover the whole map, so this only happens exactly on their edge.
  return list[list.length - 1] as DistrictZone;
}

export function districtAt(x: number, z: number): DistrictKind {
  return zoneAt(x, z).kind;
}
