import { frameBuilding, type Pose } from './motion';
import {
  RIVER,
  buildingVolumes,
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

export const GROUND_CLEARANCE = 2;
export const WATER_CLEARANCE = 3;
export const WALL_MARGIN = 1.5;
/** Largest `standoff()`; also the radius of the neighbour query. */
export const MAX_STANDOFF = 25;

/**
 * Camera clearance from a building's walls and roof: 10 % of its height, 3..25 m. Closer than
 * that a tower face fills the whole view and reads as a black screen; low street buildings keep
 * a small one so eye-level views between them stay possible.
 */
export function standoff(b: BuildingSpec): number {
  return Math.min(MAX_STANDOFF, Math.max(3, buildingTop(b) * 0.1));
}
// A point pushed onto the margin boundary must count as outside despite rotation round-off.
const EDGE_EPS = 1e-6;

export function cameraFloor(x: number, z: number): number {
  const s = surfaceHeight(x, z);
  return s <= RIVER.waterY + 1e-3 ? RIVER.waterY + WATER_CLEARANCE : s + GROUND_CLEARANCE;
}

export function targetFloor(x: number, z: number): number {
  return terrainHeight(x, z) + 1;
}

interface Box {
  x: number;
  z: number;
  hw: number;
  hd: number;
  y0: number;
  y1: number;
  cylinder: boolean;
}

function boxesOf(b: BuildingSpec): Box[] {
  return buildingVolumes(b).map((t) => ({
    x: t.x,
    z: t.z,
    hw: t.w / 2,
    hd: t.d / 2,
    y0: t.y0,
    y1: t.y1,
    cylinder: t.shape === 'cylinder',
  }));
}

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

function exitFrom(b: BuildingSpec, box: Box, p: Vec3, m: number): Vec3 | null {
  if (p.y <= box.y0 - m + EDGE_EPS || p.y >= box.y1 + m - EDGE_EPS) return null;
  const up = box.y1 + m - p.y;
  // Walls only push sideways while the point is below the roof line; above it, only "up".
  if (box.cylinder) {
    const dx = p.x - box.x;
    const dz = p.z - box.z;
    const r = Math.hypot(dx, dz);
    const R = box.hw + m;
    if (r >= R - EDGE_EPS) return null;
    const side = R - r;
    if (up <= side) return { x: p.x, y: box.y1 + m, z: p.z };
    const nx = r > 1e-6 ? dx / r : 1;
    const nz = r > 1e-6 ? dz / r : 0;
    return { x: box.x + nx * R, y: p.y, z: box.z + nz * R };
  }
  const l = toLocal(p.x - box.x, p.z - box.z, b.rotY);
  const hx = box.hw + m;
  const hz = box.hd + m;
  if (Math.abs(l.x) >= hx - EDGE_EPS || Math.abs(l.z) >= hz - EDGE_EPS) return null;
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

function settle(
  L: Layout,
  p: Vec3,
  marginOf: (b: BuildingSpec) => number,
  reach: number,
): { at: Vec3; moved: boolean; settled: boolean } {
  let cur: Vec3 = { x: p.x, y: p.y, z: p.z };
  let moved = false;
  for (let iter = 0; iter < 6; iter++) {
    let fix: Vec3 | null = null;
    for (const id of buildingsInAabb(
      L,
      cur.x - reach,
      cur.z - reach,
      cur.x + reach,
      cur.z + reach,
    )) {
      const b = L.buildings[id] as BuildingSpec;
      const m = marginOf(b);
      for (const box of boxesOf(b)) {
        const e = exitFrom(b, box, cur, m);
        if (e && (!fix || dist2(cur, e) < dist2(cur, fix))) fix = e;
      }
    }
    if (!fix) {
      const id = buildingContaining(L, cur.x, cur.y, cur.z);
      if (id !== null) {
        const b = L.buildings[id] as BuildingSpec;
        fix = exitFrom(b, hullOf(b), cur, marginOf(b));
      }
    }
    if (!fix) return { at: cur, moved, settled: true };
    cur = fix;
    moved = true;
  }
  return { at: cur, moved, settled: false };
}

/**
 * Pushes `p` out of every building's clearance (`standoff` unless `margin` is given). Where the
 * clearances of close neighbours overlap (e.g. between twin towers) no such point exists nearby,
 * so it falls back to the hard WALL_MARGIN, then to rising above the nearby roofs; the result is
 * idempotent either way.
 */
export function resolveCollision(L: Layout, p: Vec3, margin?: number): Vec3 | null {
  if (margin !== undefined) {
    const r = settle(L, p, () => margin, margin);
    return r.moved ? r.at : null;
  }
  const soft = settle(L, p, standoff, MAX_STANDOFF);
  if (soft.settled) return soft.moved ? soft.at : null;
  const hard = settle(L, p, () => WALL_MARGIN, WALL_MARGIN);
  if (hard.settled) return hard.moved ? hard.at : null;
  // Even the hard margin ping-pongs (narrow alley between rotated blocks): rise above every roof
  // whose clearance could reach this point.
  let y = p.y;
  for (const id of buildingsInAabb(
    L,
    p.x - MAX_STANDOFF,
    p.z - MAX_STANDOFF,
    p.x + MAX_STANDOFF,
    p.z + MAX_STANDOFF,
  )) {
    const b = L.buildings[id] as BuildingSpec;
    y = Math.max(y, buildingTop(b) + standoff(b));
  }
  return { x: p.x, y, z: p.z };
}

const dist2 = (a: Vec3, b: Vec3): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

// `dir` must be normalized: the returned t is in metres.
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
