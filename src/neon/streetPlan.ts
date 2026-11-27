import {
  districtAt,
  isUnbuilt,
  surfaceHeight,
  type Layout,
  type Road,
  type StreetSlot,
  type Vec2,
} from '../city/layout';
import { closestSegmentT } from '../city/math';
import type { NeonName } from '../core/palette';
import { createRng } from '../core/random';
import { Anim, roadGapIndex, signBudget, type FlatSign } from './placement';
import type { Catalog } from './catalog';

export type LampKind = 'core' | 'sodium';

export interface Lamp {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  kind: LampKind;
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
  flats: FlatSign[];
}

export const LAMP = { height: 9, arm: 2.8, headDrop: 0.35 } as const;
export const POOL_LIFT = 0.03;

export function pointSegment(p: Vec2, a: Vec2, b: Vec2): { x: number; z: number; d: number } {
  const t = closestSegmentT(p, a, b);
  const x = a.x + (b.x - a.x) * t;
  const z = a.z + (b.z - a.z) * t;
  return { x, z, d: Math.hypot(p.x - x, p.z - z) };
}

export const yawToward = (dx: number, dz: number): number => Math.atan2(-dz, dx);

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
  return { x: -Math.sin(s.rotY), z: -Math.cos(s.rotY) };
}

/** Street lights: one per 40 m of arterial and 60 m of street (alleys use stair lamps only). */
export const LAMP_CAP = 1500;

export function lampBudget(L: Pick<Layout, 'roads'>): number {
  let n = 0;
  for (const r of L.roads) {
    const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z);
    if (r.kind === 'arterial') n += len / 40;
    else if (r.kind === 'street') n += len / 60;
  }
  return Math.min(LAMP_CAP, Math.round(n));
}

// `groundAt` must match `L` (bare ground or road surface); the default is the built-in map's.
/** Street panels and ads may take this share of the sign budget; building signs keep the rest. */
export const STREET_SIGN_SHARE = 0.15;
const BUSY_KINDS: ReadonlySet<string> = new Set(['nightlife', 'sangga', 'corridor', 'brick']);

// Over the share, drop whole sign poles (pole and panels), quiet side streets first. A no-op
// when the layout fits (v2), so its plan stays identical.
function thinPoles(
  L: Layout,
  out: StreetPlan,
  poles: readonly { pole: number; from: number; to?: number; slot: StreetSlot }[],
): void {
  const excess = out.flats.length - Math.round(signBudget(L) * STREET_SIGN_SHARE);
  if (excess <= 0) return;
  const mainGap = roadGapIndex({ roads: L.roads.filter((r) => r.kind === 'arterial') }, 20);
  const order = poles
    .map((p) => ({
      p,
      key:
        (BUSY_KINDS.has(districtAt(p.slot.x, p.slot.z)) ? 2 : 0) +
        (mainGap(p.slot.x, p.slot.z) < 20 ? 1 : 0) +
        (p.from % 997) / 997 / 2,
    }))
    .sort((a, z) => a.key - z.key || a.p.from - z.p.from);
  const dropFlats = new Set<number>();
  const dropPoles = new Set<number>();
  for (const { p } of order) {
    if (dropFlats.size >= excess) break;
    dropPoles.add(p.pole);
    for (let i = p.from; i < (p.to ?? p.from); i++) dropFlats.add(i);
  }
  out.flats = out.flats.filter((_, i) => !dropFlats.has(i));
  out.poles = out.poles.filter((_, i) => !dropPoles.has(i));
}

export function planStreet(
  L: Layout,
  cat: Catalog,
  sidewalkH: number,
  seed = 4242,
  groundAt: (x: number, z: number) => number = surfaceHeight,
): StreetPlan {
  const rng = createRng(seed);
  const nearest = makeRoadIndex(L.roads);
  const out: StreetPlan = { lamps: [], pools: [], stalls: [], busStops: [], poles: [], flats: [] };
  const panels = cat.byKind.panel;
  const ads = cat.byKind.ad;
  const tents = cat.byKind.tent;
  const lift = (_s: StreetSlot): number => sidewalkH;

  const poleFlats: { pole: number; from: number; to?: number; slot: StreetSlot }[] = [];
  // Over budget, keep an even subset of street lights; a no-op when the layout fits.
  const lights = L.slots.filter((s) => s.kind === 'streetLight').length;
  const lampKeep = Math.min(1, lampBudget(L) / Math.max(1, lights));
  let lampAcc = 0;
  for (const s of L.slots) {
    if (s.kind === 'streetLight' && lampKeep < 1) {
      lampAcc += lampKeep;
      if (lampAcc < 1) continue;
      lampAcc -= 1;
    }
    // Palace grounds and parks keep street lights but carry no signs or stalls.
    const quiet = s.kind !== 'streetLight' && s.kind !== 'stairLamp';
    if (quiet && isUnbuilt(districtAt(s.x, s.z))) continue;
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
      poleFlats.push({ pole: out.poles.length - 1, from: out.flats.length, slot: s });
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
      const last = poleFlats[poleFlats.length - 1];
      if (last) last.to = out.flats.length;
    } else if (s.kind === 'busStop') {
      const y = s.y + lift(s);
      out.busStops.push({ x: s.x, y, z: s.z, yaw: s.rotY });
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
  thinPoles(L, out, poleFlats);
  // On slopes the pool centre (under the lamp head or sign) can sit higher than the slot it
  // came from; never let a pool sink into the ground.
  for (const p of out.pools) p.y = Math.max(p.y, groundAt(p.x, p.z) + POOL_LIFT);
  return out;
}
