// Camera collision and picking against the layout (ART_DIRECTION 8.1). Pure functions over the
// layout queries, unit tested in tests/ux-collision.test.ts.
import { frameBuilding, type Pose } from './motion';
import {
  RIVER,
  allTiers,
  buildingContaining,
  buildingTop,
  buildingsInAabb,
  raycastBuildings,
  surfaceHeight,
  terrainHeight,
  toLocal,
  toWorld,
  type BuildingSpec,
  type Layout,
  type Vec3,
} from '../city/layout';

/** Camera clearance over ground (m), and over the water surface. */
export const GROUND_CLEARANCE = 2;
export const WATER_CLEARANCE = 3;
/** Distance kept from building walls (m). */
export const WALL_MARGIN = 1.5;

/** Lowest allowed camera y at (x, z): surface + 2, or water + 3 over the river. */
export function cameraFloor(x: number, z: number): number {
  const s = surfaceHeight(x, z);
  return s <= RIVER.waterY + 1e-3 ? RIVER.waterY + WATER_CLEARANCE : s + GROUND_CLEARANCE;
}

/** Lowest allowed orbit target y: terrain + 1. */
export function targetFloor(x: number, z: number): number {
  return terrainHeight(x, z) + 1;
}

interface Box {
  /** Center and half extents in the building frame (rotY), world y range. */
  x: number;
  z: number;
  hw: number;
  hd: number;
  y0: number;
  y1: number;
  cylinder: boolean;
}

function boxesOf(b: BuildingSpec): Box[] {
  return allTiers(b).map((t) => ({
    x: t.x,
    z: t.z,
    hw: t.w / 2,
    hd: t.d / 2,
    y0: t.y0,
    y1: t.y1,
    cylinder: t.shape === 'cylinder',
  }));
}

/** Footprint box up to the very top: catches cantilevers, skybridges and spires. */
function hullOf(b: BuildingSpec): Box {
  return {
    x: b.x,
    z: b.z,
    hw: b.w / 2,
    hd: b.d / 2,
    y0: b.baseY,
    y1: buildingTop(b),
    cylinder: false,
  };
}

/** Shortest exit from `box` inflated by `m`, or null when p is outside it. */
function exitFrom(b: BuildingSpec, box: Box, p: Vec3, m: number): Vec3 | null {
  if (p.y < box.y0 - m || p.y > box.y1 + m) return null;
  const up = box.y1 + m - p.y;
  // Walls only push sideways while the point is below the roof line; above it, only "up".
  if (box.cylinder) {
    const dx = p.x - box.x;
    const dz = p.z - box.z;
    const r = Math.hypot(dx, dz);
    const R = box.hw + m;
    if (r > R) return null;
    const side = R - r;
    if (up <= side) return { x: p.x, y: box.y1 + m, z: p.z };
    const nx = r > 1e-6 ? dx / r : 1;
    const nz = r > 1e-6 ? dz / r : 0;
    return { x: box.x + nx * R, y: p.y, z: box.z + nz * R };
  }
  const l = toLocal(p.x - box.x, p.z - box.z, b.rotY);
  const hx = box.hw + m;
  const hz = box.hd + m;
  if (Math.abs(l.x) > hx || Math.abs(l.z) > hz) return null;
  const options: [number, number, number][] = [
    [hx - l.x, hx, l.z],
    [hx + l.x, -hx, l.z],
    [hz - l.z, l.x, hz],
    [hz + l.z, l.x, -hz],
  ];
  let best = options[0] as [number, number, number];
  for (const o of options) if (o[0] < best[0]) best = o;
  if (up <= best[0]) return { x: p.x, y: box.y1 + m, z: p.z };
  const w = toWorld(best[1], best[2], b.rotY);
  return { x: box.x + w.x, y: p.y, z: box.z + w.z };
}

/**
 * Pushes a point out of every building volume it is inside (or within `margin` of), to the
 * nearest face + margin. Returns the corrected point, or null when nothing needed fixing.
 */
export function resolveCollision(L: Layout, p: Vec3, margin = WALL_MARGIN): Vec3 | null {
  let cur: Vec3 = { x: p.x, y: p.y, z: p.z };
  let moved = false;
  for (let iter = 0; iter < 4; iter++) {
    let fix: Vec3 | null = null;
    for (const id of buildingsInAabb(
      L,
      cur.x - margin,
      cur.z - margin,
      cur.x + margin,
      cur.z + margin,
    )) {
      const b = L.buildings[id] as BuildingSpec;
      for (const box of boxesOf(b)) {
        const e = exitFrom(b, box, cur, margin);
        if (e && (!fix || dist2(cur, e) < dist2(cur, fix))) fix = e;
      }
    }
    // Volumes the tiers do not describe (cantilevers, skybridges, spires): use the hull.
    if (!fix) {
      const id = buildingContaining(L, cur.x, cur.y, cur.z);
      if (id !== null) {
        const b = L.buildings[id] as BuildingSpec;
        fix = exitFrom(b, hullOf(b), cur, margin);
      }
    }
    if (!fix) break;
    cur = fix;
    moved = true;
  }
  return moved ? cur : null;
}

const dist2 = (a: Vec3, b: Vec3): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

/**
 * First hit of a ray with the walkable surface (terrain, park, water), or null within `maxT`.
 * Marches in coarse steps, then bisects. `dir` must be normalized (t in metres).
 */
export function raycastSurface(o: Vec3, dir: Vec3, maxT = 6000): number | null {
  const above = (t: number): number =>
    o.y + dir.y * t - surfaceHeight(o.x + dir.x * t, o.z + dir.z * t);
  if (above(0) <= 0) return 0;
  let prev = 0;
  let t = 0;
  while (t < maxT) {
    const h = above(t);
    // Rising rays above every hill never come back down.
    if (dir.y >= 0 && o.y + dir.y * t > 200) return null;
    if (h <= 0) {
      let lo = prev;
      let hi = t;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (above(mid) > 0) lo = mid;
        else hi = mid;
      }
      return hi;
    }
    prev = t;
    t += Math.max(2, Math.min(40, h * 0.5));
  }
  return null;
}

/**
 * 8.3 framing with an unobstructed view: the default framing first, then rotated bearings and
 * steeper elevations until the line of sight to the target hits the picked building first.
 */
export function frameBuildingClear(L: Layout, b: BuildingSpec, camera: Vec3): Pose {
  const first = frameBuilding(b, camera);
  const DEG = Math.PI / 180;
  const candidates: Pose[] = [first];
  for (const elevation of [undefined, 35 * DEG, 50 * DEG, 65 * DEG]) {
    for (const bearingOffset of [0, 30, -30, 60, -60, 90, -90].map((d) => d * DEG)) {
      if (elevation === undefined && bearingOffset === 0) continue;
      candidates.push(
        frameBuilding(b, camera, { bearingOffset, ...(elevation ? { elevation } : {}) }),
      );
    }
  }
  for (const c of candidates) {
    const p = c.position;
    if (p.y < cameraFloor(p.x, p.z) || buildingContaining(L, p.x, p.y, p.z) !== null) continue;
    const dir = { x: c.target.x - p.x, y: c.target.y - p.y, z: c.target.z - p.z };
    const hit = raycastBuildings(L, p, dir);
    if (!hit || hit.id === b.id) return c;
  }
  return first;
}

export type Pick =
  | { kind: 'building'; id: number; point: Vec3; t: number }
  | { kind: 'ground'; point: Vec3; t: number };

/** What the cursor ray hits first: a building, the ground, or nothing (sky). */
export function pick(L: Layout, o: Vec3, dir: Vec3): Pick | null {
  const ground = raycastSurface(o, dir);
  const hit = raycastBuildings(L, o, dir);
  const at = (t: number): Vec3 => ({ x: o.x + dir.x * t, y: o.y + dir.y * t, z: o.z + dir.z * t });
  if (hit && (ground === null || hit.t <= ground)) {
    return { kind: 'building', id: hit.id, point: at(hit.t), t: hit.t };
  }
  if (ground !== null) return { kind: 'ground', point: at(ground), t: ground };
  return null;
}
