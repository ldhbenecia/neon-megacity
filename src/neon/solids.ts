// Building solids for sign clearance tests (pure). A sign may only touch the face it hangs on:
// it must not cut into any tier, twin stack, cantilever mass or skybridge of any building.
import { buildingsInAabb, toLocal, toWorld, type BuildingSpec, type Layout } from '../city/layout';
import { sideNormal } from '../city/layout';

/** Oriented box (XZ rectangle rotated by rotY, plus a y range) or vertical cylinder. */
export interface Solid {
  kind: 'box' | 'cyl';
  x: number;
  z: number;
  /** Half extents along the local X / Z axes (box) or radius in hw (cyl). */
  hw: number;
  hd: number;
  rotY: number;
  y0: number;
  y1: number;
  /** Which building / tier it came from (tier -1 = cantilever, -2 = skybridge). */
  building: number;
  tier: number;
  stack: 0 | 1;
}

const solidCache = new WeakMap<BuildingSpec, Solid[]>();

/** Every solid volume of a building (tiers of both stacks, cantilever mass, skybridge). */
export function buildingSolids(b: BuildingSpec): Solid[] {
  const hit = solidCache.get(b);
  if (hit) return hit;
  const out: Solid[] = [];
  const stacks: [0 | 1, typeof b.tiers][] = [[0, b.tiers]];
  if (b.twin) stacks.push([1, b.twin]);
  for (const [stack, tiers] of stacks) {
    tiers.forEach((t, i) => {
      out.push({
        kind: t.shape === 'cylinder' ? 'cyl' : 'box',
        x: t.x,
        z: t.z,
        hw: t.w / 2,
        hd: t.d / 2,
        rotY: b.rotY,
        y0: t.y0,
        y1: t.y1,
        building: b.id,
        tier: i,
        stack,
      });
    });
  }
  const c = b.cantilever;
  if (c) {
    const body =
      b.tiers.find((t) => c.y0 >= t.y0 - 1e-6 && c.y0 < t.y1) ?? b.tiers[b.tiers.length - 1];
    if (body) {
      const n = sideNormal(c.side, b.rotY);
      const alongX = c.side === 'px' || c.side === 'nx';
      const half = alongX ? body.w / 2 : body.d / 2;
      out.push({
        kind: 'box',
        x: body.x + n.x * (half + c.out / 2),
        z: body.z + n.z * (half + c.out / 2),
        hw: alongX ? c.out / 2 : c.width / 2,
        hd: alongX ? c.width / 2 : c.out / 2,
        rotY: b.rotY,
        y0: c.y0,
        y1: c.y1,
        building: b.id,
        tier: -1,
        stack: 0,
      });
    }
  }
  const sb = b.skybridge;
  const t0 = b.tiers[0];
  const u0 = b.twin?.[0];
  if (sb && t0 && u0) {
    const gap = Math.hypot(u0.x - t0.x, u0.z - t0.z);
    out.push({
      kind: 'box',
      x: (t0.x + u0.x) / 2,
      z: (t0.z + u0.z) / 2,
      hw: gap / 2,
      hd: sb.width / 2,
      rotY: b.rotY,
      y0: sb.y0,
      y1: sb.y1,
      building: b.id,
      tier: -2,
      stack: 0,
    });
  }
  solidCache.set(b, out);
  return out;
}

function boxCorners(s: Pick<Solid, 'x' | 'z' | 'hw' | 'hd' | 'rotY'>): { x: number; z: number }[] {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, c]) => {
    const p = toWorld((a as number) * s.hw, (c as number) * s.hd, s.rotY);
    return { x: s.x + p.x, z: s.z + p.z };
  });
}

/** Overlap depth > `eps` between two solids (separating axis in XZ, interval in y). */
export function solidsOverlap(a: Solid, b: Solid, eps = 0.01): boolean {
  if (Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) <= eps) return false;
  if (a.kind === 'cyl' && b.kind === 'cyl') {
    return Math.hypot(a.x - b.x, a.z - b.z) < a.hw + b.hw - eps;
  }
  if (a.kind === 'cyl' || b.kind === 'cyl') {
    const c = a.kind === 'cyl' ? a : b;
    const o = a.kind === 'cyl' ? b : a;
    const l = toLocal(c.x - o.x, c.z - o.z, o.rotY);
    const dx = Math.max(Math.abs(l.x) - o.hw, 0);
    const dz = Math.max(Math.abs(l.z) - o.hd, 0);
    return Math.hypot(dx, dz) < c.hw - eps;
  }
  // Box vs box: SAT on the 4 local axes with an epsilon (touching is fine).
  const axes = [a.rotY, a.rotY + Math.PI / 2, b.rotY, b.rotY + Math.PI / 2].map((r) =>
    toWorld(1, 0, r),
  );
  const ca = boxCorners(a);
  const cb = boxCorners(b);
  for (const ax of axes) {
    let amin = Infinity;
    let amax = -Infinity;
    let bmin = Infinity;
    let bmax = -Infinity;
    for (const p of ca) {
      const d = p.x * ax.x + p.z * ax.z;
      amin = Math.min(amin, d);
      amax = Math.max(amax, d);
    }
    for (const p of cb) {
      const d = p.x * ax.x + p.z * ax.z;
      bmin = Math.min(bmin, d);
      bmax = Math.max(bmax, d);
    }
    if (Math.min(amax, bmax) - Math.max(amin, bmin) <= eps) return false;
  }
  return true;
}

/** XZ bounds of a solid. */
export function solidBounds(s: Solid): { minX: number; minZ: number; maxX: number; maxZ: number } {
  if (s.kind === 'cyl') {
    return { minX: s.x - s.hw, minZ: s.z - s.hw, maxX: s.x + s.hw, maxZ: s.z + s.hw };
  }
  const c = boxCorners(s);
  return {
    minX: Math.min(...c.map((p) => p.x)),
    minZ: Math.min(...c.map((p) => p.z)),
    maxX: Math.max(...c.map((p) => p.x)),
    maxZ: Math.max(...c.map((p) => p.z)),
  };
}

/**
 * First building solid that the volume cuts into, or null when it is clear.
 * Buildings come from the layout's 64 m spatial hash (a small margin finds touching neighbours).
 */
export function firstHit(L: Layout, v: Solid): Solid | null {
  const bb = solidBounds(v);
  const ids = buildingsInAabb(L, bb.minX - 2, bb.minZ - 2, bb.maxX + 2, bb.maxZ + 2);
  for (const id of ids) {
    const b = L.buildings[id];
    if (!b) continue;
    for (const s of buildingSolids(b)) if (solidsOverlap(v, s)) return s;
  }
  return null;
}
