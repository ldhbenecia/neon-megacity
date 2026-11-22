// Street prop planning (6.2): street lights, stair lamps, sign poles, 포장마차, bus stops.
// Pure: turns layout slots into plain placement data that `street.ts` instantiates.
import { districtAt, type Layout, type Road, type StreetSlot, type Vec2 } from '../city/layout';
import type { NeonName } from '../core/palette';
import { createRng } from '../core/random';
import { Anim, type FlatSign } from './placement';
import type { Catalog } from './catalog';

export type LampKind = 'core' | 'sodium';

export interface Lamp {
  /** Pole foot (on the sidewalk top or terrain). */
  x: number;
  y: number;
  z: number;
  /** Arm direction (rotation.y convention: local +X → world). */
  yaw: number;
  /** 1 = 9 m street light, ~0.35 = 3 m stair lamp. */
  scale: number;
  kind: LampKind;
  /** Lamp head world position. */
  hx: number;
  hy: number;
  hz: number;
}

export interface Pool {
  x: number;
  y: number;
  z: number;
  radius: number;
  color: 'core' | 'sodium' | NeonName;
  strength: number;
}

export interface Stall {
  x: number;
  y: number;
  z: number;
  yaw: number;
  river: boolean;
  seed: number;
}

export interface BusStop {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface Pole {
  x: number;
  y: number;
  z: number;
  h: number;
}

export interface StreetPlan {
  lamps: Lamp[];
  pools: Pool[];
  stalls: Stall[];
  busStops: BusStop[];
  poles: Pole[];
  /** Pole panels, bus-stop ads and stall banners (atlas quads). */
  flats: FlatSign[];
}

/** Street light geometry constants (9 m pole, 2.8 m arm). */
export const LAMP = { height: 9, arm: 2.8, headDrop: 0.35 } as const;
/** Pools float this far above the surface they light (never under the sidewalk). */
export const POOL_LIFT = 0.03;

/** Closest point on segment ab to p, and its distance. */
export function pointSegment(p: Vec2, a: Vec2, b: Vec2): { x: number; z: number; d: number } {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2)) : 0;
  const x = a.x + abx * t;
  const z = a.z + abz * t;
  return { x, z, d: Math.hypot(p.x - x, p.z - z) };
}

/** Yaw that turns local +X toward (dx, dz). */
export const yawToward = (dx: number, dz: number): number => Math.atan2(-dz, dx);

/** Nearest traffic road segment to a point (linear scan over a coarse grid). */
function makeRoadIndex(roads: readonly Road[]): (x: number, z: number) => Road | null {
  const cell = 128;
  const grid = new Map<string, Road[]>();
  for (const r of roads) {
    if (r.kind === 'stair') continue;
    const minX = Math.floor((Math.min(r.a.x, r.b.x) - r.width) / cell);
    const maxX = Math.floor((Math.max(r.a.x, r.b.x) + r.width) / cell);
    const minZ = Math.floor((Math.min(r.a.z, r.b.z) - r.width) / cell);
    const maxZ = Math.floor((Math.max(r.a.z, r.b.z) + r.width) / cell);
    for (let i = minX; i <= maxX; i++) {
      for (let j = minZ; j <= maxZ; j++) {
        const k = `${i},${j}`;
        const list = grid.get(k) ?? [];
        list.push(r);
        grid.set(k, list);
      }
    }
  }
  return (x, z) => {
    const ci = Math.floor(x / cell);
    const cj = Math.floor(z / cell);
    let best: Road | null = null;
    let bestD = Infinity;
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        for (const r of grid.get(`${i},${j}`) ?? []) {
          const d = pointSegment({ x, z }, r.a, r.b).d - r.width / 2;
          if (d < bestD) {
            bestD = d;
            best = r;
          }
        }
      }
    }
    return best;
  };
}

/** Direction from a slot toward the closest point on its nearest road (unit), or the slot yaw normal. */
export function towardRoad(
  nearest: (x: number, z: number) => Road | null,
  s: StreetSlot,
): { x: number; z: number } {
  const r = nearest(s.x, s.z);
  if (r) {
    const p = pointSegment({ x: s.x, z: s.z }, r.a, r.b);
    const dx = p.x - s.x;
    const dz = p.z - s.z;
    const len = Math.hypot(dx, dz);
    if (len > 0.3) return { x: dx / len, z: dz / len };
  }
  // Fallback: perpendicular to the slot's road yaw.
  return { x: -Math.sin(s.rotY), z: -Math.cos(s.rotY) };
}

export function planStreet(L: Layout, cat: Catalog, sidewalkH: number, seed = 4242): StreetPlan {
  const rng = createRng(seed);
  const nearest = makeRoadIndex(L.roads);
  const out: StreetPlan = { lamps: [], pools: [], stalls: [], busStops: [], poles: [], flats: [] };
  const panels = cat.byKind.panel;
  const ads = cat.byKind.ad;
  const tents = cat.byKind.tent;
  const lift = (_s: StreetSlot): number => sidewalkH;

  for (const s of L.slots) {
    if (s.kind === 'streetLight' || s.kind === 'stairLamp') {
      const stair = s.kind === 'stairLamp';
      const scale = stair ? 0.35 : 1;
      const d = towardRoad(nearest, s);
      const y = s.y + (stair ? 0 : lift(s));
      const kind: LampKind = stair || districtAt(s.x, s.z) === 'hillside' ? 'sodium' : 'core';
      const reach = LAMP.arm * scale;
      const lamp: Lamp = {
        x: s.x,
        y,
        z: s.z,
        yaw: yawToward(d.x, d.z),
        scale,
        kind,
        hx: s.x + d.x * reach,
        hy: y + (LAMP.height - LAMP.headDrop) * scale,
        hz: s.z + d.z * reach,
      };
      out.lamps.push(lamp);
      out.pools.push({
        x: lamp.hx,
        y: y + POOL_LIFT,
        z: lamp.hz,
        radius: stair ? 3.2 : 7.5,
        color: kind,
        strength: stair ? 0.2 : 0.28,
      });
    } else if (s.kind === 'signPole') {
      if (!rng.chance(0.66)) continue;
      const h = rng.range(6, 10);
      const y = s.y + lift(s);
      out.poles.push({ x: s.x, y, z: s.z, h });
      // Panels face along the street (readable by people walking it), stacked up the pole.
      const along = { x: Math.cos(s.rotY), z: -Math.sin(s.rotY) };
      const side = towardRoad(nearest, s);
      const count = rng.int(4, 8);
      for (let k = 0; k < count; k++) {
        const py = y + 2.6 + k * 0.68;
        if (py + 0.3 > y + h) break;
        const cell = panels.length ? rng.pick(panels) : -1;
        const off = k % 2 ? 0.5 : -0.5;
        out.flats.push({
          kind: 'panel',
          building: -1,
          face: -1,
          x: s.x + side.x * off,
          y: py,
          z: s.z + side.z * off,
          nx: along.x,
          nz: along.z,
          w: 0.8,
          h: 0.5,
          cell,
          color: cat.cells[cell]?.color ?? 'neonOrange',
          anim: rng.chance(0.05) ? Anim.flicker : Anim.none,
          zone: rng.range(0.4, 0.62),
          seed: rng.int(0, 1e6),
          doubleSided: true,
          u0: -0.4,
          u1: 0.4,
          y0: py - 0.25,
          y1: py + 0.25,
          vol: null,
        });
      }
    } else if (s.kind === 'busStop') {
      const y = s.y + lift(s);
      out.busStops.push({ x: s.x, y, z: s.z, yaw: s.rotY });
      // Side light box at the shelter's end, facing along the street.
      const along = { x: Math.cos(s.rotY), z: -Math.sin(s.rotY) };
      const cell = ads.length ? rng.pick(ads) : -1;
      out.flats.push({
        kind: 'ad',
        building: -1,
        face: -1,
        x: s.x + along.x * 2.1,
        y: y + 1.25,
        z: s.z + along.z * 2.1,
        nx: along.x,
        nz: along.z,
        w: 1.2,
        h: 1.8,
        cell,
        color: cat.cells[cell]?.color ?? 'neonCyan',
        anim: Anim.none,
        zone: rng.range(0.3, 0.5),
        seed: rng.int(0, 1e6),
        doubleSided: true,
        u0: -0.6,
        u1: 0.6,
        y0: y + 0.35,
        y1: y + 2.15,
        vol: null,
      });
      out.pools.push({
        x: s.x,
        y: y + POOL_LIFT,
        z: s.z,
        radius: 4,
        color: 'neonWhite',
        strength: 0.35,
      });
    } else if (s.kind === 'pojangmacha') {
      const river = districtAt(s.x, s.z) === 'riverside';
      out.stalls.push({ x: s.x, y: s.y, z: s.z, yaw: s.rotY, river, seed: rng.int(0, 1e6) });
      const front = { x: -Math.sin(s.rotY), z: -Math.cos(s.rotY) };
      const cell = tents.length ? rng.pick(tents) : -1;
      out.flats.push({
        kind: 'tent',
        building: -1,
        face: -1,
        x: s.x + front.x * 1.23,
        y: s.y + 2.25,
        z: s.z + front.z * 1.23,
        nx: front.x,
        nz: front.z,
        w: 2.2,
        h: 0.55,
        cell,
        color: 'neonOrange',
        anim: Anim.none,
        zone: river ? rng.range(0, 0.12) : rng.range(0.4, 0.6),
        seed: rng.int(0, 1e6),
        doubleSided: false,
        u0: -1.1,
        u1: 1.1,
        y0: s.y + 1.975,
        y1: s.y + 2.525,
        vol: null,
      });
      out.pools.push({
        x: s.x + front.x * 1.5,
        y: s.y + POOL_LIFT,
        z: s.z + front.z * 1.5,
        radius: 5.5,
        color: 'neonOrange',
        strength: 0.6,
      });
    }
  }
  return out;
}
