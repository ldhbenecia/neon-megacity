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

/** A road segment the outer wall opens for. */
export interface PalaceRoad {
  a: Vec2;
  b: Vec2;
  width: number;
}

/**
 * Wall a→b of one kind, cut at the given openings: [t0, t1] parameter ranges along a→b
 * (merged when they overlap). Pieces shorter than 1 m are dropped.
 */
function cutWall(
  a: Vec2,
  b: Vec2,
  cuts: [number, number][],
  kind: 'wall',
  height: number,
  width: number,
): PalaceWall[] {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const at = (t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  const sorted = [...cuts].sort((p, q) => p[0] - q[0]);
  const out: PalaceWall[] = [];
  let t = 0;
  for (const [c0, c1] of sorted) {
    if (c0 > t && (c0 - t) * len >= 1) out.push({ a: at(t), b: at(c0), kind, height, width });
    t = Math.max(t, c1);
  }
  if (t < 1 && (1 - t) * len >= 1) out.push({ a: at(t), b: at(1), kind, height, width });
  return out;
}

/** Opening (parameter range on a→b) for each road that reaches the wall line a→b. */
function roadCuts(
  a: Vec2,
  b: Vec2,
  roads: readonly PalaceRoad[],
  wallWidth: number,
): [number, number][] {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (b.x - a.x) / len;
  const uz = (b.z - a.z) / len;
  const along = (p: Vec2): number => (p.x - a.x) * ux + (p.z - a.z) * uz;
  const off = (p: Vec2): number => (p.x - a.x) * -uz + (p.z - a.z) * ux;
  const cuts: [number, number][] = [];
  for (const r of roads) {
    const da = off(r.a);
    const db = off(r.b);
    // Only a road that crosses the wall line or ends at the wall (within 1.5 m of its face) needs
    // an opening; one ending short of it (세종대로 at 광화문) does not.
    if (da * db > 0 && Math.min(Math.abs(da), Math.abs(db)) > wallWidth / 2 + 1.5) continue;
    // Where the road meets the wall line: its crossing point, else its end nearer the line.
    const s =
      da * db < 0
        ? along(r.a) + ((along(r.b) - along(r.a)) * da) / (da - db)
        : Math.abs(da) <= Math.abs(db)
          ? along(r.a)
          : along(r.b);
    // A road meeting the wall at an angle covers width / sin(angle) of it. Roads running along
    // the wall (under 30°) pass beside it rather than through it.
    const rl = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z) || 1;
    const sin = Math.abs(db - da) / rl;
    if (sin < 0.5) continue;
    const half = r.width / 2 / sin + 1;
    if (s < -half || s > len + half) continue;
    cuts.push([Math.max(0, (s - half) / len), Math.min(1, (s + half) / len)]);
  }
  return cuts;
}

const gateCut = (a: Vec2, b: Vec2): [number, number] => {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const s = Math.abs(PALACE_AXIS_X - a.x);
  return [(s - PALACE_GATE_HALF) / len, (s + PALACE_GATE_HALF) / len];
};

/**
 * Outer wall (south side broken by the main gate on the axis), inner walls (axis gates), the
 * covered corridor around the main court (opening on the axis) and the terrace in front of the
 * throne hall (a: south end, b: north end on the axis).
 */
export function palaceWalls(roads: readonly PalaceRoad[] = []): PalaceWall[] {
  const { x0, x1, z0, z1 } = PALACE_RECT;
  const { south, inner, xl, xr } = palaceCourts();
  const main = palaceHallBox(MAIN);
  // Outer wall: the main gate on the axis, and an opening wherever a road reaches it.
  const sw = { x: x0, z: z1 };
  const se = { x: x1, z: z1 };
  const ne = { x: x1, z: z0 };
  const nw = { x: x0, z: z0 };
  const outer = (a: Vec2, b: Vec2, gate: boolean): PalaceWall[] =>
    cutWall(
      a,
      b,
      [...(gate ? [gateCut(a, b)] : []), ...roadCuts(a, b, roads, 1.6)],
      'wall',
      4,
      1.6,
    );
  const out: PalaceWall[] = [
    ...outer(sw, se, true),
    ...outer(se, ne, false),
    ...outer(ne, nw, false),
    ...outer(nw, sw, false),
    ...inner.flatMap((z) =>
      cutWall({ x: x0, z }, { x: x1, z }, [gateCut({ x: x0, z }, { x: x1, z })], 'wall', 3.2, 1.2),
    ),
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

/**
 * Signed distance from (x, z) to segment `w` as a rectangle: a→b along, ±width/2 across, no end
 * caps (a wide terrace must not reach past its ends). < 0 inside.
 */
export function palaceWallDistance(w: PalaceWall, x: number, z: number): number {
  const dx = w.b.x - w.a.x;
  const dz = w.b.z - w.a.z;
  const len = Math.hypot(dx, dz) || 1;
  const u = ((x - w.a.x) * dx + (z - w.a.z) * dz) / len;
  const v = Math.abs((x - w.a.x) * -dz + (z - w.a.z) * dx) / len;
  const du = Math.max(-u, u - len);
  const dv = v - w.width / 2;
  if (du <= 0 && dv <= 0) return Math.max(du, dv);
  return Math.hypot(Math.max(du, 0), Math.max(dv, 0));
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
