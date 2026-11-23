// District zones (ART_DIRECTION 2.2). Zones partition the 2400 m map; `zoneAt` is the
// single classification function every other piece of the layout uses.
import { clamp, pointInPolygon } from './math';
import { RIVER, TERRAIN, riverSlope, riverZ } from './river';
import type { DistrictKind, DistrictZone, RoadKind, Vec2, ZoneHeights } from './types';

export const MAP_HALF = 1200;
const DEG = Math.PI / 180;
const HILL_Z = TERRAIN.hillStartZ;
/** Distance from the river centerline to the outer edge of the riverside band. */
export const RIVERSIDE_HALF = RIVER.width / 2 + RIVER.bandWidth;

/** Outer edge of the riverside band at x, on the north (-1) or south (+1) side. */
export function bandEdgeZ(x: number, side: -1 | 1): number {
  return riverZ(x) + side * RIVERSIDE_HALF * Math.hypot(1, riverSlope(x));
}

function edge(x0: number, x1: number, side: -1 | 1): Vec2[] {
  const n = Math.max(2, Math.ceil(Math.abs(x1 - x0) / 50) + 1);
  return Array.from({ length: n }, (_, i) => {
    const x = x0 + ((x1 - x0) * i) / (n - 1);
    return { x, z: bandEdgeZ(x, side) };
  });
}

type V2Kind = Extract<
  DistrictKind,
  'core' | 'midtown' | 'sangga' | 'apartment' | 'industrial' | 'hillside' | 'riverside'
>;

interface ZoneDef {
  id: string;
  kind: V2Kind;
  name: string;
  x0: number;
  x1: number;
  /** 'north' / 'south' of the river band, 'hill' = z < -650. */
  area: 'north' | 'south' | 'hill';
  gridAngle: number;
  origin: Vec2;
  pitch: [number, number];
  roadWidth: number;
  roadKind: RoadKind;
}

const DEFS: ZoneDef[] = [
  {
    id: 'core',
    kind: 'core',
    name: '정점지구',
    x0: -380,
    x1: 380,
    area: 'north',
    gridAngle: 0,
    origin: { x: -150, z: -470 },
    pitch: [180, 180],
    roadWidth: 30,
    roadKind: 'arterial',
  },
  {
    id: 'midtown',
    kind: 'midtown',
    name: '중층 업무지',
    x0: 380,
    x1: MAP_HALF,
    area: 'north',
    gridAngle: 0,
    origin: { x: 390, z: -650 },
    pitch: [120, 120],
    roadWidth: 16,
    roadKind: 'street',
  },
  {
    id: 'sangga-n',
    kind: 'sangga',
    name: '등불가',
    x0: -MAP_HALF,
    x1: -380,
    area: 'north',
    gridAngle: 7 * DEG,
    origin: { x: -380, z: -650 },
    pitch: [72, 72],
    roadWidth: 12,
    roadKind: 'street',
  },
  {
    id: 'sangga-s',
    kind: 'sangga',
    name: '남측 등불가',
    x0: -MAP_HALF,
    x1: -450,
    area: 'south',
    gridAngle: -4 * DEG,
    origin: { x: -450, z: 420 },
    pitch: [72, 72],
    roadWidth: 12,
    roadKind: 'street',
  },
  {
    id: 'apartment',
    kind: 'apartment',
    name: '새빛마을',
    x0: -450,
    x1: 550,
    area: 'south',
    gridAngle: 15 * DEG,
    origin: { x: 50, z: 700 },
    pitch: [270, 210],
    roadWidth: 10,
    roadKind: 'street',
  },
  {
    id: 'industrial',
    kind: 'industrial',
    name: '물류·산업',
    x0: 550,
    x1: MAP_HALF,
    area: 'south',
    gridAngle: 0,
    origin: { x: 550, z: 420 },
    pitch: [140, 140],
    roadWidth: 20,
    roadKind: 'street',
  },
  {
    id: 'hill-w',
    kind: 'hillside',
    name: '별계단동',
    x0: -MAP_HALF,
    x1: -400,
    area: 'hill',
    gridAngle: -6 * DEG,
    origin: { x: -800, z: HILL_Z },
    pitch: [48, 48],
    roadWidth: 3,
    roadKind: 'alley',
  },
  {
    id: 'hill-c',
    kind: 'hillside',
    name: '별계단동',
    x0: -400,
    x1: 400,
    area: 'hill',
    gridAngle: 2 * DEG,
    origin: { x: 0, z: HILL_Z },
    pitch: [48, 48],
    roadWidth: 3,
    roadKind: 'alley',
  },
  {
    id: 'hill-e',
    kind: 'hillside',
    name: '별계단동',
    x0: 400,
    x1: MAP_HALF,
    area: 'hill',
    gridAngle: 7 * DEG,
    origin: { x: 800, z: HILL_Z },
    pitch: [48, 48],
    roadWidth: 3,
    roadKind: 'alley',
  },
];

/**
 * v2 zone profile per kind: target values from ART_DIRECTION 2.2, not derived from the
 * generator (which does not read them; megatowers and the block height rules go beyond them).
 */
const V2_PROFILE: Record<V2Kind, { nameEn: string; heights: ZoneHeights; coverage: number }> = {
  core: {
    nameEn: 'APEX',
    heights: { min: 120, max: 245, tallShare: 0.1, tallMax: 520 },
    coverage: 0.35,
  },
  midtown: {
    nameEn: 'MIDTOWN',
    heights: { min: 40, max: 140, tallShare: 0.15, tallMax: 210 },
    coverage: 0.4,
  },
  sangga: {
    nameEn: 'LANTERN ST',
    heights: { min: 12, max: 32, tallShare: 0.1, tallMax: 70 },
    coverage: 0.55,
  },
  apartment: {
    nameEn: 'SAEBIT',
    heights: { min: 42, max: 70, tallShare: 0, tallMax: 70 },
    coverage: 0.25,
  },
  industrial: {
    nameEn: 'LOGISTICS',
    heights: { min: 10, max: 30, tallShare: 0, tallMax: 30 },
    coverage: 0.45,
  },
  hillside: {
    nameEn: 'STAR STEPS',
    heights: { min: 6, max: 14, tallShare: 0, tallMax: 14 },
    coverage: 0.6,
  },
  riverside: {
    nameEn: 'RIVERSIDE',
    heights: { min: 0, max: 8, tallShare: 0, tallMax: 8 },
    coverage: 0.05,
  },
};

function profile(kind: V2Kind): {
  nameEn: string;
  heights: ZoneHeights;
  coverage: number;
  litScale: number;
} {
  const p = V2_PROFILE[kind];
  return { ...p, heights: { ...p.heights }, litScale: 1 };
}

function polygonFor(d: ZoneDef): Vec2[] {
  switch (d.area) {
    case 'hill':
      return [
        { x: d.x0, z: -MAP_HALF },
        { x: d.x1, z: -MAP_HALF },
        { x: d.x1, z: HILL_Z },
        { x: d.x0, z: HILL_Z },
      ];
    case 'north':
      return [{ x: d.x0, z: HILL_Z }, { x: d.x1, z: HILL_Z }, ...edge(d.x1, d.x0, -1)];
    case 'south':
      return [...edge(d.x0, d.x1, 1), { x: d.x1, z: MAP_HALF }, { x: d.x0, z: MAP_HALF }];
  }
}

const riversideZone: DistrictZone = {
  id: 'riverside',
  kind: 'riverside',
  name: '강변·둔치',
  polygon: [...edge(-MAP_HALF, MAP_HALF, -1), ...edge(MAP_HALF, -MAP_HALF, 1)],
  gridAngle: 0,
  origin: { x: 0, z: 0 },
  roadPitch: 0,
  roadPitchV: 0,
  roadWidth: 0,
  roadKind: 'street',
  ...profile('riverside'),
};

/** All zones. The riverside band comes first so it wins over its neighbours. */
export const ZONES: readonly DistrictZone[] = [
  riversideZone,
  ...DEFS.map((d): DistrictZone => ({
    id: d.id,
    kind: d.kind,
    name: d.name,
    polygon: polygonFor(d),
    gridAngle: d.gridAngle,
    origin: d.origin,
    roadPitch: d.pitch[0],
    roadPitchV: d.pitch[1],
    roadWidth: d.roadWidth,
    roadKind: d.roadKind,
    ...profile(d.kind),
  })),
];

const ZONE_BY_ID = new Map(ZONES.map((z) => [z.id, z]));

export function zoneById(id: string): DistrictZone {
  const z = ZONE_BY_ID.get(id);
  if (!z) throw new Error(`unknown zone ${id}`);
  return z;
}

/** Zone containing (x, z). Points outside the map are clamped onto it. */
export function zoneAt(x: number, z: number): DistrictZone {
  const e = 1e-6;
  const p = { x: clamp(x, -MAP_HALF + e, MAP_HALF - e), z: clamp(z, -MAP_HALF + e, MAP_HALF - e) };
  // Fast paths keep this cheap; the polygons agree with them.
  if (Math.abs(p.z - riverZ(p.x)) <= RIVERSIDE_HALF * Math.hypot(1, riverSlope(p.x))) {
    return riversideZone;
  }
  // Exactly on a shared edge or vertex: retry with tiny nudges.
  for (const [dx, dz] of NUDGES) {
    const q = { x: p.x + dx, z: p.z + dz };
    for (const zone of ZONES) {
      if (zone !== riversideZone && pointInPolygon(q, zone.polygon)) return zone;
    }
  }
  return riversideZone;
}

const NUDGES = [
  [0, 0],
  [0.01, 0.01],
  [-0.01, 0.01],
  [0.01, -0.01],
  [-0.01, -0.01],
] as const;

export function districtAt(x: number, z: number): DistrictKind {
  return zoneAt(x, z).kind;
}
