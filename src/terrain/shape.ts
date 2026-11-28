import {
  CITY,
  EMBANK_SLOPE,
  LAYOUT,
  RIVER,
  TERRAIN,
  parkWidthAt,
  riverWidthAt,
  riverFrame,
  riverSignedDistance,
  riverZ,
  ridgeHeight,
  terrainHeight,
  type Ridge,
  type Vec2,
} from '../city/layout';
import { createRng } from '../core/random';

export { EMBANK_SLOPE };

// Read on first use, not at import (boot sets the layout before importing modules, and a later
// setLayout must be picked up).
// Keyed on the layout object, so a later setLayout (another seed) is picked up.
let nearRidgeCache: { layout: typeof LAYOUT; ridge: Ridge } | null = null;
/** The near ridge ring (id 'ridge-near'): the ground disc ends just inside it. */
export function nearRidge(): Ridge {
  if (nearRidgeCache?.layout !== LAYOUT) {
    const r = LAYOUT.ridges.find((q) => q.id === 'ridge-near') ?? LAYOUT.ridges[0];
    if (!r) throw new Error('terrain: layout has no ridges');
    nearRidgeCache = { layout: LAYOUT, ridge: r };
  }
  return nearRidgeCache.ridge;
}

/** The ground must stay inside the near ridge wall or the plateau shows behind it. */
export function groundRadius(): number {
  return nearRidge().radius - 10;
}

/** Extent of the ground grid and the river strips (the ground radius). */
export function outerExtent(): number {
  return groundRadius();
}

export const MAP_HALF_X = CITY.halfX;
export const MAP_HALF_Z = CITY.halfZ;

const RIVER_X0 = Math.min(...RIVER.samples.map((p) => p.x)) + 10;
const RIVER_X1 = Math.max(...RIVER.samples.map((p) => p.x)) - 10;
const HILL_GRID_Z = TERRAIN.hillStartZ + 90;

/** Past the polyline ends the river keeps its end width. */
export function channelHalfWidth(x: number): number {
  return riverWidthAt(Math.min(RIVER_X1, Math.max(RIVER_X0, x))) / 2;
}

export function channelParkWidth(x: number): number {
  return parkWidthAt(Math.min(RIVER_X1, Math.max(RIVER_X0, x)));
}

const END_HALF_W0 = channelHalfWidth(RIVER_X0);
const END_HALF_W1 = channelHalfWidth(RIVER_X1);

// Past the polyline ends, continues the centerline so the river runs to the horizon. Switches on
// the foot of the perpendicular, not on x, or a slanted end opens a seam across the banks.
export function channelDistance(x: number, z: number): number {
  const f = riverFrame(x);
  const dz = z - riverZ(x);
  const foot = x + f.along.x * f.along.z * dz;
  if (foot >= RIVER_X0 && foot <= RIVER_X1) return riverSignedDistance(x, z);
  return Math.abs(dz * f.along.x) - (foot < RIVER_X0 ? END_HALF_W0 : END_HALF_W1);
}

export interface StripSlice {
  p: Vec2;
  south: Vec2;
  along: Vec2;
}

interface Run {
  lo: number;
  hi: number;
  p: Vec2 | null;
}

/**
 * One row of a river strip: the line at signed distance `target[i]` from the bank, built from
 * normal offsets `offset[i]` off the centerline. Where a bend is tighter than the offset those
 * points fall inside a swallow-tail and miss `target`; each such run, widened to the row's
 * outermost self-crossing, collapses onto that crossing, which is where the true distance line
 * turns. `moved` marks the collapsed slices.
 */
export function isoRow(
  slices: readonly StripSlice[],
  offset: readonly number[],
  target: readonly number[],
  dist: (p: Vec2) => number,
  tol = 1,
  reach = 60,
): { points: Vec2[]; moved: boolean[] } {
  const n = slices.length;
  const raw: Vec2[] = [];
  const bad: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const f = slices[i];
    const k = offset[i];
    const t = target[i];
    if (!f || k === undefined || t === undefined) throw new Error('terrain: strip row size');
    const p = { x: f.p.x + f.south.x * k, z: f.p.z + f.south.z * k };
    raw.push(p);
    bad.push(Math.abs(dist(p) - t) > tol);
  }
  const back = (i: number): boolean => {
    const p = raw[i - 1];
    const q = raw[i];
    const f = slices[i];
    return !!p && !!q && !!f && (q.x - p.x) * f.along.x + (q.z - p.z) * f.along.z < 0;
  };
  // Only a real fold collapses: the run crosses itself or steps backwards. A run that merely
  // misses `target` (the width changing along x) keeps its plain offsets.
  const widen = (lo: number, hi: number): Run | null => {
    const hit = selfCrossing(raw, lo, hi, reach);
    let folded = !!hit;
    for (let i = lo; i <= hi && !folded; i++) folded = back(i);
    if (!folded) return null;
    // The end slices stay put: strips must end exactly on the outer extent.
    const l = Math.max(1, hit ? Math.min(hit.a, lo) : lo);
    const h = Math.min(n - 1, hit ? Math.max(hit.b, hi) : hi);
    return l < h ? { lo: l, hi: h, p: hit?.p ?? null } : null;
  };
  let runs: Run[] = [];
  for (let m = 0; m < n; m++) {
    if (!bad[m]) continue;
    let e = m;
    while (e < n && bad[e]) e++;
    const r = widen(m, e);
    if (r) runs.push(r);
    m = e;
  }
  // Widened runs can overlap; merged ones are widened again until they settle.
  for (let pass = 0; pass < 8; pass++) {
    runs.sort((r, q) => r.lo - q.lo);
    const merged: Run[] = [];
    let changed = false;
    for (const r of runs) {
      const last = merged[merged.length - 1];
      // A lone slice that passes between two folded runs is part of the same fold.
      if (last && r.lo <= last.hi + 1) {
        merged[merged.length - 1] = widen(last.lo, Math.max(last.hi, r.hi)) ?? {
          lo: last.lo,
          hi: Math.max(last.hi, r.hi),
          p: null,
        };
        changed = true;
      } else merged.push(r);
    }
    runs = merged;
    if (!changed) break;
  }
  const points = raw.slice();
  const moved = raw.map(() => false);
  for (const { lo, hi, p } of runs) {
    const fill = p ?? runFill(raw[lo - 1], slices[lo - 1]?.along, raw[hi], slices[hi]?.along);
    for (let i = lo; i < hi; i++) {
      const q = fill ?? lerpRun(raw[lo - 1], raw[hi], (i - lo + 1) / (hi - lo + 1));
      points[i] = q ?? raw[i] ?? { x: 0, z: 0 };
      moved[i] = true;
    }
  }
  return { points, moved };
}

/**
 * Outermost self-crossing of the raw row around the bad run [m, e): segment (a-1, a) meets the
 * later segment (b-1, b). Searches `reach` metres along the row beyond each end of the run,
 * since points near a cusp can still pass the distance test while stepping backwards.
 */
function selfCrossing(
  raw: readonly Vec2[],
  m: number,
  e: number,
  reach: number,
): { a: number; b: number; p: Vec2 } | null {
  const step = (i: number): number => {
    const p = raw[i - 1];
    const q = raw[i];
    return p && q ? Math.hypot(q.x - p.x, q.z - p.z) : 0;
  };
  let a0 = m;
  for (let len = 0; a0 > 1 && len <= reach; a0--) len += step(a0);
  let b1 = e;
  for (let len = 0; b1 < raw.length - 1 && len <= reach; b1++) len += step(b1 + 1);
  for (let a = a0; a <= e; a++) {
    for (let b = b1; b >= a + 2; b--) {
      const p = segmentHit(raw[a - 1], raw[a], raw[b - 1], raw[b]);
      if (p) return { a, b, p };
    }
  }
  return null;
}

function segmentHit(a?: Vec2, b?: Vec2, c?: Vec2, d?: Vec2): Vec2 | null {
  if (!a || !b || !c || !d) return null;
  const rx = b.x - a.x;
  const rz = b.z - a.z;
  const sx = d.x - c.x;
  const sz = d.z - c.z;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den;
  const u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + rx * t, z: a.z + rz * t };
}

// Corner where the arm through `a` (heading `u`) meets the arm through `b` (arriving along `v`).
// Null when the arms are missing, parallel, meet implausibly far away or out of order.
function runFill(a?: Vec2, u?: Vec2, b?: Vec2, v?: Vec2): Vec2 | null {
  if (!a || !u || !b || !v) return a ?? b ?? null;
  const den = u.x * v.z - u.z * v.x;
  if (Math.abs(den) < 1e-6) return null;
  const bx = b.x - a.x;
  const bz = b.z - a.z;
  const t = (bx * v.z - bz * v.x) / den;
  const s = (bx * u.z - bz * u.x) / den;
  const reach = 3 * Math.hypot(bx, bz) + 2;
  if (t < 0 || s < 0 || t > reach || s > reach) return null;
  const p = { x: a.x + u.x * t, z: a.z + u.z * t };
  // A cusp without a loop can put the corner past `b`; a chord is safer there.
  if ((b.x - p.x) * v.x + (b.z - p.z) * v.z < 0) return null;
  return p;
}

function lerpRun(a: Vec2 | undefined, b: Vec2 | undefined, t: number): Vec2 | null {
  if (!a || !b) return a ?? b ?? null;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

export interface ChannelSlices {
  xs: number[];
  slices: StripSlice[];
  half: number[];
}

// Channel and water share these slices so the water edge follows the stone edge it tucks under.
export function channelSlices(): ChannelSlices {
  const xs = riverSliceXs(8, 20);
  return { xs, slices: xs.map((x) => riverFrame(x)), half: xs.map(channelHalfWidth) };
}

// Must cover the ground cells dropped near the channel, which grow past the map edge.
export function bankReach(x: number): number {
  const t = Math.min(1, Math.max(0, (Math.abs(x) - (MAP_HALF_X + 40)) / 300));
  return 40 + 40 * t * t * (3 - 2 * t);
}

/**
 * Rows of one side (-1 north, 1 south) at bank distances `depths[j][i]`; `depths[0]` must be the
 * outermost. Only that row is cleaned of folds. The others step from it toward the river by
 * their depth difference: along the centerline normal (the plain offset) where it is untouched,
 * and along normals fanned around its corner where it collapsed, so rows never cross and rows
 * with equal depths are identical.
 */
export function channelRows(
  c: ChannelSlices,
  depths: readonly (readonly number[])[],
  side: -1 | 1,
  dist: (x: number, z: number) => number = channelDistance,
): Vec2[][] {
  const d0 = depths[0];
  if (!d0) return [];
  const offset = c.half.map((h, i) => (h + (d0[i] ?? 0)) * side);
  const outer = isoRow(c.slices, offset, d0, (p) => dist(p.x, p.z));
  const dirs = fanDirections(c.slices, outer.moved, side);
  return depths.map((d, j) => {
    if (j === 0) return outer.points;
    return c.slices.map((f, i) => {
      if (!outer.moved[i]) {
        const k = ((c.half[i] ?? 0) + (d[i] ?? 0)) * side;
        return { x: f.p.x + f.south.x * k, z: f.p.z + f.south.z * k };
      }
      const o = outer.points[i] ?? f.p;
      const n = dirs[i] ?? f.south;
      const t = (d0[i] ?? 0) - (d[i] ?? 0);
      return { x: o.x + n.x * t, z: o.z + n.z * t };
    });
  });
}

// Unit direction toward the river at each slice, turned evenly across each collapsed run.
function fanDirections(
  slices: readonly StripSlice[],
  moved: readonly boolean[],
  side: number,
): Vec2[] {
  const n = slices.length;
  const base = slices.map((f) => ({ x: -f.south.x * side, z: -f.south.z * side }));
  const out = base.slice();
  for (let m = 0; m < n; m++) {
    if (!moved[m]) continue;
    let e = m;
    while (e < n && moved[e]) e++;
    const u = base[m - 1] ?? base[e];
    const v = base[e] ?? base[m - 1];
    if (u && v) {
      const a0 = Math.atan2(u.z, u.x);
      let da = Math.atan2(v.z, v.x) - a0;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      for (let i = m; i < e; i++) {
        const a = a0 + (da * (i - m + 1)) / (e - m + 1);
        out[i] = { x: Math.cos(a), z: Math.sin(a) };
      }
    }
    m = e;
  }
  return out;
}

export type ChannelPart = 'bank' | 'embankment' | 'park' | 'parkEdge';

export interface ProfilePoint {
  /** > 0 outside the channel. */
  d: number;
  y: number;
  part: ChannelPart;
}

/** Widest park column (m): a quad cut out at a 샛강 mouth or an island moat stays this small. */
export const PARK_COLUMN = 8;

// One count for the whole river: every slice's profile must have the same length.
const PARK_COLUMNS = Math.max(
  1,
  Math.ceil((Math.max(...RIVER.parkWidths) - EMBANK_SLOPE) / PARK_COLUMN),
);

function parkColumns(parkWidth: number): ProfilePoint[] {
  const from = EMBANK_SLOPE;
  const n = PARK_COLUMNS;
  const out: ProfilePoint[] = [];
  for (let k = 0; k < n; k++) {
    const a = from + ((parkWidth - from) * k) / n;
    const b = from + ((parkWidth - from) * (k + 1)) / n;
    out.push({ d: -a, y: RIVER.parkY, part: 'park' }, { d: -b, y: RIVER.parkY, part: 'park' });
  }
  return out;
}

// Must match surfaceHeight; the stone edge sinks below waterY so the water plane cuts it cleanly.
export function channelProfile(outer: number, parkWidth: number): ProfilePoint[] {
  const { bankY, parkY, waterY } = RIVER;
  const below = waterY - 0.8;
  const edgeD = -parkWidth - EMBANK_SLOPE * ((below - parkY) / (waterY - parkY));
  return [
    { d: outer, y: bankY, part: 'bank' },
    { d: 0, y: bankY, part: 'bank' },
    { d: 0, y: bankY, part: 'embankment' },
    { d: -EMBANK_SLOPE, y: parkY, part: 'embankment' },
    ...parkColumns(parkWidth),
    { d: -parkWidth, y: parkY, part: 'parkEdge' },
    { d: edgeD, y: below, part: 'parkEdge' },
  ];
}

/** Bank distance of the water edge at x (< 0, inside the channel). */
export function waterEdgeD(x: number): number {
  return -channelParkWidth(x) - EMBANK_SLOPE * 0.5;
}

// --- 샛강 and the islands ---

/** A side channel's mouth runs on until it is this far inside the main water edge (m). */
const MOUTH_INTO_WATER = 15;
const MOUTH_MAX_RUN = 200;

export interface SideStrip {
  /** Centerline with both mouths run on into the main river. */
  line: Vec2[];
  half: number;
}

function segDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}

// Two corner-cutting passes (ends kept): the layout samples every 12 m, and its kinks fold the
// inner bank rows of a 50 m channel.
function chaikin(line: readonly Vec2[], passes = 2): Vec2[] {
  let pts = line.slice();
  for (let k = 0; k < passes; k++) {
    const next: Vec2[] = [pts[0] as Vec2];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i] as Vec2;
      const b = pts[i + 1] as Vec2;
      next.push(
        { x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 },
        { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 },
      );
    }
    next.push(pts[pts.length - 1] as Vec2);
    pts = next;
  }
  return pts;
}

function mouth(end: Vec2, dir: Vec2): Vec2 {
  for (let k = 10; k <= MOUTH_MAX_RUN; k += 5) {
    const p = { x: end.x + dir.x * k, z: end.z + dir.z * k };
    if (channelDistance(p.x, p.z) < waterEdgeD(p.x) - MOUTH_INTO_WATER) return p;
  }
  throw new Error('terrain: side channel mouth never reaches the river');
}

function towardRiver(end: Vec2): Vec2 {
  let c = RIVER.samples[0] ?? end;
  for (const q of RIVER.samples) {
    if (Math.hypot(q.x - end.x, q.z - end.z) < Math.hypot(c.x - end.x, c.z - end.z)) c = q;
  }
  const l = Math.hypot(c.x - end.x, c.z - end.z) || 1;
  return { x: (c.x - end.x) / l, z: (c.z - end.z) / l };
}

export const SIDE_STRIPS: readonly SideStrip[] = RIVER.channels.map((ch) => {
  const c = ch.centerline;
  const first = c[0];
  const last = c[c.length - 1];
  if (!first || !last) throw new Error('terrain: empty side channel');
  const a = towardRiver(first);
  const b = towardRiver(last);
  return {
    line: chaikin([mouth(first, a), ...c, mouth(last, b)]),
    half: ch.width / 2,
  };
});

const SIDE_BOXES = SIDE_STRIPS.map((s) => {
  const xs = s.line.map((p) => p.x);
  const zs = s.line.map((p) => p.z);
  const m = s.half + 200;
  return {
    x0: Math.min(...xs) - m,
    x1: Math.max(...xs) + m,
    z0: Math.min(...zs) - m,
    z1: Math.max(...zs) + m,
  };
});

/** Signed distance to the water edge of one side strip (> 200 m away: Infinity). */
export function sideStripDistance(i: number, x: number, z: number): number {
  const s = SIDE_STRIPS[i];
  const box = SIDE_BOXES[i];
  if (!s || !box || x < box.x0 || x > box.x1 || z < box.z0 || z > box.z1) return Infinity;
  const p = { x, z };
  let best = Infinity;
  for (let k = 0; k < s.line.length - 1; k++) {
    best = Math.min(best, segDistance(p, s.line[k] as Vec2, s.line[k + 1] as Vec2));
  }
  return best - s.half;
}

export function sideDistance(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < SIDE_STRIPS.length; i++) best = Math.min(best, sideStripDistance(i, x, z));
  return best;
}

/** groundWaterDistance reports at least this far for points outside the river band. */
export const FAR_FROM_WATER = 60;

// z range the river channel can reach within each 20 m column of x (padded by FAR_FROM_WATER):
// outside it the exact distance query, the costliest per-vertex call, is skipped.
const BAND_BIN = 20;
const BAND = (() => {
  const halfMax = Math.max(...RIVER.widths) / 2 + FAR_FROM_WATER + 10;
  const x0 = RIVER_X0 - halfMax;
  const n = Math.ceil((RIVER_X1 + halfMax - x0) / BAND_BIN) + 1;
  const lo = new Float64Array(n).fill(Infinity);
  const hi = new Float64Array(n).fill(-Infinity);
  for (const q of RIVER.samples) {
    const a = Math.max(0, Math.floor((q.x - halfMax - x0) / BAND_BIN));
    const b = Math.min(n - 1, Math.floor((q.x + halfMax - x0) / BAND_BIN));
    for (let i = a; i <= b; i++) {
      lo[i] = Math.min(lo[i] ?? Infinity, q.z - halfMax);
      hi[i] = Math.max(hi[i] ?? -Infinity, q.z + halfMax);
    }
  }
  return { x0, n, lo, hi };
})();

function outsideRiverBand(x: number, z: number): boolean {
  // Past the polyline ends the channel runs on straight: no band there, the exact query decides.
  if (x < RIVER_X0 || x > RIVER_X1) return false;
  const i = Math.floor((x - BAND.x0) / BAND_BIN);
  return z < (BAND.lo[i] ?? Infinity) || z > (BAND.hi[i] ?? -Infinity);
}

/**
 * Distance the ground keeps from any water: the main channel and the side channels. Exact within
 * FAR_FROM_WATER of the main channel; beyond it at least FAR_FROM_WATER (enough to drop cells).
 */
export function groundWaterDistance(x: number, z: number): number {
  const main = outsideRiverBand(x, z) ? FAR_FROM_WATER : channelDistance(x, z);
  return Math.min(main, sideDistance(x, z));
}

/** Slices along a side strip every `step` m; `south` is the left normal of the walking direction. */
export function sideSlices(i: number, step = 8): ChannelSlices {
  const s = SIDE_STRIPS[i];
  if (!s) throw new Error('terrain: no side strip');
  const pts: Vec2[] = [];
  for (let k = 0; k < s.line.length - 1; k++) {
    const a = s.line[k] as Vec2;
    const b = s.line[k + 1] as Vec2;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let j = 0; j < n; j++)
      pts.push({ x: a.x + ((b.x - a.x) * j) / n, z: a.z + ((b.z - a.z) * j) / n });
  }
  pts.push(s.line[s.line.length - 1] as Vec2);
  const slices = pts.map((p, k) => {
    const a = pts[Math.max(0, k - 1)] as Vec2;
    const b = pts[Math.min(pts.length - 1, k + 1)] as Vec2;
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const along = { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
    return { p, along, south: { x: -along.z, z: along.x } };
  });
  return { xs: pts.map((p) => p.x), slices, half: pts.map(() => s.half) };
}

/** Bank-to-stone profile of a side channel: no park, the embankment runs straight into the water. */
export function sideProfile(outer: number): ProfilePoint[] {
  const below = RIVER.waterY - 0.8;
  const edgeD = -EMBANK_SLOPE * (below / RIVER.waterY);
  return [
    { d: outer, y: RIVER.bankY, part: 'bank' },
    { d: 0, y: RIVER.bankY, part: 'bank' },
    { d: 0, y: RIVER.bankY, part: 'embankment' },
    { d: edgeD, y: below, part: 'embankment' },
  ];
}

/**
 * Reach of a side channel's bank strip past its water edge (m). Must cover the ground cells
 * dropped near it: KEEP_DISTANCE (6) plus the widest cell diagonal there (12 × 24 m: 27).
 */
export const SIDE_REACH = 40;

/**
 * How far past a side channel's water edge its water plane runs (m), hidden under the bank and
 * embankment. Wider than a park quad's diagonal, so main-strip quads cut at a mouth (any corner in
 * the water) always have water under them.
 */
export const SIDE_WATER_UNDER = 12;

/** Width of the ring of water cut around an island that sits on the park strip. */
export const MOAT = 10;
/** How far the moat's water plane runs past the moat, under the park (see SIDE_WATER_UNDER). */
export const MOAT_WATER_UNDER = 12;

export function centroid(poly: readonly Vec2[]): Vec2 {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p.x;
    z += p.z;
  }
  return { x: x / Math.max(1, poly.length), z: z / Math.max(1, poly.length) };
}

/** Convex polygon offset outward by `d` m, each vertex along its corner bisector (mitred). */
export function grow(poly: readonly Vec2[], d: number): Vec2[] {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i] as Vec2;
    const b = poly[(i + 1) % n] as Vec2;
    area += a.x * b.z - b.x * a.z;
  }
  const out = area > 0 ? 1 : -1;
  const normal = (a: Vec2, b: Vec2): Vec2 => {
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: ((b.z - a.z) / l) * out, z: (-(b.x - a.x) / l) * out };
  };
  return poly.map((p, i) => {
    const u = normal(poly[(i + n - 1) % n] as Vec2, p);
    const v = normal(p, poly[(i + 1) % n] as Vec2);
    const m = { x: u.x + v.x, z: u.z + v.z };
    // A sharp corner would push the mitre far out; cap it at twice the offset.
    const k = Math.max(m.x * v.x + m.z * v.z, 0.5);
    return { x: p.x + (m.x / k) * d, z: p.z + (m.z / k) * d };
  });
}

export function inPolygon(x: number, z: number, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Vec2;
    const b = poly[j] as Vec2;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Island rings that cut through the park strip: the park is dropped and water shows inside. */
export function islandMoats(): Vec2[][] {
  return LAYOUT.islands
    .filter((isl) => isl.kind !== 'land')
    .filter((isl) => isl.polygon.some((p) => channelDistance(p.x, p.z) > waterEdgeD(p.x)))
    .map((isl) => grow(isl.polygon, MOAT));
}

export function gridAxis(
  lo: number,
  hi: number,
  step: number,
  outer: number,
  growth = 1.25,
): number[] {
  const inner: number[] = [];
  const n = Math.max(1, Math.round((hi - lo) / step));
  for (let i = 0; i <= n; i++) inner.push(lo + ((hi - lo) * i) / n);
  const left: number[] = [];
  let s = step;
  let x = lo;
  while (x > -outer) {
    s *= growth;
    x = Math.max(-outer, x - s);
    left.push(x);
  }
  const right: number[] = [];
  s = step;
  x = hi;
  while (x < outer) {
    s *= growth;
    x = Math.min(outer, x + s);
    right.push(x);
  }
  return [...left.reverse(), ...inner, ...right];
}

export function groundAxes(): { xs: number[]; zs: number[] } {
  const hx = MAP_HALF_X + 40;
  const hz = MAP_HALF_Z + 40;
  const xs = gridAxis(-hx, hx, 12, outerExtent());
  const north = gridAxis(-hz, HILL_GRID_Z, 12, outerExtent()).filter((z) => z <= HILL_GRID_Z);
  const south = gridAxis(HILL_GRID_Z, hz, 24, outerExtent()).filter((z) => z > HILL_GRID_Z);
  return { xs, zs: [...north, ...south] };
}

export function ridgePeaks(ridge: Ridge, count: number, minSep = 0.35): number[] {
  const N = 4096;
  const h = new Float64Array(N);
  for (let i = 0; i < N; i++) h[i] = ridgeProfile(ridge, (i / N) * Math.PI * 2);
  const win = 12;
  const peaks: { a: number; h: number }[] = [];
  for (let i = 0; i < N; i++) {
    const hi = h[i] ?? 0;
    let isMax = true;
    for (let k = -win; k <= win && isMax; k++) {
      if (k !== 0 && (h[(i + k + N) % N] ?? 0) > hi) isMax = false;
    }
    if (isMax) peaks.push({ a: (i / N) * Math.PI * 2, h: hi });
  }
  peaks.sort((p, q) => q.h - p.h);
  const out: number[] = [];
  for (const p of peaks) {
    const sep = (a: number): number => {
      const d = Math.abs(a - p.a) % (Math.PI * 2);
      return Math.min(d, Math.PI * 2 - d);
    };
    if (out.every((a) => sep(a) >= minSep)) out.push(p.a);
    if (out.length >= count) break;
  }
  return out;
}

const LATTICE = 128;
const lattice = (() => {
  const rng = createRng(4409);
  return Float32Array.from({ length: LATTICE * LATTICE }, () => rng.next());
})();
export function noise2(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const at = (i: number, j: number): number =>
    lattice[
      (((j % LATTICE) + LATTICE) % LATTICE) * LATTICE + (((i % LATTICE) + LATTICE) % LATTICE)
    ] ?? 0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = at(xi, zi) + (at(xi + 1, zi) - at(xi, zi)) * sx;
  const b = at(xi, zi + 1) + (at(xi + 1, zi + 1) - at(xi, zi + 1)) * sx;
  return a + (b - a) * sz;
}

// Up to ±12% off the layout ridgeHeight; sampled on a circle of the noise so it stays seamless.
export function ridgeProfile(ridge: Ridge, angle: number): number {
  const base = ridgeHeight(ridge, angle);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k1 = ridge.radius / 120;
  const k2 = ridge.radius / 40;
  const n1 = noise2(c * k1 + 17, s * k1 + 31) - 0.5;
  const n2 = noise2(c * k2 + 53, s * k2 + 7) - 0.5;
  return base * (1 + 0.16 * n1 + 0.07 * n2);
}

// Capped below the near ridge so the north plateau never shows above a low stretch of it.
export function groundVertex(x: number, z: number): { x: number; y: number; z: number } {
  const r = Math.hypot(x, z);
  const k = r > groundRadius() ? groundRadius() / r : 1;
  const px = x * k;
  const pz = z * k;
  const y = terrainHeight(px, pz);
  const rr = r * k;
  const t = Math.min(1, Math.max(0, (rr - (groundRadius() - 1300)) / 1250));
  // The cap only bites far out; ridgeHeight is too costly for every vertex.
  if (t <= 0) return { x: px, y, z: pz };
  const fade = t * t * (3 - 2 * t);
  const cap = ridgeHeight(nearRidge(), Math.atan2(pz, px)) * 0.6 - 15;
  return { x: px, y: y + (Math.min(y, cap) - y) * fade, z: pz };
}

// Must end exactly on ±outerExtent() or a gap opens at the strip ends.
export function riverSliceXs(fine: number, coarse: number): number[] {
  const xs: number[] = [];
  for (
    let x = -outerExtent();
    x < outerExtent();
    x += Math.abs(x) < MAP_HALF_X + 40 ? fine : coarse
  ) {
    xs.push(x);
  }
  if (outerExtent() - (xs[xs.length - 1] ?? -Infinity) < 1) xs.pop();
  xs.push(outerExtent());
  return xs;
}
