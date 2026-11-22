// Elevated highways, at-grade riverside road and the three bridges (ART_DIRECTION 2.3, 2.5).
// Curves are centripetal Catmull-Rom (three.js CatmullRomCurve3) so infra and neon traffic
// evaluate exactly the same path from the same control points.
import { CatmullRomCurve3, Vector3 } from 'three';
import { pointSegmentDistance } from './math';
import { MAP_HALF, RIVERSIDE_HALF } from './districts';
import { RIVER, riverFrame } from './river';
import type { Bridge, BridgeKind, Highway, HighwayKind, Vec2, Vec3 } from './types';

/** Extra no-build margin around a highway deck: corridor = width + 6 m. */
const CORRIDOR_MARGIN = 6;
/** Lateral offset of the riverside highways from the river centerline (m). */
const HW_OFFSET = 150;

/** Ring road (hw-ring): rounded rectangle on the core arterial grid, around the skyline peak. */
export const RING = { x0: -330, x1: 210, z0: -650, z1: -110, radius: 160 } as const;
const RING_C = { x: (RING.x0 + RING.x1) / 2, z: (RING.z0 + RING.z1) / 2 };

/** Ring deck height at a position: 22..28 m, two gentle waves per lap. */
export function ringDeckY(x: number, z: number): number {
  return 25 + 3 * Math.sin(2 * Math.atan2(z - RING_C.z, x - RING_C.x));
}

const BRIDGE_DEFS: {
  id: string;
  kind: BridgeKind;
  x: number;
  deckY: number;
  lowerDeckY?: number;
  width: number;
  lanes: number;
  structureH: number;
}[] = [
  { id: 'bridge-a', kind: 'arch', x: -520, deckY: 12, width: 28, lanes: 6, structureH: 36 },
  { id: 'bridge-b', kind: 'truss', x: 140, deckY: 10, width: 24, lanes: 4, structureH: 14 },
  {
    id: 'bridge-c',
    kind: 'doubleDeck',
    x: 760,
    deckY: 10,
    lowerDeckY: 4,
    width: 30,
    lanes: 6,
    structureH: 6,
  },
];

/** Distance from the centerline to the approach landing (outer edge of the riverside band). */
export const BRIDGE_LAND = RIVERSIDE_HALF;

export function makeBridges(): Bridge[] {
  return BRIDGE_DEFS.map((d) => {
    const { p, south } = riverFrame(d.x);
    const at = (k: number): Vec2 => ({ x: p.x + south.x * k, z: p.z + south.z * k });
    const half = RIVER.width / 2;
    const b: Bridge = {
      id: d.id,
      kind: d.kind,
      a: at(-half),
      b: at(half),
      landA: at(-BRIDGE_LAND),
      landB: at(BRIDGE_LAND),
      deckY: d.deckY,
      width: d.width,
      lanes: d.lanes,
      structureH: d.structureH,
    };
    if (d.lowerDeckY !== undefined) b.lowerDeckY = d.lowerDeckY;
    return b;
  });
}

function riverOffsetPoints(offset: number, y: number): Vec3[] {
  return Array.from({ length: 33 }, (_, i) => {
    const x = -1300 + (2600 * i) / 32;
    const { p, south } = riverFrame(x);
    return { x: p.x + south.x * offset, y, z: p.z + south.z * offset };
  });
}

function ringPoints(): Vec3[] {
  const { x0, x1, z0, z1, radius: r } = RING;
  // Corner centers, walked clockwise when viewed from above (north = -Z up the screen).
  const corners = [
    { cx: x1 - r, cz: z0 + r, a0: -Math.PI / 2 }, // NE
    { cx: x1 - r, cz: z1 - r, a0: 0 }, // SE
    { cx: x0 + r, cz: z1 - r, a0: Math.PI / 2 }, // SW
    { cx: x0 + r, cz: z0 + r, a0: Math.PI }, // NW
  ];
  const pts: Vec3[] = [];
  for (const c of corners) {
    for (let k = 0; k <= 4; k++) {
      const a = c.a0 + (k / 4) * (Math.PI / 2);
      const x = c.cx + Math.cos(a) * r;
      const z = c.cz + Math.sin(a) * r;
      pts.push({ x, y: ringDeckY(x, z), z });
    }
  }
  return pts;
}

/** z of hw-river-north at x (approximate; exact enough to aim ramps at it). */
function riverNorthAt(x: number, y: number): Vec3 {
  const { p, south } = riverFrame(x);
  return { x: p.x - south.x * HW_OFFSET, y, z: p.z - south.z * HW_OFFSET };
}

function bezierPoints(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, n = 12): Vec3[] {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    return {
      x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x,
      y: p0.y + (p3.y - p0.y) * t,
      z: w0 * p0.z + w1 * p1.z + w2 * p2.z + w3 * p3.z,
    };
  });
}

function rampPoints(id: 'a' | 'b'): Vec3[] {
  if (id === 'a') {
    // Ring east side → river-north, eastbound (inner ramp, descending 25 → 14).
    const p0 = { x: RING.x1, y: ringDeckY(RING.x1, -300), z: -300 };
    const end = riverNorthAt(480, 14);
    const pre = riverNorthAt(360, 14);
    return bezierPoints(p0, { x: RING.x1 + 15, y: 0, z: -200 }, pre, end);
  }
  // River-north westbound → ring east side (outer ramp, climbing 14 → ~25).
  const p0 = riverNorthAt(620, 14);
  const p1 = riverNorthAt(480, 14);
  const p3 = { x: RING.x1, y: ringDeckY(RING.x1, -440), z: -440 };
  return bezierPoints(p0, { ...p1, z: p1.z - 30 }, { x: RING.x1 + 20, y: 0, z: -360 }, p3);
}

interface HwDef {
  id: string;
  kind: HighwayKind;
  points: Vec3[];
  closed: boolean;
  width: number;
  lanes: number;
  pillarSpacing: number;
}

function hwDefs(): HwDef[] {
  return [
    {
      id: 'hw-river-north',
      kind: 'elevated',
      points: riverOffsetPoints(-HW_OFFSET, 14),
      closed: false,
      width: 26,
      lanes: 6,
      pillarSpacing: 36,
    },
    {
      id: 'hw-ring',
      kind: 'elevated',
      points: ringPoints(),
      closed: true,
      width: 18,
      lanes: 4,
      pillarSpacing: 32,
    },
    {
      id: 'hw-interchange-a',
      kind: 'ramp',
      points: rampPoints('a'),
      closed: false,
      width: 10,
      lanes: 2,
      pillarSpacing: 28,
    },
    {
      id: 'hw-interchange-b',
      kind: 'ramp',
      points: rampPoints('b'),
      closed: false,
      width: 10,
      lanes: 2,
      pillarSpacing: 28,
    },
    {
      id: 'hw-south',
      kind: 'atGrade',
      points: riverOffsetPoints(HW_OFFSET, 0.3),
      closed: false,
      width: 24,
      lanes: 6,
      pillarSpacing: 0,
    },
  ];
}

/** three.js curve for a highway (centripetal Catmull-Rom through `points`). */
export function highwayCurve(hw: Pick<Highway, 'points' | 'closed'>): CatmullRomCurve3 {
  return new CatmullRomCurve3(
    hw.points.map((p) => new Vector3(p.x, p.y, p.z)),
    hw.closed,
    'centripetal',
  );
}

/** Evenly spaced samples along a highway (about every `step` m), as plain points. */
export function highwaySamples(hw: Pick<Highway, 'points' | 'closed'>, step = 8): Vec3[] {
  const curve = highwayCurve(hw);
  const n = Math.max(2, Math.ceil(curve.getLength() / step));
  return curve.getSpacedPoints(n).map((v) => ({ x: v.x, y: v.y, z: v.z }));
}

/** True if (x, z) is on a bridge deck or approach footprint (with `margin`). */
export function onBridge(bridges: readonly Bridge[], p: Vec2, margin = 0): boolean {
  return bridges.some((b) => pointSegmentDistance(p, b.landA, b.landB) < b.width / 2 + margin);
}

export function makeHighways(bridges: readonly Bridge[]): Highway[] {
  return hwDefs().map((d) => {
    const pillars: Vec3[] = [];
    if (d.pillarSpacing > 0) {
      const curve = highwayCurve(d);
      const len = curve.getLength();
      const n = Math.floor(len / d.pillarSpacing);
      const pts = curve.getSpacedPoints(d.closed ? n : Math.max(1, n));
      // Ramps: skip the ends, they sit on the parent highway's own pillars.
      const skipEnds = d.kind === 'ramp' ? 1 : 0;
      for (let i = skipEnds; i < pts.length - skipEnds; i++) {
        if (d.closed && i === pts.length - 1) break; // closed curves repeat the first point
        const v = pts[i] as Vector3;
        if (Math.abs(v.x) > MAP_HALF || Math.abs(v.z) > MAP_HALF) continue;
        if (onBridge(bridges, { x: v.x, z: v.z }, 4)) continue;
        pillars.push({ x: v.x, y: v.y, z: v.z });
      }
    }
    return { ...d, pillars, corridorHalf: (d.width + CORRIDOR_MARGIN) / 2 };
  });
}
