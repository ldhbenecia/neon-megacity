import { buildingContaining, surfaceHeight } from '../city/layout';
import type { Layout, Vec3 } from '../city/types';
import { createRng } from '../core/random';
import { districtSigns } from './placement';

/** A string of small bulbs hung wall to wall across an alley, sagging at the middle. */
export interface BulbString {
  a: Vec3;
  b: Vec3;
  sag: number;
}

export const STRING_MAX = 400;
export const STRING_STEP: readonly [number, number] = [8, 12];
/** No string this close (m, along the street) to a banner, so the two never cross on screen. */
export const STRING_BANNER_CLEAR = 4;
export const BULB_SPACING = 0.7;
const REACH_STEP = 0.25;
const SAG_PER_M = 0.05;

/**
 * Bulb strings across nightlife alleys and streets. Each end is the last free point before the
 * first wall across the street; a string with no wall within reach on either side is skipped.
 */
export function bulbStrings(
  L: Layout,
  banners: readonly { x: number; z: number }[],
  seed = 4242,
): BulbString[] {
  const rng = createRng(seed);
  const out: BulbString[] = [];
  for (const r of L.roads) {
    if (out.length >= STRING_MAX) break;
    if (!districtSigns(r.district).banners) continue;
    if ((r.kind !== 'alley' && r.kind !== 'street') || r.width > 14) continue;
    const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z);
    if (len < 24) continue;
    const dir = { x: (r.b.x - r.a.x) / len, z: (r.b.z - r.a.z) / len };
    const across = { x: -dir.z, z: dir.x };
    const near = banners
      .filter((p) => Math.abs((p.x - r.a.x) * across.x + (p.z - r.a.z) * across.z) < r.width)
      .map((p) => (p.x - r.a.x) * dir.x + (p.z - r.a.z) * dir.z);
    const reach = r.width / 2 + 8;
    for (
      let t = 6 + rng.range(0, 4);
      t < len - 6 && out.length < STRING_MAX;
      t += rng.range(STRING_STEP[0], STRING_STEP[1])
    ) {
      const y = rng.range(4.8, 6.2);
      if (near.some((u) => Math.abs(u - t) < STRING_BANNER_CLEAR)) continue;
      const cx = r.a.x + dir.x * t;
      const cz = r.a.z + dir.z * t;
      const yy = surfaceHeight(cx, cz) + y;
      const end = (side: number): Vec3 | null => {
        for (let d = REACH_STEP; d <= reach; d += REACH_STEP) {
          const x = cx + across.x * side * d;
          const z = cz + across.z * side * d;
          if (buildingContaining(L, x, yy, z) !== null) {
            const back = d - REACH_STEP;
            return back < 1
              ? null
              : { x: cx + across.x * side * back, y: yy, z: cz + across.z * side * back };
          }
        }
        return null;
      };
      const a = end(-1);
      const b = a && end(1);
      if (!a || !b) continue;
      out.push({ a, b, sag: Math.hypot(b.x - a.x, b.z - a.z) * SAG_PER_M });
    }
  }
  return out;
}

/** Point at fraction `u` along a string, on a parabolic sag. */
export function stringPoint(s: BulbString, u: number): Vec3 {
  return {
    x: s.a.x + (s.b.x - s.a.x) * u,
    y: s.a.y + (s.b.y - s.a.y) * u - 4 * s.sag * u * (1 - u),
    z: s.a.z + (s.b.z - s.a.z) * u,
  };
}

export function bulbPositions(s: BulbString): Vec3[] {
  const span = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
  const n = Math.max(2, Math.round(span / BULB_SPACING));
  const out: Vec3[] = [];
  for (let i = 1; i < n; i++) out.push(stringPoint(s, i / n));
  return out;
}
