// Palace grounds as layout data (SEOUL.md 4.5): walls, covered corridors, the throne-hall terrace
// and the rear-garden pond, derived from PALACE_RECT and the hall plan so collision, picking and
// buildings all read the same geometry. The composition follows a Joseon palace in general (courts
// layered on one south-north axis), not any real plan.
import { PALACE_RECT } from './river';
import type { PalaceWall, Vec2 } from './types';

/**
 * Axis halls south to north (gate, throne, council, residence):
 * [distance north of the south wall, width, depth, height].
 */
export const PALACE_PLAN: readonly (readonly [number, number, number, number])[] = [
  [20, 34, 12, 10],
  [62, 48, 26, 18],
  [104, 40, 22, 15],
  [138, 30, 16, 11],
];

/** Half width (m) of the gate openings on the axis. */
export const PALACE_GATE_HALF = 8;
const MAIN = 1;

export const PALACE_AXIS_X = (PALACE_RECT.x0 + PALACE_RECT.x1) / 2;

/** Centre z and footprint of hall slot i. */
export function palaceHallBox(i: number): { z: number; w: number; d: number; h: number } {
  const [k, w, d, h] = PALACE_PLAN[i] as readonly [number, number, number, number];
  return { z: PALACE_RECT.z1 - k, w, d, h };
}

/** z halfway between the north face of slot i and the south face of slot i + 1. */
function between(i: number): number {
  const a = palaceHallBox(i);
  const b = palaceHallBox(i + 1);
  return (a.z - a.d / 2 + (b.z + b.d / 2)) / 2;
}

/** Courts: the south corridor line, the inner walls north of the throne hall, the corridor box. */
export function palaceCourts(): { south: number; inner: number[]; xl: number; xr: number } {
  const main = palaceHallBox(MAIN);
  const inner = [between(MAIN), between(MAIN + 1)];
  const half = Math.min(main.w / 2 + 28, (PALACE_RECT.x1 - PALACE_RECT.x0) / 2 - 6);
  return { south: between(MAIN - 1), inner, xl: PALACE_AXIS_X - half, xr: PALACE_AXIS_X + half };
}

/** A wall from x0 to x1 at z, broken by the axis gate. */
function gatedWall(x0: number, x1: number, z: number, kind: 'wall', h: number, w: number) {
  const g0 = PALACE_AXIS_X - PALACE_GATE_HALF;
  const g1 = PALACE_AXIS_X + PALACE_GATE_HALF;
  return [
    { a: { x: x0, z }, b: { x: g0, z }, kind, height: h, width: w },
    { a: { x: g1, z }, b: { x: x1, z }, kind, height: h, width: w },
  ];
}

/**
 * Outer wall (south side broken by the main gate on the axis), inner walls (axis gates), the
 * covered corridor around the main court (opening on the axis) and the terrace in front of the
 * throne hall (a: south end, b: north end on the axis).
 */
export function palaceWalls(): PalaceWall[] {
  const { x0, x1, z0, z1 } = PALACE_RECT;
  const { south, inner, xl, xr } = palaceCourts();
  const main = palaceHallBox(MAIN);
  const out: PalaceWall[] = [
    ...gatedWall(x0, x1, z1, 'wall', 4, 1.6),
    { a: { x: x1, z: z1 }, b: { x: x1, z: z0 }, kind: 'wall', height: 4, width: 1.6 },
    { a: { x: x1, z: z0 }, b: { x: x0, z: z0 }, kind: 'wall', height: 4, width: 1.6 },
    { a: { x: x0, z: z0 }, b: { x: x0, z: z1 }, kind: 'wall', height: 4, width: 1.6 },
    ...inner.flatMap((z) => gatedWall(x0, x1, z, 'wall', 3.2, 1.2)),
  ];
  const corridor = (a: Vec2, b: Vec2): PalaceWall => ({
    a,
    b,
    kind: 'corridor',
    height: 3.6,
    width: 5,
  });
  const north = inner[0] as number;
  out.push(
    corridor({ x: xl, z: south }, { x: xl, z: north }),
    corridor({ x: xr, z: south }, { x: xr, z: north }),
    corridor({ x: xl, z: south }, { x: PALACE_AXIS_X - 9, z: south }),
    corridor({ x: PALACE_AXIS_X + 9, z: south }, { x: xr, z: south }),
  );
  const front = main.z + main.d / 2;
  const depth = Math.max(4, Math.min(20, south - 4 - front));
  out.push({
    a: { x: PALACE_AXIS_X, z: front + depth },
    b: { x: PALACE_AXIS_X, z: front },
    kind: 'terrace',
    height: 1.2,
    width: main.w * 0.95,
  });
  return out;
}

/** Rear-garden pond: east of the axis halls, north of the last inner wall. */
export function palacePond(): Vec2[] {
  const inner = palaceCourts().inner.at(-1) as number;
  const axisHalf = Math.max(...PALACE_PLAN.map((p) => p[1] / 2)) + 6;
  const x0 = PALACE_AXIS_X + axisHalf + 12;
  const x1 = Math.min(PALACE_RECT.x1 - 14, x0 + 44);
  const z1 = inner - 8;
  const z0 = Math.max(PALACE_RECT.z0 + 6, z1 - 28);
  return [
    { x: x0, z: z0 },
    { x: x1, z: z0 },
    { x: x1, z: z1 },
    { x: x0, z: z1 },
  ];
}

/** Distance from (x, z) to wall segment `w`'s centerline minus half its width (< 0 inside). */
export function palaceWallDistance(w: PalaceWall, x: number, z: number): number {
  const dx = w.b.x - w.a.x;
  const dz = w.b.z - w.a.z;
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - w.a.x) * dx + (z - w.a.z) * dz) / len2));
  return Math.hypot(x - (w.a.x + dx * t), z - (w.a.z + dz * t)) - w.width / 2;
}

/** The palace wall, corridor or terrace segment containing (x, z), or null (collision, picking). */
export function palaceWallAt(
  layout: { palaceWalls: readonly PalaceWall[] },
  x: number,
  z: number,
): PalaceWall | null {
  for (const w of layout.palaceWalls) if (palaceWallDistance(w, x, z) <= 0) return w;
  return null;
}
