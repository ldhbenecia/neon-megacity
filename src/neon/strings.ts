import { buildingContaining, roadSurfaceY } from '../city/layout';
import type { Layout, Road, Vec3 } from '../city/types';
import { createRng } from '../core/random';
import { districtSigns, type FlatSign } from './placement';
import type { StreetPlan } from './streetPlan';

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
/** Clearance (m) from a sign or a lamp post to the string line, so the cable never runs through one. */
export const STRING_OBSTACLE_CLEAR = 0.6;
const SAG_PER_M = 0.05;

/** Something the string must not pass through: a sign span (y0..y1) or a post from the ground. */
export interface StringObstacle {
  x: number;
  z: number;
  y0: number;
  y1: number;
  /** Half the footprint across the string line (m). */
  r: number;
}

/** 2D distance from (px, pz) to the segment a..b. */
function segDist(px: number, pz: number, a: Vec3, b: Vec3): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - a.x) * dx + (pz - a.z) * dz) / l2)) : 0;
  return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}

export function stringBlocked(s: BulbString, obstacles: readonly StringObstacle[]): boolean {
  const lo = Math.min(s.a.y, s.b.y) - s.sag;
  const hi = Math.max(s.a.y, s.b.y);
  return obstacles.some(
    (o) =>
      o.y0 < hi + 0.3 &&
      o.y1 > lo - 0.3 &&
      segDist(o.x, o.z, s.a, s.b) < o.r + STRING_OBSTACLE_CLEAR,
  );
}

/**
 * Bulb strings across nightlife alleys and streets. Each end is the last free point before the
 * first wall across the street; a string with no wall within reach on either side, or one that
 * would run through a sign or a lamp post, is skipped.
 */
export function bulbStrings(
  L: Layout,
  banners: readonly { x: number; z: number }[],
  obstacles: readonly StringObstacle[] = [],
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
      // Blades stand every few meters on both walls: slide the string a little to find a gap.
      for (const dt of STRING_SHIFTS) {
        const st = stringAt(L, r, dir, across, t + dt, y, reach);
        if (!st || near.some((u) => Math.abs(u - (t + dt)) < STRING_BANNER_CLEAR)) continue;
        if (stringBlocked(st, obstacles)) continue;
        out.push(st);
        break;
      }
    }
  }
  return out;
}

const STRING_SHIFTS = [0, 0.8, -0.8, 1.6, -1.6];

/** The string across the street at `t` along it, wall to wall, or null without two walls in reach. */
function stringAt(
  L: Layout,
  road: Road,
  dir: { x: number; z: number },
  across: { x: number; z: number },
  t: number,
  y: number,
  reach: number,
): BulbString | null {
  const cx = road.a.x + dir.x * t;
  const cz = road.a.z + dir.z * t;
  const yy = roadSurfaceY(cx, cz, road) + y;
  const end = (side: number): Vec3 | null => {
    for (let d = REACH_STEP; d <= reach; d += REACH_STEP) {
      const x = cx + across.x * side * d;
      const z = cz + across.z * side * d;
      if (buildingContaining(L, x, yy, z) !== null) {
        const back = d - REACH_STEP;
        if (back < 1) return null;
        return { x: cx + across.x * side * back, y: yy, z: cz + across.z * side * back };
      }
    }
    return null;
  };
  const a = end(-1);
  const b = a && end(1);
  return a && b ? { a, b, sag: Math.hypot(b.x - a.x, b.z - a.z) * SAG_PER_M } : null;
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

/** Signs (blades stick out up to ~1.2 m) and lamp posts that a bulb string must not cross. */
export function stringObstacles(flats: readonly FlatSign[], street: StreetPlan): StringObstacle[] {
  const out: StringObstacle[] = [];
  for (const s of [...flats, ...street.flats]) {
    if (s.y0 > 12) continue;
    out.push({ x: s.x, z: s.z, y0: s.y0, y1: s.y1, r: Math.max(s.w, 0.2) / 2 });
  }
  for (const l of street.lamps) {
    out.push({ x: l.x, z: l.z, y0: l.y, y1: l.hy, r: 0.2 });
    out.push({ x: l.hx, z: l.hz, y0: l.hy - 0.5, y1: l.hy + 0.3, r: 0.4 });
  }
  for (const p of street.poles) out.push({ x: p.x, z: p.z, y0: p.y, y1: p.y + p.h, r: 0.2 });
  return out;
}
