// 한강 (layout v3, docs/SEOUL.md 3) and the terrain height field. Pure functions only.
// The centerline passes through the projected bridge centres (OSM, SEOUL.md 2.1 projection)
// and stays strictly increasing in x, so `riverZ(x)` is a function of x.
import { CatmullRomCurve3, Vector3 } from 'three';
import { fbm1 } from './noise';
import { clamp, closestSegmentT, pointInPolygon, pointSegmentDistance, smoothstep } from './math';
import type { Island, Mountain, River, SideChannel, Vec2 } from './types';

/** Map half extents (m). The map spans x ±HALF_X, z ±HALF_Z. */
export const HALF_X = 2000;
export const HALF_Z = 1300;

/**
 * Control points: x, z, bank-to-bank width, park width (each side). Bridge rows use the
 * projected OSM bridge centre (SEOUL.md 3.1); R0 and the last row lie outside the map.
 */
const CONTROL: readonly (readonly [number, number, number, number])[] = [
  [-2150, -880, 480, 50], // R0, west of the map
  [-1901, -720, 480, 50], // 가양대교
  [-1546, -466, 470, 50], // 월드컵대교
  [-1453, -408, 460, 50], // 성산대교
  [-1279, -231, 450, 45], // 양화대교
  [-1194, -222, 450, 45], // 당산철교
  [-925, -187, 460, 45], // 서강대교 (밤섬)
  [-788, -66, 440, 45], // 마포대교
  [-628, 39, 420, 45], // 원효대교
  [-551, 177, 420, 45], // 한강철교
  [-480, 271, 420, 45], // 한강대교 (노들섬)
  [-300, 340, 410, 45], // 이촌 굽이
  [-118, 359, 410, 50], // 동작대교
  [96, 286, 400, 50], // 반포대교·잠수교
  [344, 61, 390, 45], // 한남대교
  [468, -97, 380, 45], // 동호대교
  [662, -129, 380, 50], // 성수대교
  [996, -20, 370, 45], // 영동대교
  [1087, 81, 360, 45], // 청담대교
  [1501, 115, 360, 45], // 잠실대교
  [1606, 37, 365, 45], // 잠실철교
  [1670, -80, 370, 45], // 올림픽대교
  [1790, -240, 380, 45], // 천호대교
  [2150, -430, 380, 45], // east of the map
];

const SAMPLE_STEP = 10;

function sampleCenterline(): Vec2[] {
  const curve = new CatmullRomCurve3(
    CONTROL.map(([x, z]) => new Vector3(x, 0, z)),
    false,
    'centripetal',
  );
  const n = Math.ceil(curve.getLength() / SAMPLE_STEP);
  return curve.getSpacedPoints(n).map((v) => ({ x: v.x, z: v.z }));
}

const SAMPLES = sampleCenterline();
const CONTROL_X = CONTROL.map((c) => c[0]);

/** Piecewise linear interpolation of a control column over x. */
function controlAt(x: number, col: 2 | 3): number {
  const n = CONTROL.length;
  if (x <= (CONTROL_X[0] as number)) return (CONTROL[0] as readonly number[])[col] as number;
  for (let i = 0; i < n - 1; i++) {
    const x1 = CONTROL_X[i + 1] as number;
    if (x <= x1) {
      const x0 = CONTROL_X[i] as number;
      const a = (CONTROL[i] as readonly number[])[col] as number;
      const b = (CONTROL[i + 1] as readonly number[])[col] as number;
      return a + ((b - a) * (x - x0)) / (x1 - x0);
    }
  }
  return (CONTROL[n - 1] as readonly number[])[col] as number;
}

/** Bank-to-bank width (m) of the channel at x. */
export function riverWidthAt(x: number): number {
  return controlAt(x, 2);
}

/** Park strip width (m) inside each embankment at x. */
export function parkWidthAt(x: number): number {
  return controlAt(x, 3);
}

/** Index i such that SAMPLES[i].x <= x < SAMPLES[i + 1].x (clamped). */
function sampleIndex(x: number): number {
  let lo = 0;
  let hi = SAMPLES.length - 2;
  if (x <= (SAMPLES[0] as Vec2).x) return 0;
  if (x >= (SAMPLES[hi + 1] as Vec2).x) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((SAMPLES[mid] as Vec2).x <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** River center z at x (linear between centerline samples; extrapolated past the ends). */
export function riverZ(x: number): number {
  const i = sampleIndex(x);
  const a = SAMPLES[i] as Vec2;
  const b = SAMPLES[i + 1] as Vec2;
  return a.z + ((b.z - a.z) * (x - a.x)) / (b.x - a.x);
}

/** dz/dx of the centerline, averaged over about ±30 m so frames turn smoothly. */
export function riverSlope(x: number): number {
  const h = 30;
  return (riverZ(x + h) - riverZ(x - h)) / (2 * h);
}

/** Point on the centerline at x, and the unit normal pointing south (+Z side). */
export function riverFrame(x: number): { p: Vec2; south: Vec2; along: Vec2 } {
  const s = riverSlope(x);
  const len = Math.hypot(1, s);
  const along = { x: 1 / len, z: s / len };
  return { p: { x, z: riverZ(x) }, south: { x: -along.z, z: along.x }, along };
}

/** Point at signed distance `k` from the centerline along the south normal at x. */
export function riverOffset(x: number, k: number): Vec2 {
  const { p, south } = riverFrame(x);
  return { x: p.x + south.x * k, z: p.z + south.z * k };
}

// --- distance to the centerline ---

/**
 * Distance from (x, z) to the centerline and the x of the closest centerline point. The samples
 * are sorted by x, so the scan walks outward from x and stops once |sample.x - x| exceeds the
 * best distance found (no closer segment can lie beyond that).
 */
export function riverNearest(x: number, z: number): { d: number; cx: number } {
  return nearestScan(x, z, riverDistanceUpperBound(x, z));
}

function nearestScan(x: number, z: number, cutoff: number): { d: number; cx: number } {
  const p = { x, z };
  const n = SAMPLES.length - 1;
  const i0 = sampleIndex(x);
  // Segments farther than `cutoff` (a known upper bound) can stop the scan early.
  let best = cutoff;
  let cx = x;
  const visit = (i: number): void => {
    const a = SAMPLES[i] as Vec2;
    const b = SAMPLES[i + 1] as Vec2;
    const t = closestSegmentT(p, a, b);
    const qx = a.x + (b.x - a.x) * t;
    const d = Math.hypot(x - qx, z - (a.z + (b.z - a.z) * t));
    if (d <= best) {
      best = d;
      cx = qx;
    }
  };
  for (let i = i0; i < n; i++) {
    if ((SAMPLES[i] as Vec2).x - x > best) break;
    visit(i);
  }
  for (let i = i0 - 1; i >= 0; i--) {
    if (x - (SAMPLES[i + 1] as Vec2).x > best) break;
    visit(i);
  }
  return { d: best, cx };
}

// Lower bound on the centerline distance from a lazily filled 20 m grid. The distance is
// 1-Lipschitz, so d(p) >= d(corner) - |p - corner|; callers skip the exact scan when the bound
// already rules the river out.
const LB_CELL = 20;
const LB_X0 = -HALF_X - 400;
const LB_Z0 = -HALF_Z - 400;
const LB_NX = Math.ceil((2 * HALF_X + 800) / LB_CELL) + 1;
const LB_NZ = Math.ceil((2 * HALF_Z + 800) / LB_CELL) + 1;
const LB = new Float32Array(LB_NX * LB_NZ).fill(-1);

// The grid stores distances to a coarse polyline (every COARSE-th sample). The fine and coarse
// polylines are within COARSE_EPS of each other both ways, so the fine distance is within
// COARSE_EPS of the stored one; `off` carries that slack.
const COARSE = 10;
const COARSE_PTS: Vec2[] = SAMPLES.filter((_, i) => i % COARSE === 0 || i === SAMPLES.length - 1);

function coarseDistance(x: number, z: number): number {
  const p = { x, z };
  let best = Infinity;
  for (let i = 0; i < COARSE_PTS.length - 1; i++) {
    best = Math.min(
      best,
      pointSegmentDistance(p, COARSE_PTS[i] as Vec2, COARSE_PTS[i + 1] as Vec2),
    );
  }
  return best;
}

const COARSE_EPS = (() => {
  let eps = 0;
  for (let c = 0; c < COARSE_PTS.length - 1; c++) {
    const a = COARSE_PTS[c] as Vec2;
    const b = COARSE_PTS[c + 1] as Vec2;
    const i0 = c * COARSE;
    const i1 = Math.min(i0 + COARSE, SAMPLES.length - 1);
    // fine -> chord: the fine vertices (the segments between them bulge less than the chord gap).
    for (let i = i0; i <= i1; i++)
      eps = Math.max(eps, pointSegmentDistance(SAMPLES[i] as Vec2, a, b));
    // chord -> fine: points along the chord every metre.
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    for (let t = 0; t <= len; t += 1) {
      const q = { x: a.x + ((b.x - a.x) * t) / len, z: a.z + ((b.z - a.z) * t) / len };
      let d = Infinity;
      for (let i = i0; i < i1; i++) {
        d = Math.min(d, pointSegmentDistance(q, SAMPLES[i] as Vec2, SAMPLES[i + 1] as Vec2));
      }
      eps = Math.max(eps, d);
    }
  }
  return eps + 0.01;
})();

/** Distance at the nearest grid corner and the bound on |p − corner| plus slack, or null off the grid. */
function cornerDistance(x: number, z: number): { d: number; off: number } | null {
  const i = Math.round((x - LB_X0) / LB_CELL);
  const k = Math.round((z - LB_Z0) / LB_CELL);
  if (i < 0 || k < 0 || i >= LB_NX || k >= LB_NZ) return null;
  const idx = k * LB_NX + i;
  const cxw = LB_X0 + i * LB_CELL;
  const czw = LB_Z0 + k * LB_CELL;
  let d = LB[idx] as number;
  if (d < 0) {
    d = coarseDistance(cxw, czw);
    LB[idx] = d;
  }
  // + 0.01 covers the Float32 rounding of the cached value.
  return { d, off: Math.hypot(x - cxw, z - czw) + COARSE_EPS + 0.01 };
}

/** A value ≤ the distance from (x, z) to the centerline (cheap, cached). */
export function riverDistanceLowerBound(x: number, z: number): number {
  const c = cornerDistance(x, z);
  return c ? c.d - c.off : 0;
}

/** Min and max channel width over the control x range [x0, x1]. */
function widthRange(x0: number, x1: number): { lo: number; hi: number } {
  let lo = Math.min(riverWidthAt(x0), riverWidthAt(x1));
  let hi = Math.max(riverWidthAt(x0), riverWidthAt(x1));
  for (const c of CONTROL) {
    if (c[0] > x0 && c[0] < x1) {
      lo = Math.min(lo, c[2]);
      hi = Math.max(hi, c[2]);
    }
  }
  return { lo, hi };
}

/**
 * Interval [lo, hi] that contains the distance beyond the embankment (riverSignedDistance)
 * at (x, z), from the cached grid. Exact callers only need the full scan when a threshold
 * falls inside it.
 */
export function riverBeyondBounds(x: number, z: number): { lo: number; hi: number } {
  const c = cornerDistance(x, z);
  if (!c) return { lo: -Infinity, hi: Infinity };
  const dLo = Math.max(0, c.d - c.off);
  const dHi = c.d + c.off;
  // Segments within dHi + 120 m of x decide the signed distance (farther ones are ≥ dHi − 120
  // beyond the bank, never below dLo − 180 ≥ lo since every width is ≥ 360 m).
  const w = widthRange(x - dHi - 120, x + dHi + 120);
  return { lo: dLo - w.hi / 2, hi: dHi - w.lo / 2 };
}

function riverDistanceUpperBound(x: number, z: number): number {
  const c = cornerDistance(x, z);
  return c ? c.d + c.off : Infinity;
}

/** Distance from (x, z) to the centerline. */
export function riverCenterDistance(x: number, z: number): number {
  return riverNearest(x, z).d;
}

/** Signed distance to the channel edge (embankment): < 0 inside the channel (park + water). */
export function riverSignedDistance(x: number, z: number): number {
  return bankScan(x, z).f;
}

/** Half width at every centerline sample (the width is linear in x, so it lerps along a segment). */
const SAMPLE_HALF = SAMPLES.map((p) => riverWidthAt(p.x) / 2);
const MAX_HALF = Math.max(...SAMPLE_HALF);
const MIN_HALF = Math.min(...SAMPLE_HALF);

/**
 * Signed distance beyond the embankment, f = min over segments of (distance − half width at the
 * segment's closest point), and that point's x. Taking the minimum keeps f continuous where the
 * nearest centerline point jumps between segments of different width. A segment at |dx| ≥ f +
 * MAX_HALF cannot lower f, which bounds the scan.
 */
function bankScan(x: number, z: number): { f: number; cx: number } {
  const p = { x, z };
  const n = SAMPLES.length - 1;
  const i0 = sampleIndex(x);
  let best = riverDistanceUpperBound(x, z) - MIN_HALF;
  let cx = x;
  const visit = (i: number): void => {
    const a = SAMPLES[i] as Vec2;
    const b = SAMPLES[i + 1] as Vec2;
    const t = closestSegmentT(p, a, b);
    const qx = a.x + (b.x - a.x) * t;
    const d = Math.hypot(x - qx, z - (a.z + (b.z - a.z) * t));
    const ha = SAMPLE_HALF[i] as number;
    const f = d - (ha + ((SAMPLE_HALF[i + 1] as number) - ha) * t);
    if (f <= best) {
      best = f;
      cx = qx;
    }
  };
  for (let i = i0; i < n; i++) {
    if ((SAMPLES[i] as Vec2).x - x - MAX_HALF > best) break;
    visit(i);
  }
  for (let i = i0 - 1; i >= 0; i--) {
    if (x - (SAMPLES[i + 1] as Vec2).x - MAX_HALF > best) break;
    visit(i);
  }
  return { f: best, cx };
}

/** True when (x, z) is north of the river centerline. */
export function isNorthOfRiver(x: number, z: number): boolean {
  return z < riverZ(x);
}

/**
 * Offset `k` along the normal at x that puts the point `outside` m beyond the bank. On the inner
 * side of a bend the plain normal offset lands closer to the channel, so it is pushed out until
 * the true distance to the embankment matches.
 */
export function bankOffset(x: number, side: -1 | 1, outside: number): number {
  let k = riverWidthAt(x) / 2 + outside;
  for (let i = 0; i < 4; i++) {
    const p = riverOffset(x, side * k);
    const err = outside - riverSignedDistance(p.x, p.z);
    if (err < 0.5) break;
    k += err;
  }
  return k;
}

/** Point `outside` m beyond the bank at x (true embankment distance), north side -1. */
export function bankPoint(x: number, side: -1 | 1, outside: number): Vec2 {
  return riverOffset(x, side * bankOffset(x, side, outside));
}

// --- 샛강 (side channel south of 여의도) ---

const SAETGANG_X0 = -1262;
const SAETGANG_X1 = -598;
/** Island depth south of the main bank (m) along the channel, by x. */
function saetgangOffset(x: number): number {
  const t = clamp((x - SAETGANG_X0) / (SAETGANG_X1 - SAETGANG_X0), 0, 1);
  // 0 at both mouths (on the main bank), up to 440 m in the middle.
  return 440 * Math.pow(Math.sin(Math.PI * t), 0.4);
}

const SAETGANG_WIDTH = 50;
/** Shortest distance (m) of the 샛강 centerline offset from the south bank (clear of 올림픽대로). */
const SAETGANG_MOUTH = 75;

/**
 * z of the south embankment on the vertical line at x (first point south of the centerline where
 * riverSignedDistance reaches 0). A function of x, so offsets from it straight south (+z) cannot
 * fold the way large normal offsets do on the inside of the 서강–마포 bend.
 */
function southBankZ(x: number): number {
  let lo = riverZ(x);
  let hi = lo;
  while (riverSignedDistance(x, hi) < 0 && hi - lo < 2000) hi += 10;
  lo = hi - 10;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (riverSignedDistance(x, mid) < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function saetgangLine(): Vec2[] {
  const pts: Vec2[] = [];
  for (let x = SAETGANG_X0; x <= SAETGANG_X1 + 1e-6; x += 12) {
    // The mouths stop SAETGANG_MOUTH m south of the bank: 올림픽대로 runs along the bank on an
    // embankment, and 샛강 passes under it in culverts rather than as open water.
    const off = Math.max(saetgangOffset(x), SAETGANG_MOUTH);
    pts.push({ x, z: southBankZ(x) + off + SAETGANG_WIDTH / 2 - 20 });
  }
  return pts;
}

export const SAETGANG: Readonly<SideChannel> = {
  id: 'saetgang',
  name: '샛강',
  centerline: saetgangLine(),
  width: SAETGANG_WIDTH,
};

function sideChannelDistance(ch: SideChannel, x: number, z: number): number {
  const p = { x, z };
  const c = ch.centerline;
  const first = c[0] as Vec2;
  const last = c[c.length - 1] as Vec2;
  if (x < first.x - 200 || x > last.x + 200 || z < first.z - 600 || z > first.z + 900) {
    return Infinity;
  }
  // The centerline is x-monotonic: scan outward from x until |dx| exceeds the best distance.
  let lo = 0;
  let hi = c.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((c[mid] as Vec2).x <= x) lo = mid;
    else hi = mid;
  }
  let best = pointSegmentDistance(p, c[lo] as Vec2, c[hi] as Vec2);
  for (let i = lo - 1; i >= 0 && x - (c[i + 1] as Vec2).x < best; i--) {
    best = Math.min(best, pointSegmentDistance(p, c[i] as Vec2, c[i + 1] as Vec2));
  }
  for (let i = hi; i < c.length - 1 && (c[i] as Vec2).x - x < best; i++) {
    best = Math.min(best, pointSegmentDistance(p, c[i] as Vec2, c[i + 1] as Vec2));
  }
  return best - ch.width / 2;
}

/** Signed distance to the nearest water edge of the main channel bank or a side channel. */
export function waterSignedDistance(x: number, z: number): number {
  return Math.min(riverSignedDistance(x, z), sideChannelDistance(SAETGANG, x, z));
}

/** True when (x, z) is at least `margin` m outside every water edge (cheap far from water). */
export function waterClear(x: number, z: number, margin: number): boolean {
  if (sideChannelDistance(SAETGANG, x, z) < margin) return false;
  if (riverDistanceLowerBound(x, z) - MAX_HALF >= margin) return true;
  return riverSignedDistance(x, z) >= margin;
}

export const RIVER: Readonly<River> = {
  centerline: CONTROL.map(([x, z]) => ({ x, z })),
  waterY: -4,
  bankY: 0,
  parkY: -2,
  bandWidth: 60,
  widths: CONTROL.map((c) => c[2]),
  parkWidths: CONTROL.map((c) => c[3]),
  samples: SAMPLES.map((p) => ({ ...p })),
  channels: [SAETGANG],
};

// --- islands (SEOUL.md 3.2) ---

function ellipse(cx: number, k: number, rx: number, rz: number, n = 24): Vec2[] {
  const { p, south, along } = riverFrame(cx);
  const c = { x: p.x + south.x * k, z: p.z + south.z * k };
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const u = Math.cos(a) * rx;
    const v = Math.sin(a) * rz;
    return { x: c.x + along.x * u + south.x * v, z: c.z + along.z * u + south.z * v };
  });
}

function yeouidoPolygon(): Vec2[] {
  const north: Vec2[] = [];
  const south: Vec2[] = [];
  for (let x = SAETGANG_X0 + 12; x <= SAETGANG_X1 - 12 + 1e-6; x += 12) {
    const bank = southBankZ(x);
    north.push({ x, z: bank });
    south.push({ x, z: bank + Math.max(0, saetgangOffset(x) - 20) });
  }
  return [...north, ...south.reverse()];
}

export const ISLANDS: readonly Island[] = [
  { id: 'yeouido', name: '여의도', kind: 'land', polygon: yeouidoPolygon(), y: 0 },
  // 윗밤섬 and 아랫밤섬 are one marsh polygon pair; the first ellipse is the larger one.
  { id: 'bamseom', name: '밤섬', kind: 'marsh', polygon: ellipse(-905, 20, 120, 36), y: -3 },
  { id: 'nodeul', name: '노들섬', kind: 'culture', polygon: ellipse(-470, -10, 130, 40), y: 0 },
  {
    id: 'seorae',
    name: '서래섬',
    kind: 'park',
    polygon: ellipse(-20, riverWidthAt(-20) / 2 - 32, 150, 15),
    y: -2,
  },
  { id: 'seonyu', name: '선유도', kind: 'park', polygon: ellipse(-1262, 90, 60, 30), y: 0 },
];

/** Island under (x, z), if any. */
export function islandAt(x: number, z: number): Island | null {
  const p = { x, z };
  for (const isl of ISLANDS) if (pointInPolygon(p, isl.polygon)) return isl;
  return null;
}

// --- terrain (SEOUL.md 5.1) ---

export const MOUNTAINS: readonly Mountain[] = [
  // Radius kept tight so the 용산 tower field at its western foot stays on low ground.
  { id: 'namsan', name: '남산', peak: { x: -176, z: -389 }, height: 160, radius: 250 },
  { id: 'bugak', name: '북악산', peak: { x: -200, z: -1180 }, height: 205, radius: 320 },
  { id: 'inwang', name: '인왕산', peak: { x: -470, z: -1015 }, height: 200, radius: 240 },
  { id: 'achasan', name: '아차산', peak: { x: 1615, z: -740 }, height: 170, radius: 260 },
  // North of 강변북로 (which runs ~ z -490 here), under the 홍대 alleys.
  { id: 'wausan', name: '와우산', peak: { x: -1010, z: -700 }, height: 40, radius: 150 },
];

export const TERRAIN = {
  /** v2 hill edge, kept for terrain's mesh refinement band until it follows MOUNTAINS. */
  hillStartZ: -650,
  /** Relative amplitude of the fbm detail on mountain slopes. */
  detail: 0.28,
  scale: 90,
  seed: 3301,
} as const;

/** Smooth compact bump: 1 at t = 0, 0 for t >= 1, zero slope at both ends. */
function bump(t: number): number {
  if (t >= 1) return 0;
  const s = 1 - t * t;
  return s * s;
}

/** Width of the embankment and park-edge slopes (m). */
export const EMBANK_SLOPE = 4;

/**
 * Natural ground height (river channel NOT carved): the max of the mountain bumps, 0 on the
 * plain. Continuous everywhere.
 */
export function terrainHeight(x: number, z: number): number {
  let h = 0;
  for (const m of MOUNTAINS) {
    const d = Math.hypot(x - m.peak.x, z - m.peak.z);
    if (d >= m.radius) continue;
    // Steeper near the top than a plain bump; two crossing fbm strips carve spurs and gullies.
    const b = Math.pow(bump(d / m.radius), 1.25);
    const u = (x * 0.8 + z * 0.6) / TERRAIN.scale + m.peak.x * 0.01;
    const v = (z * 0.8 - x * 0.6) / (TERRAIN.scale * 0.7) + m.peak.z * 0.01;
    const n = 0.5 * fbm1(u, TERRAIN.seed) + 0.5 * fbm1(v, TERRAIN.seed + 17);
    h = Math.max(h, m.height * b * (1 + TERRAIN.detail * (2 * n - 1)));
  }
  if (h === 0) return 0;
  // The palace grounds are a level court at the foot of 북악 (fades out over PALACE_FADE m).
  const dx = Math.max(PALACE_RECT.x0 - x, 0, x - PALACE_RECT.x1);
  const dz = Math.max(PALACE_RECT.z0 - z, 0, z - PALACE_RECT.z1);
  const out = Math.hypot(dx, dz);
  return out >= PALACE_FADE ? h : h * smoothstep(0, PALACE_FADE, out);
}

/** Walled palace grounds (SEOUL.md 4.5): level ground south of 북악. Shared with the zone. */
export const PALACE_RECT = { x0: -320, x1: -60, z0: -880, z1: -720 } as const;
const PALACE_FADE = 25;

/** Steepest ground slope (rise / run) at (x, z), from central differences 2 m apart. */
export function terrainSlope(x: number, z: number): number {
  const e = 2;
  const gx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
  const gz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
  return Math.hypot(gx, gz);
}

/** Slope above which the ground stays forest (manager rule: 25 %). */
export const FOREST_SLOPE = 0.25;
/** Share of a mountain's peak height above which its ground stays forest. */
export const FOREST_LINE = 0.55;
/** Highest ground (m) a building over TALL_H may stand on. */
export const TALL_GROUND = 20;
export const TALL_H = 40;

/**
 * True where the mountains stay wooded: slopes over FOREST_SLOPE or ground above FOREST_LINE of
 * the local mountain's height. Nothing is built there (hillside houses stop below it).
 */
export function isForest(x: number, z: number): boolean {
  const h = terrainHeight(x, z);
  if (h <= 0) return false;
  if (terrainSlope(x, z) > FOREST_SLOPE) return true;
  for (const m of MOUNTAINS) {
    if (Math.hypot(x - m.peak.x, z - m.peak.z) < m.radius && h > FOREST_LINE * m.height)
      return true;
  }
  return false;
}

/**
 * Walkable / floating surface height: terrain, the embankment slope, the park (y -2), islands
 * and the water surface (y -4). Use it for props, cameras and anything resting on the ground.
 */
export function surfaceHeight(x: number, z: number): number {
  const isl = islandAt(x, z);
  if (isl && isl.kind !== 'land') return isl.y;
  const ds = sideChannelDistance(SAETGANG, x, z);
  // Clearly beyond the embankment: the exact scan would take the terrain branch anyway.
  if (ds >= 0 && riverBeyondBounds(x, z).lo >= 0) return terrainHeight(x, z);
  const { f: d, cx } = bankScan(x, z);
  if (ds < 0) {
    const t = clamp(-ds / EMBANK_SLOPE, 0, 1);
    return RIVER.waterY * t;
  }
  if (d >= 0) return terrainHeight(x, z);
  if (d > -EMBANK_SLOPE) return (RIVER.parkY * -d) / EMBANK_SLOPE;
  const park = parkWidthAt(cx);
  if (d >= -park) return RIVER.parkY;
  const t = clamp((-park - d) / EMBANK_SLOPE, 0, 1);
  return RIVER.parkY + (RIVER.waterY - RIVER.parkY) * t;
}
