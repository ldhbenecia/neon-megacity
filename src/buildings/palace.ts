// Palace grounds (SEOUL.md 4.3, 4.5): stone court, raised royal walk and terrace, inner walls with
// gates, a covered corridor around the main court, side halls and a rear garden. It follows the
// composition of a Joseon palace (layers of courts on one south-north axis), not any real plan.
import { createRng, type Rng } from '../core/random';
import type { BuildingSpec, Layout } from '../city/types';
import { UNIT_ICO, type GeoBuilder, type V3 } from './builder';
import { palaceWall } from './landmarks';
import { SEOUL_COLORS, face, frame, hipRoof } from './seoul';
import { glow, plain } from './shapes';

export interface PalacePlan {
  x0: number;
  x1: number;
  /** North (-z) and south (+z) edges. */
  z0: number;
  z1: number;
  axisX: number;
  /** Halls on the axis, south to north. */
  halls: BuildingSpec[];
  seed: number;
}

export function palacePlan(
  layout: Pick<Layout, 'districts' | 'buildings' | 'seed'>,
): PalacePlan | null {
  const zone = layout.districts.find((d) => d.kind === 'palace');
  if (!zone || zone.polygon.length < 3) return null;
  const xs = zone.polygon.map((p) => p.x);
  const zs = zone.polygon.map((p) => p.z);
  const halls = layout.buildings
    .filter((b) => b.archetype === 'palaceHall')
    .sort((a, b) => b.z - a.z);
  if (halls.length === 0) return null;
  const axisX = halls.reduce((s, h) => s + h.x, 0) / halls.length;
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    z0: Math.min(...zs),
    z1: Math.max(...zs),
    axisX,
    halls,
    seed: layout.seed ^ 0x9a1ace,
  };
}

const flat = (): number => 0;

const quad = (x0: number, z0: number, x1: number, z1: number, y: number): V3[] => [
  [x0, y, z0],
  [x1, y, z0],
  [x1, y, z1],
  [x0, y, z1],
];

/** The main hall is the largest one on the axis. */
function mainHall(plan: PalacePlan): BuildingSpec {
  return plan.halls.reduce((m, h) => (h.w * h.d > m.w * m.d ? h : m));
}

function smallHall(
  g: GeoBuilder,
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  rotY: number,
  lv: 0 | 1 | 2,
): void {
  const stone = plain(SEOUL_COLORS.plinth, 0.9);
  g.box(x, 0, z, w + 3, 0.8, d + 3, rotY, stone);
  g.box(x, 0.8, z, w, h, d, rotY, plain(SEOUL_COLORS.wood, 0.9));
  const P = frame(x, z, rotY);
  hipRoof(
    g,
    P,
    w / 2 + 1.6,
    d / 2 + 1.6,
    0.8 + h,
    Math.min(w, d) * 0.3,
    plain(SEOUL_COLORS.palaceTile, 0.55),
    0.6,
  );
  if (lv === 0)
    g.box(x, 0.8 + h - 0.8, z, w + 0.1, 0.5, d + 0.1, rotY, plain(SEOUL_COLORS.dancheong, 0.7));
}

function gateHouse(g: GeoBuilder, x: number, z: number, lv: 0 | 1 | 2): void {
  smallHall(g, x, z, 14, 6, 5, 0, lv);
}

/** Paved court: irregular warm-grey slabs, one quad per slab near the camera. */
function paving(g: GeoBuilder, plan: PalacePlan, rng: Rng, lv: 0 | 1 | 2): void {
  const y = 0.06;
  if (lv === 2) {
    const s = plain(SEOUL_COLORS.paving[0], 0.85);
    face(g, quad(plan.x0, plan.z0, plan.x1, plan.z1, y), s, [0, -1, 0]);
    return;
  }
  const slab = lv === 0 ? 4 : 10;
  for (let x = plan.x0; x < plan.x1 - 0.01; x += slab) {
    for (let z = plan.z0; z < plan.z1 - 0.01; z += slab) {
      const xe = Math.min(plan.x1, x + slab);
      const ze = Math.min(plan.z1, z + slab);
      const s = plain(rng.pick(SEOUL_COLORS.paving), 0.8 + 0.1 * rng.next());
      face(g, quad(x, z, xe, ze, y), s, [0, -1, 0]);
    }
  }
}

function garden(g: GeoBuilder, plan: PalacePlan, north: number, rng: Rng, lv: 0 | 1 | 2): void {
  const zA = plan.z0 + 4;
  const zB = north - 4;
  if (zB - zA < 12) return;
  const cx = plan.axisX + (plan.x1 - plan.axisX) * 0.45;
  const cz = (zA + zB) / 2;
  const r = Math.min(14, (zB - zA) / 2 - 2);
  const pts: V3[] = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const k = 1 + 0.18 * Math.sin(a * 3 + 1);
    pts.push([cx + r * 1.4 * k * Math.cos(a), 0.09, cz + r * k * Math.sin(a)]);
  }
  face(g, pts, plain(SEOUL_COLORS.water, 0.08), [cx, -1, cz]);
  // Pavilion on an island in the pond.
  g.box(cx, 0, cz, 7, 0.6, 7, 0, plain(SEOUL_COLORS.plinth, 0.9));
  for (const [dx, dz] of [
    [-2.2, -2.2],
    [2.2, -2.2],
    [2.2, 2.2],
    [-2.2, 2.2],
  ] as const) {
    g.box(cx + dx, 0.6, cz + dz, 0.4, 3, 0.4, 0, plain(SEOUL_COLORS.column, 0.8));
  }
  hipRoof(g, frame(cx, cz, 0), 3.6, 3.6, 3.6, 2.4, plain(SEOUL_COLORS.palaceTile, 0.55), 0.5);
  if (lv === 0) g.box(cx, 3.1, cz, 4.6, 0.25, 4.6, 0, glow(SEOUL_COLORS.uplight, 0.4));
  const n = lv === 0 ? 40 : 18;
  const leaf = plain(SEOUL_COLORS.foliage, 0.95);
  for (let i = 0; i < n; i++) {
    const x = plan.x0 + 6 + rng.next() * (plan.x1 - plan.x0 - 12);
    const z = zA + rng.next() * (zB - zA);
    if (Math.hypot((x - cx) / 1.4, z - cz) < r + 4) continue;
    const s = 3 + rng.next() * 3;
    g.place(UNIT_ICO, x, s * 0.9, z, s, s * 0.9, s, rng.next() * 3, leaf);
  }
}

/**
 * Everything on the palace grounds except the axis halls (archetypes.ts) and the outer wall
 * (index.ts). Deterministic: the same plan always emits the same geometry.
 */
export function palaceGrounds(g: GeoBuilder, plan: PalacePlan, lv: 0 | 1 | 2): void {
  const rng = createRng(plan.seed);
  paving(g, plan, rng, lv);
  const main = mainHall(plan);
  const stone = plain(0x8a847a, 0.85);
  // Royal walk from the south wall to the terrace, one step above the court.
  const terraceZ = main.z + main.d / 2 + 11;
  const walkLen = plan.z1 - (terraceZ + 10);
  if (walkLen > 2) g.box(plan.axisX, 0, (plan.z1 + terraceZ + 10) / 2, 6, 0.35, walkLen, 0, stone);
  g.box(plan.axisX, 0, terraceZ, main.w * 0.95, 1.2, 20, 0, stone);

  // Inner walls in the gaps north of the main hall, each with a gate on the axis; the main court
  // runs from the hall south of it to the first inner wall.
  const mi = plan.halls.indexOf(main);
  const between = (i: number): number => {
    const a = plan.halls[i] as BuildingSpec;
    const b = plan.halls[i + 1] as BuildingSpec;
    return (a.z - a.d / 2 + (b.z + b.d / 2)) / 2;
  };
  const gaps: number[] = [];
  for (let i = mi; i + 1 < plan.halls.length && gaps.length < 2; i++) gaps.push(between(i));
  for (const z of gaps) {
    palaceWall(g, { x: plan.x0, z }, { x: plan.x1, z }, flat, (x) => Math.abs(x - plan.axisX) < 8);
    gateHouse(g, plan.axisX, z, lv);
  }

  // Covered corridor (haenggak) around the main court.
  const south = mi > 0 ? between(mi - 1) : Math.min(plan.z1 - 4, main.z + main.d / 2 + 34);
  const northZ = gaps[0] ?? Math.max(plan.z0 + 4, main.z - main.d / 2 - 10);
  const half = Math.min(main.w / 2 + 28, (plan.x1 - plan.x0) / 2 - 6);
  const corridor = (x0: number, z0: number, x1: number, z1: number): void => {
    const w = Math.abs(x1 - x0) || 5;
    const d = Math.abs(z1 - z0) || 5;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    g.box(cx, 0, cz, w, 3.6, d, 0, plain(SEOUL_COLORS.wood, 0.9));
    hipRoof(
      g,
      frame(cx, cz, 0),
      w / 2 + 1,
      d / 2 + 1,
      3.6,
      1.6,
      plain(SEOUL_COLORS.palaceTile, 0.55),
      0.3,
    );
  };
  const xl = plan.axisX - half;
  const xr = plan.axisX + half;
  corridor(xl - 2.5, northZ, xl + 2.5, south);
  corridor(xr - 2.5, northZ, xr + 2.5, south);
  corridor(xl, south - 2.5, plan.axisX - 9, south + 2.5);
  corridor(plan.axisX + 9, south - 2.5, xr, south + 2.5);

  // Side halls east and west, unevenly placed.
  const count = rng.int(4, 8);
  const placed: { x: number; z: number }[] = [];
  for (let tries = 0; tries < 60 && placed.length < count; tries++) {
    const left = rng.chance(0.5);
    const x = left
      ? plan.x0 + 12 + rng.next() * (xl - plan.x0 - 22)
      : xr + 10 + rng.next() * (plan.x1 - xr - 22);
    const z = plan.z0 + 50 + rng.next() * (plan.z1 - plan.z0 - 64);
    if (!Number.isFinite(x) || placed.some((p) => Math.hypot(p.x - x, p.z - z) < 24)) continue;
    placed.push({ x, z });
    smallHall(g, x, z, 10 + rng.next() * 6, 7 + rng.next() * 3, 4 + rng.next() * 1.5, 0, lv);
  }

  const lastHall = plan.halls[plan.halls.length - 1] as BuildingSpec;
  if (lv < 2) garden(g, plan, lastHall.z - lastHall.d / 2 - 6, rng, lv);
  // Faint warm light along the inside of the outer wall base.
  if (lv === 0) {
    const s = glow(SEOUL_COLORS.uplight, 0.25);
    g.box((plan.x0 + plan.x1) / 2, 0.1, plan.z1 - 1.2, plan.x1 - plan.x0 - 4, 0.15, 0.3, 0, s);
    g.box((plan.x0 + plan.x1) / 2, 0.1, plan.z0 + 1.2, plan.x1 - plan.x0 - 4, 0.15, 0.3, 0, s);
  }
}
