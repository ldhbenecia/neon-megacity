// 한강 bridges (SEOUL.md 3.3) and the riverside / 내부순환로 highways (SEOUL.md 5.3).
// Curves are centripetal Catmull-Rom (three.js CatmullRomCurve3) so infra and neon traffic
// evaluate exactly the same path from the same control points.
import { CatmullRomCurve3, Vector3 } from 'three';
import { pointSegmentDistance } from './math';
import {
  HALF_X,
  HALF_Z,
  riverFrame,
  riverNearest,
  riverOffset,
  riverSignedDistance,
  riverWidthAt,
  riverZ,
} from './river';
import type {
  Bridge,
  BridgeKind,
  BridgeMotif,
  Highway,
  HighwayKind,
  IslandId,
  Vec2,
  Vec3,
} from './types';

/** Extra no-build margin around a highway deck: corridor = width + 6 m. */
const CORRIDOR_MARGIN = 6;

/** 강변북로: centre this far outside the north embankment (m), deck height. */
export const GANGBYEON_OFFSET = 30;
/**
 * 강변북로 deck height. It passes over the north bridge approaches 17..43 m outside the bank,
 * where the highest approach (반포대교, 16 m over a 100 m ramp) is still ~13.3 m high; 21 m keeps
 * MIN_ROAD_CLEARANCE under the 1.5 m deck slab.
 */
export const GANGBYEON_Y = 21;
/**
 * 올림픽대로: centre this far outside the south embankment (m), at grade. The south approaches
 * pass over it (see BRIDGE_LAND_SOUTH).
 */
export const OLYMPIC_OFFSET = 30;
const OLYMPIC_Y = 0.3;
const OLYMPIC_WIDTH = 28;
/** 내부순환로 deck height. */
const NAEBU_Y = 26;

interface BridgeDef {
  id: string;
  name: string;
  kind: BridgeKind;
  motif: BridgeMotif;
  spans: number;
  x: number;
  deckY: number;
  lowerDeckY?: number;
  width: number;
  lanes: number;
  structureH: number;
  rail?: boolean;
  island?: IslandId;
  /** Cross the river along the normal at this x instead of at `x` (keeps 한강철교 parallel to 한강대교). */
  normalX?: number;
}

/** West → east. `x` is the projected OSM bridge centre on the centerline (SEOUL.md 3.1). */
const BRIDGE_DEFS: BridgeDef[] = [
  {
    id: 'br-seongsan',
    name: '성산대교',
    kind: 'deckArch',
    motif: 'cyanRib',
    spans: 5,
    x: -1453,
    deckY: 14,
    width: 28,
    lanes: 6,
    structureH: 12,
  },
  {
    id: 'br-yanghwa',
    name: '양화대교',
    kind: 'tiedArch',
    motif: 'whiteArch',
    spans: 6,
    x: -1279,
    deckY: 12,
    width: 32,
    lanes: 6,
    structureH: 14,
    island: 'seonyu',
  },
  {
    id: 'br-seogang',
    name: '서강대교',
    kind: 'tiedArch',
    motif: 'redArch',
    spans: 3,
    x: -925,
    deckY: 14,
    width: 26,
    lanes: 6,
    structureH: 55,
    island: 'bamseom',
  },
  {
    id: 'br-mapo',
    name: '마포대교',
    kind: 'girder',
    motif: 'textRail',
    spans: 6,
    x: -788,
    deckY: 12,
    width: 30,
    lanes: 8,
    structureH: 0,
  },
  {
    id: 'br-hangang-rail',
    name: '한강철교',
    kind: 'truss',
    motif: 'railTruss',
    spans: 7,
    x: -551,
    deckY: 12,
    width: 48,
    lanes: 4,
    structureH: 12,
    rail: true,
    normalX: -480,
  },
  {
    id: 'br-hangang',
    name: '한강대교',
    kind: 'tiedArch',
    motif: 'whiteArch',
    spans: 6,
    x: -480,
    deckY: 12,
    width: 30,
    lanes: 6,
    structureH: 14,
    island: 'nodeul',
  },
  {
    id: 'br-banpo',
    name: '반포대교·잠수교',
    kind: 'doubleDeck',
    motif: 'fountain',
    spans: 8,
    x: 96,
    deckY: 16,
    lowerDeckY: 1,
    width: 30,
    lanes: 6,
    structureH: 6,
  },
  {
    id: 'br-dongho',
    name: '동호대교',
    kind: 'truss',
    motif: 'subwayDeck',
    spans: 5,
    x: 468,
    deckY: 12,
    width: 30,
    lanes: 6,
    structureH: 12,
    rail: true,
  },
  {
    id: 'br-seongsu',
    name: '성수대교',
    kind: 'truss',
    motif: 'orangeChord',
    spans: 4,
    x: 662,
    deckY: 12,
    width: 26,
    lanes: 4,
    structureH: 16,
  },
  {
    id: 'br-cheongdam',
    name: '청담대교',
    kind: 'doubleDeck',
    motif: 'subwayDeck',
    spans: 6,
    x: 1087,
    deckY: 14,
    lowerDeckY: 6,
    width: 28,
    lanes: 4,
    structureH: 6,
    rail: true,
  },
  {
    id: 'br-olympic',
    name: '올림픽대교',
    kind: 'cableStayed',
    motif: 'ringPylon',
    spans: 5,
    x: 1670,
    deckY: 14,
    width: 30,
    lanes: 6,
    structureH: 88,
  },
];

/** North approach length beyond the embankment (m): lands past 강변북로. */
export const BRIDGE_LAND = 100;
/**
 * Shortest south approach beyond the embankment (m). A bridge whose deck would not clear
 * 올림픽대로 by MIN_ROAD_CLEARANCE where the road actually passes under it (it bends away from
 * the bank on the inner side of a curve) gets a longer one (see `southRamp`).
 */
export const BRIDGE_LAND_SOUTH = 180;
/** Thickest deck slab the clearance guarantee assumes (m). Infra decks must not be thicker. */
export const MAX_DECK_THICKNESS = 1.5;
/** Minimum vertical clearance between a deck underside and a road or deck below it (m). */
export const MIN_ROAD_CLEARANCE = 5;

/**
 * Upper deck surface of a bridge (span + approach ramps) over (x, z), or null when the point
 * is off the bridge footprint. The span is flat at deckY between the abutments; each approach
 * descends linearly to 0 at its landing. The lower deck of 'doubleDeck' spans abutment to
 * abutment only. `margin` widens the footprint sideways (e.g. by a road half width).
 */
export function bridgeDeckY(br: Bridge, x: number, z: number, margin = 0): number | null {
  const p = { x, z };
  if (pointSegmentDistance(p, br.landA, br.landB) > br.width / 2 + margin) return null;
  const ux = br.b.x - br.a.x;
  const uz = br.b.z - br.a.z;
  const span = Math.hypot(ux, uz);
  // Signed distance along the bridge axis from abutment a (north) toward b (south).
  const s = ((x - br.a.x) * ux + (z - br.a.z) * uz) / span;
  if (s >= 0 && s <= span) return br.deckY;
  const rampA = Math.hypot(br.a.x - br.landA.x, br.a.z - br.landA.z);
  const rampB = Math.hypot(br.b.x - br.landB.x, br.b.z - br.landB.z);
  const over = s < 0 ? -s / rampA : (s - span) / rampB;
  // Exactly at a landing, rounding can give 1 + 1e-16; keep the deck there.
  if (over > 1 + 1e-9) return null;
  return Math.max(0, br.deckY * (1 - Math.min(1, over)));
}

/**
 * South ramp length (beyond the bank) that keeps the deck ≥ MIN_ROAD_CLEARANCE above 올림픽대로
 * where the road crosses the bridge axis.
 */
let olympicCache: Vec3[] | null = null;
function olympicSamples(): Vec3[] {
  olympicCache ??= highwaySamples(
    { points: bankPoints(1, OLYMPIC_OFFSET, OLYMPIC_Y), closed: false },
    4,
  );
  return olympicCache;
}

function southRamp(c: Vec2, south: Vec2, half: number, width: number, deckY: number): number {
  const road = olympicSamples();
  const roadHalf = OLYMPIC_WIDTH / 2;
  let far = 0;
  for (const p of road) {
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const along = dx * south.x + dz * south.z - half;
    const lateral = Math.abs(-dx * south.z + dz * south.x);
    if (along > 0 && along < 600 && lateral < width / 2 + roadHalf) far = Math.max(far, along);
  }
  // deck (1 - (far + roadHalf) / L) - MAX_DECK_THICKNESS - road y ≥ MIN_ROAD_CLEARANCE
  const keep = 1 - (MIN_ROAD_CLEARANCE + MAX_DECK_THICKNESS + OLYMPIC_Y) / deckY;
  return Math.max(BRIDGE_LAND_SOUTH, Math.ceil((far + roadHalf) / keep) + 5);
}

export function makeBridges(): Bridge[] {
  return BRIDGE_DEFS.map((d) => {
    const half = riverWidthAt(d.x) / 2;
    const c = riverOffset(d.x, 0);
    const { south } = riverFrame(d.normalX ?? d.x);
    const at = (k: number): Vec2 => ({ x: c.x + south.x * k, z: c.z + south.z * k });
    const b: Bridge = {
      id: d.id,
      name: d.name,
      kind: d.kind,
      a: at(-half),
      b: at(half),
      landA: at(-half - BRIDGE_LAND),
      landB: at(half + southRamp(c, south, half, d.width, d.deckY)),
      deckY: d.deckY,
      width: d.width,
      lanes: d.lanes,
      structureH: d.structureH,
      spans: d.spans,
      rail: d.rail ?? false,
      motif: d.motif,
    };
    if (d.lowerDeckY !== undefined) b.lowerDeckY = d.lowerDeckY;
    if (d.island) b.island = d.island;
    return b;
  });
}

/**
 * Offset `k` along the normal at x that puts the point `outside` m beyond the bank. On the inner
 * side of a bend the plain normal offset lands closer to the channel, so it is pushed out until
 * the true distance to the embankment matches.
 */
function bankOffset(x: number, side: -1 | 1, outside: number): number {
  let k = riverWidthAt(x) / 2 + outside;
  for (let i = 0; i < 4; i++) {
    const p = riverOffset(x, side * k);
    const err = outside - riverSignedDistance(p.x, p.z);
    if (err < 0.5) break;
    k += err;
  }
  return k;
}

function bankPoint(x: number, side: -1 | 1, outside: number): Vec2 {
  return riverOffset(x, side * bankOffset(x, side, outside));
}

/**
 * Points that follow a bank at `outside` m beyond it. Raw offsets every 25 m bunch up and
 * reverse on the inner side of a bend, which folds the deck, so they are smoothed by neighbour
 * averaging and pushed back out (away from the nearest centerline point) whenever smoothing
 * pulls one closer than `outside`. Every 4th point is kept (~100 m apart).
 */
function bankPoints(side: -1 | 1, outside: number, y: number): Vec3[] {
  let pts: Vec2[] = [];
  for (let x = -HALF_X - 150; x <= HALF_X + 150 + 1e-6; x += 25)
    pts.push(bankPoint(x, side, outside));
  for (let iter = 0; iter < 160; iter++) {
    const next = pts.map((p, i) => {
      if (i === 0 || i === pts.length - 1) return p;
      const a = pts[i - 1] as Vec2;
      const b = pts[i + 1] as Vec2;
      return { x: (a.x + 2 * p.x + b.x) / 4, z: (a.z + 2 * p.z + b.z) / 4 };
    });
    pts = next.map((p) => {
      const n = riverNearest(p.x, p.z);
      const want = riverWidthAt(n.cx) / 2 + outside;
      if (n.d >= want) return p;
      const c = { x: n.cx, z: riverZ(n.cx) };
      const len = Math.hypot(p.x - c.x, p.z - c.z) || 1;
      return { x: c.x + ((p.x - c.x) / len) * want, z: c.z + ((p.z - c.z) / len) * want };
    });
  }
  return pts
    .filter((_, i) => i % 4 === 0 || i === pts.length - 1)
    .map((p) => ({ x: p.x, y, z: p.z }));
}

/** Point on 강변북로 near x. */
function gangbyeonAt(x: number): Vec3 {
  const p = bankPoint(x, -1, GANGBYEON_OFFSET);
  return { x: p.x, y: GANGBYEON_Y, z: p.z };
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

const v3 = (x: number, z: number, y = NAEBU_Y): Vec3 => ({ x, y, z });

/** 내부순환로 west leg: 성산대교 north end → 홍제 tunnel portal past the north edge. */
const NAEBU_W: Vec3[] = [
  v3(-1480, -880),
  v3(-1390, -990),
  v3(-1270, -1080),
  v3(-1120, -1160),
  v3(-990, -1240),
  v3(-910, -1360),
];

/** 내부순환로 east leg: 정릉 tunnel portal past the north edge → 성수 (강변북로). */
const NAEBU_E: Vec3[] = [
  v3(250, -1360),
  v3(330, -1150),
  v3(430, -970),
  v3(620, -720),
  v3(780, -540),
  v3(900, -410),
];

/**
 * West ramp: leaves 강변북로 alongside it (like the v2 interchange ramps), drifts out to the
 * north over ~200 m while climbing, then swings up to the start of 내부순환로.
 */
/**
 * West ramp: leaves 강변북로 tangent to it at one of its own control points and swings north
 * into the start of 내부순환로 (one cubic, tangent to both decks).
 */
function rampWest(): Vec3[] {
  const parent = bankPoints(-1, GANGBYEON_OFFSET, GANGBYEON_Y);
  const k = parent.reduce(
    (b, p, i) => (Math.abs(p.x + 1800) < Math.abs((parent[b] as Vec3).x + 1800) ? i : b),
    0,
  );
  const p0 = parent[k] as Vec3;
  const next = parent[k + 1] as Vec3;
  const gl = Math.hypot(next.x - p0.x, next.z - p0.z);
  const end = NAEBU_W[0] as Vec3;
  const dir = NAEBU_W[1] as Vec3;
  const nl = Math.hypot(dir.x - end.x, dir.z - end.z);
  return bezierPoints(
    p0,
    { x: p0.x + ((next.x - p0.x) / gl) * 130, y: 0, z: p0.z + ((next.z - p0.z) / gl) * 130 },
    { x: end.x - ((dir.x - end.x) / nl) * 130, y: 0, z: end.z - ((dir.z - end.z) / nl) * 130 },
    end,
    16,
  );
}

function rampEast(): Vec3[] {
  const start = NAEBU_E[NAEBU_E.length - 1] as Vec3;
  const prev = NAEBU_E[NAEBU_E.length - 2] as Vec3;
  const post = gangbyeonAt(1000);
  const end = gangbyeonAt(1090);
  return bezierPoints(
    start,
    { x: start.x + (start.x - prev.x) * 0.6, y: 0, z: start.z + (start.z - prev.z) * 0.6 },
    { ...post, z: post.z - 20 },
    end,
  );
}

interface HwDef {
  id: string;
  name: string;
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
      name: '강변북로',
      kind: 'elevated',
      points: bankPoints(-1, GANGBYEON_OFFSET, GANGBYEON_Y),
      closed: false,
      width: 26,
      lanes: 6,
      pillarSpacing: 36,
    },
    {
      id: 'hw-south',
      name: '올림픽대로',
      kind: 'atGrade',
      points: bankPoints(1, OLYMPIC_OFFSET, OLYMPIC_Y),
      closed: false,
      width: OLYMPIC_WIDTH,
      lanes: 8,
      pillarSpacing: 0,
    },
    {
      id: 'hw-naebu-w',
      name: '내부순환로',
      kind: 'elevated',
      points: NAEBU_W,
      closed: false,
      width: 22,
      lanes: 4,
      pillarSpacing: 34,
    },
    {
      id: 'hw-naebu-e',
      name: '내부순환로',
      kind: 'elevated',
      points: NAEBU_E,
      closed: false,
      width: 22,
      lanes: 4,
      pillarSpacing: 34,
    },
    {
      id: 'hw-naebu-w-ramp',
      name: '내부순환로 진입로',
      kind: 'ramp',
      points: rampWest(),
      closed: false,
      width: 10,
      lanes: 2,
      pillarSpacing: 28,
    },
    {
      id: 'hw-naebu-e-ramp',
      name: '내부순환로 진출로',
      kind: 'ramp',
      points: rampEast(),
      closed: false,
      width: 10,
      lanes: 2,
      pillarSpacing: 28,
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
        if (Math.abs(v.x) > HALF_X || Math.abs(v.z) > HALF_Z) continue;
        if (onBridge(bridges, { x: v.x, z: v.z }, 4)) continue;
        pillars.push({ x: v.x, y: v.y, z: v.z });
      }
    }
    return { ...d, pillars, corridorHalf: (d.width + CORRIDOR_MARGIN) / 2 };
  });
}

/** Bridge frame helper for tests and infra: unit vector along the river at a bridge. */
export function bridgeAlong(br: Bridge): Vec2 {
  const x = (br.a.x + br.b.x) / 2;
  return riverFrame(x).along;
}
