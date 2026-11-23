// River channel (layout v2) and the terrain height field. Pure functions only.
import { fbm1 } from './noise';
import { clamp, pointSegmentDistance, smoothstep } from './math';
import type { River, Vec2 } from './types';

const CENTERLINE: Vec2[] = Array.from({ length: 33 }, (_, i) => {
  const x = -1300 + (2600 * i) / 32;
  return { x, z: riverZ(x) };
});

const WIDTH = 240;
const PARK_WIDTH = 40;

export const RIVER: Readonly<River> = {
  centerline: CENTERLINE,
  width: WIDTH,
  waterY: -4,
  bankY: 0,
  parkWidth: PARK_WIDTH,
  parkY: -2,
  bandWidth: 60,
  widths: CENTERLINE.map(() => WIDTH),
  parkWidths: CENTERLINE.map(() => PARK_WIDTH),
  samples: CENTERLINE.map((p) => ({ ...p })),
};

/** Analytic river center z at x (the centerline polyline samples this). */
export function riverZ(x: number): number {
  return 150 + 110 * Math.sin((x + 300) / 640);
}

/** dz/dx of the analytic centerline. */
export function riverSlope(x: number): number {
  return (110 / 640) * Math.cos((x + 300) / 640);
}

/** Point on the centerline at x, and the unit normal pointing south (+Z side). */
export function riverFrame(x: number): { p: Vec2; south: Vec2; along: Vec2 } {
  const s = riverSlope(x);
  const len = Math.hypot(1, s);
  const along = { x: 1 / len, z: s / len };
  return { p: { x, z: riverZ(x) }, south: { x: -along.z, z: along.x }, along };
}

/** Distance from (x, z) to the centerline polyline. */
export function riverCenterDistance(x: number, z: number): number {
  const c = RIVER.centerline;
  const p = { x, z };
  let best = Infinity;
  for (let i = 0; i < c.length - 1; i++) {
    best = Math.min(best, pointSegmentDistance(p, c[i] as Vec2, c[i + 1] as Vec2));
  }
  return best;
}

/** Signed distance to the channel edge (embankment): < 0 inside the channel (park + water). */
export function riverSignedDistance(x: number, z: number): number {
  return riverCenterDistance(x, z) - RIVER.width / 2;
}

/** True when (x, z) is north of the river centerline. */
export function isNorthOfRiver(x: number, z: number): boolean {
  return z < riverZ(x);
}

export const TERRAIN = {
  /** Hills start rising north of this z. */
  hillStartZ: -650,
  hillEndZ: -1200,
  base: 70,
  amp: 40,
  scale: 300,
  seed: 3301,
} as const;

/**
 * Natural ground height (river channel NOT carved). 0 for z > -650, rising to at most
 * 110 m at the north edge. Continuous everywhere.
 */
export function terrainHeight(x: number, z: number): number {
  if (z >= TERRAIN.hillStartZ) return 0;
  const s = smoothstep(TERRAIN.hillStartZ, TERRAIN.hillEndZ, z);
  return s * (TERRAIN.base + TERRAIN.amp * fbm1(x / TERRAIN.scale + 64, TERRAIN.seed));
}

/** Width of the embankment and park-edge slopes (m). */
export const EMBANK_SLOPE = 4;

/**
 * Walkable / floating surface height: terrain, the embankment slope, the park (y -2)
 * and the water surface (y -4). Use it for props, cameras and anything resting on the ground.
 */
export function surfaceHeight(x: number, z: number): number {
  const d = riverSignedDistance(x, z);
  if (d >= 0) return terrainHeight(x, z);
  const slope = EMBANK_SLOPE;
  if (d > -slope) return (RIVER.parkY * -d) / slope;
  if (d >= -RIVER.parkWidth) return RIVER.parkY;
  const t = clamp((-RIVER.parkWidth - d) / slope, 0, 1);
  return RIVER.parkY + (RIVER.waterY - RIVER.parkY) * t;
}
