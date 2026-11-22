// Pure geometry helpers for the terrain module (ART_DIRECTION 2.3, 2.4). No three.js.
// Everything derives from the layout's river / terrain / ridge data and queries, so the ground,
// the 흑린강 channel and the far ridges line up with what buildings, infra and the camera use.
// Unit tests: tests/terrain.test.ts.
import {
  CITY,
  RIVER,
  riverFrame,
  riverSignedDistance,
  riverZ,
  ridgeHeight,
  type Ridge,
} from '../city/layout';
import { createRng } from '../core/random';

/** Width of the embankment / park-edge slopes (m). Same value `surfaceHeight` uses. */
export const EMBANK_SLOPE = 4;

/** Ground and channel extend past the map edge to just behind the near ridge ring. */
export const OUTER_EXTENT = 2600;

/**
 * Signed distance to the channel edge (embankment), < 0 inside. Inside the map it is exactly the
 * layout's `riverSignedDistance`; past the polyline ends (|x| > 1300) it continues the analytic
 * centerline so the river runs on to the horizon.
 */
export function channelDistance(x: number, z: number): number {
  const c = RIVER.centerline;
  const x0 = (c[0]?.x ?? -1300) + 10;
  const x1 = (c[c.length - 1]?.x ?? 1300) - 10;
  if (x >= x0 && x <= x1) return riverSignedDistance(x, z);
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
  const north = gridAxis(-half, -560, 12, OUTER_EXTENT).filter((z) => z <= -560);
  const south = gridAxis(-560, half, 24, OUTER_EXTENT).filter((z) => z > -560);
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
