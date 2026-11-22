// Pure geometry helpers for the terrain module (ART_DIRECTION 2.3, 2.4). No three.js.
// Everything derives from the layout's river / terrain / ridge data and queries, so the ground,
// the 흑린강 channel and the far ridges line up with what buildings, infra and the camera use.
// Unit tests: tests/terrain.test.ts.
import {
  CITY,
  EMBANK_SLOPE,
  LAYOUT,
  RIVER,
  TERRAIN,
  riverFrame,
  riverSignedDistance,
  riverZ,
  ridgeHeight,
  terrainHeight,
  type Ridge,
} from '../city/layout';
import { createRng } from '../core/random';

export { EMBANK_SLOPE };

const NEAR_RIDGE: Ridge = (() => {
  const r = LAYOUT.ridges.find((q) => q.id === 'ridge-near') ?? LAYOUT.ridges[0];
  if (!r) throw new Error('terrain: layout has no ridges');
  return r;
})();

/**
 * Ground radius: just inside the near ridge ring, so the ground meets the ridge wall and never
 * pokes out behind it. The grid / channel run out to ±OUTER_EXTENT and are clipped to this disc.
 */
export const GROUND_RADIUS = NEAR_RIDGE.radius - 10;
export const OUTER_EXTENT = GROUND_RADIUS;

/** x range covered by the layout's river centerline polyline. */
const RIVER_X0 = Math.min(...RIVER.centerline.map((p) => p.x));
const RIVER_X1 = Math.max(...RIVER.centerline.map((p) => p.x));
/** z where the grid switches from the fine hill spacing to the coarse flat spacing. */
const HILL_GRID_Z = TERRAIN.hillStartZ + 90;

/**
 * Signed distance to the channel edge (embankment), < 0 inside. Inside the map it is exactly the
 * layout's `riverSignedDistance`; past the polyline ends it continues the analytic
 * centerline so the river runs on to the horizon.
 */
export function channelDistance(x: number, z: number): number {
  if (x >= RIVER_X0 + 10 && x <= RIVER_X1 - 10) return riverSignedDistance(x, z);
  const f = riverFrame(x);
  return Math.abs((z - riverZ(x)) * f.along.x) - RIVER.width / 2;
}

/** Surface kinds across the channel cross-section, from the bank top toward the water. */
export type ChannelPart = 'bank' | 'embankment' | 'park' | 'parkEdge';

export interface ProfilePoint {
  /** Signed distance to the embankment line (m), > 0 outside the channel. */
  d: number;
  y: number;
  part: ChannelPart;
}

/**
 * Half cross-section of the channel as flat-shaded segments (pairs of points with the same part).
 * Matches `surfaceHeight`: bank y = bankY, embankment slope down to the park (parkY), the park
 * flat for `parkWidth`, then the stone edge sinks below the water line so the water plane
 * intersects it cleanly. `outer` is how far the bank strip reaches over the ground (m).
 */
export function channelProfile(outer: number): ProfilePoint[] {
  const { bankY, parkY, parkWidth, waterY } = RIVER;
  const below = waterY - 0.8;
  const edgeD = -parkWidth - EMBANK_SLOPE * ((below - parkY) / (waterY - parkY));
  return [
    { d: outer, y: bankY, part: 'bank' },
    { d: 0, y: bankY, part: 'bank' },
    { d: 0, y: bankY, part: 'embankment' },
    { d: -EMBANK_SLOPE, y: parkY, part: 'embankment' },
    { d: -EMBANK_SLOPE, y: parkY, part: 'park' },
    { d: -parkWidth, y: parkY, part: 'park' },
    { d: -parkWidth, y: parkY, part: 'parkEdge' },
    { d: edgeD, y: below, part: 'parkEdge' },
  ];
}

/** Half width of the water plane (from the centerline), tucked under the park edge. */
export function waterHalfWidth(): number {
  return RIVER.width / 2 - RIVER.parkWidth - EMBANK_SLOPE * 0.5;
}

/**
 * Grid line coordinates on one axis: `step` spacing between `lo` and `hi`, then spacing growing
 * by `growth` per line out to ±`outer` (coarse far ground). Sorted, unique, includes ±outer.
 */
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

/**
 * Z axis: fine where the hills rise (north of `hillZ`), coarser over the flat districts, coarse
 * outside the map. Merges two `gridAxis`-style runs.
 */
export function groundAxes(): { xs: number[]; zs: number[] } {
  const half = CITY.half + 40;
  const xs = gridAxis(-half, half, 12, OUTER_EXTENT);
  const north = gridAxis(-half, HILL_GRID_Z, 12, OUTER_EXTENT).filter((z) => z <= HILL_GRID_Z);
  const south = gridAxis(HILL_GRID_Z, half, 24, OUTER_EXTENT).filter((z) => z > HILL_GRID_Z);
  return { xs, zs: [...north, ...south] };
}

/**
 * Bearings (atan2(z, x)) of the ridge's highest peaks, at least `minSep` radians apart.
 * Used for the aviation obstruction lights (5–7 of them, ART_DIRECTION 2.4).
 */
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

/**
 * Deterministic 2D value noise in [0, 1) for ground albedo variation (createRng lattice).
 */
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

/**
 * Rendered ridge silhouette height: the layout's `ridgeHeight` plus a small (±8 %) crag detail
 * at ~120 m and ~40 m along the ring, so the far ranges read as rocky crests instead of soft
 * blobs. Seamless around the ring (sampled on a circle of the 2D noise).
 */
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

/**
 * Ground vertex position after clipping to the ground disc: points past `GROUND_RADIUS` are pulled
 * radially onto it, and toward the near ridge the height is eased below the ridge silhouette so
 * the north plateau (70–110 m) never shows above a low stretch of the ridge.
 */
export function groundVertex(x: number, z: number): { x: number; y: number; z: number } {
  const r = Math.hypot(x, z);
  const k = r > GROUND_RADIUS ? GROUND_RADIUS / r : 1;
  const px = x * k;
  const pz = z * k;
  const y = terrainHeight(px, pz);
  const rr = r * k;
  const t = Math.min(1, Math.max(0, (rr - (GROUND_RADIUS - 1300)) / 1250));
  const fade = t * t * (3 - 2 * t);
  const cap = ridgeHeight(NEAR_RIDGE, Math.atan2(pz, px)) * 0.6 - 15;
  return { x: px, y: y + (Math.min(y, cap) - y) * fade, z: pz };
}

/**
 * Slice positions along x for strips that follow the river: `fine` spacing inside the map,
 * `coarse` outside, always ending exactly on ±OUTER_EXTENT (no gap at the east end).
 */
export function riverSliceXs(fine: number, coarse: number): number[] {
  const xs: number[] = [];
  for (let x = -OUTER_EXTENT; x < OUTER_EXTENT; x += Math.abs(x) < CITY.half + 40 ? fine : coarse) {
    xs.push(x);
  }
  if (OUTER_EXTENT - (xs[xs.length - 1] ?? -Infinity) < 1) xs.pop();
  xs.push(OUTER_EXTENT);
  return xs;
}
