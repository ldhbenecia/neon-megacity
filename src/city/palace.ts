// 경복궁 grounds as layout data (SEOUL.md 4.5): the real halls, gates and ponds by name, in their
// real relative order (south-north axis, east-west sides), fitted to PALACE_RECT at the map's 1:6
// plan scale. Walls, corridors, the throne-hall terrace and the ponds are derived here so collision,
// picking and buildings read the same geometry. Only relative positions follow the real palace;
// sizes are scaled to fit, not surveyed.
import { PALACE_RECT } from './river';
import type { PalaceId, PalaceWall, Vec2 } from './types';

export interface PalaceBuilding {
  id: PalaceId;
  name: string;
  part: 'gate' | 'hall' | 'annex' | 'pavilion';
  /** Offset east (+) of the axis (m). */
  dx: number;
  /** Distance north of the south wall (m). */
  k: number;
  w: number;
  d: number;
  h: number;
}

export const PALACE_AXIS_X = (PALACE_RECT.x0 + PALACE_RECT.x1) / 2;
const HALF_W = (PALACE_RECT.x1 - PALACE_RECT.x0) / 2;

/**
 * The buildings, south to north along the axis first (광화문 … 교태전), then the sides. Gates in a
 * wall stand in that wall's opening (each opening is the gate's width plus a margin).
 */
export const PALACE_BUILDINGS: readonly PalaceBuilding[] = [
  { id: 'gwanghwamun', name: '광화문', part: 'gate', dx: 0, k: 15, w: 30, d: 9, h: 12 },
  { id: 'heungnyemun', name: '흥례문', part: 'gate', dx: 0, k: 30, w: 24, d: 8, h: 9 },
  { id: 'geunjeongmun', name: '근정문', part: 'gate', dx: 0, k: 44, w: 20, d: 7, h: 9 },
  { id: 'geunjeongjeon', name: '근정전', part: 'hall', dx: 0, k: 70, w: 40, d: 20, h: 18 },
  { id: 'sajeongjeon', name: '사정전', part: 'hall', dx: 0, k: 100, w: 28, d: 12, h: 12 },
  { id: 'gangnyeongjeon', name: '강녕전', part: 'hall', dx: 0, k: 122, w: 30, d: 12, h: 11 },
  { id: 'gyotaejeon', name: '교태전', part: 'hall', dx: 0, k: 139, w: 26, d: 12, h: 10 },
  // 천추전 and 만춘전 flank 사정전; 수정전 stands south of 경회루 toward 영추문.
  { id: 'cheonchujeon', name: '천추전', part: 'annex', dx: -30, k: 100, w: 16, d: 9, h: 8 },
  { id: 'manchunjeon', name: '만춘전', part: 'annex', dx: 30, k: 100, w: 16, d: 9, h: 8 },
  { id: 'sujeongjeon', name: '수정전', part: 'annex', dx: -85, k: 90, w: 28, d: 10, h: 9 },
  { id: 'jagyeongjeon', name: '자경전', part: 'annex', dx: 85, k: 122, w: 26, d: 14, h: 9 },
  // 경회루 on the large square pond west of the inner court; 향원정 on the rear-garden pond.
  { id: 'gyeonghoeru', name: '경회루', part: 'pavilion', dx: -85, k: 128, w: 28, d: 22, h: 14 },
  { id: 'hyangwonjeong', name: '향원정', part: 'pavilion', dx: 45, k: 151, w: 7, d: 7, h: 6 },
  // Wall gates: 건춘문 east, 영추문 west, 신무문 north (on the axis).
  { id: 'geonchunmun', name: '건춘문', part: 'gate', dx: HALF_W - 5.5, k: 40, w: 8, d: 16, h: 8 },
  {
    id: 'yeongchumun',
    name: '영추문',
    part: 'gate',
    dx: -(HALF_W - 5.5),
    k: 40,
    w: 8,
    d: 16,
    h: 8,
  },
  { id: 'sinmumun', name: '신무문', part: 'gate', dx: 0, k: 152, w: 16, d: 8, h: 8 },
];

/** Axis buildings, south to north. */
export const PALACE_AXIS: readonly PalaceId[] = [
  'gwanghwamun',
  'heungnyemun',
  'geunjeongmun',
  'geunjeongjeon',
  'sajeongjeon',
  'gangnyeongjeon',
  'gyotaejeon',
];

const by = (id: PalaceId): PalaceBuilding =>
  PALACE_BUILDINGS.find((b) => b.id === id) as PalaceBuilding;

/** World centre of a palace building. */
export function palaceCenter(b: PalaceBuilding): Vec2 {
  return { x: PALACE_AXIS_X + b.dx, z: PALACE_RECT.z1 - b.k };
}

/**
 * Half width (m) of 광화문's opening in the south wall. 광화문 stands 10 m inside it so it clears
 * 세종대로, which ends at the gate square just south of the wall.
 */
export const PALACE_GATE_HALF = by('gwanghwamun').w / 2 + 1;
const zk = (k: number): number => PALACE_RECT.z1 - k;
/** Cross wall carrying 흥례문, and the corridor court around 근정전 (k from the south wall). */
const WALL_A = by('heungnyemun').k;
const COURT = { south: by('geunjeongmun').k, north: 90, half: 46 };
/** Inner wall north of 사정전 (its court), between the corridor court's sides. */
const WALL_B = 112;

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

/**
 * 경복궁's walls: the outer wall (opening at 광화문, 건춘문, 영추문, 신무문 and where roads reach
 * it), the cross wall of 흥례문, the corridor (행각) around the 근정전 court (근정문 in its south
 * side, 사정문's opening in the north), the inner wall behind 사정전, and 근정전's two-tier terrace
 * (월대; a: south end, b: north end on the axis).
 */
export function palaceWalls(roads: readonly PalaceRoad[] = []): PalaceWall[] {
  const { x0, x1, z0, z1 } = PALACE_RECT;
  const ax = PALACE_AXIS_X;
  // Opening of width 2·half centred at `at` along a→b (parameters).
  const open = (a: Vec2, b: Vec2, at: Vec2, half: number): [number, number] => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const s = ((at.x - a.x) * (b.x - a.x) + (at.z - a.z) * (b.z - a.z)) / len;
    return [(s - half) / len, (s + half) / len];
  };
  const sw = { x: x0, z: z1 };
  const se = { x: x1, z: z1 };
  const ne = { x: x1, z: z0 };
  const nw = { x: x0, z: z0 };
  const gateAt = (id: PalaceId): Vec2 => palaceCenter(by(id));
  // A side gate's opening spans its depth along the wall (it stands with w across the wall).
  const outer = (a: Vec2, b: Vec2, gates: [Vec2, number][]): PalaceWall[] =>
    cutWall(
      a,
      b,
      [...gates.map(([g, h]) => open(a, b, g, h)), ...roadCuts(a, b, roads, 1.6)],
      'wall',
      4,
      1.6,
    );
  const out: PalaceWall[] = [
    ...outer(sw, se, [[gateAt('gwanghwamun'), PALACE_GATE_HALF]]),
    ...outer(se, ne, [[gateAt('geonchunmun'), by('geonchunmun').d / 2 + 1]]),
    ...outer(ne, nw, [[gateAt('sinmumun'), by('sinmumun').w / 2 + 1]]),
    ...outer(nw, sw, [[gateAt('yeongchumun'), by('yeongchumun').d / 2 + 1]]),
  ];
  // Cross wall with 흥례문 in its opening.
  const a1 = { x: x0, z: zk(WALL_A) };
  const b1 = { x: x1, z: zk(WALL_A) };
  out.push(
    ...cutWall(
      a1,
      b1,
      [open(a1, b1, gateAt('heungnyemun'), by('heungnyemun').w / 2 + 2)],
      'wall',
      3.2,
      1.2,
    ),
  );
  // Corridor (행각) around the 근정전 court: 근정문 in the south side, 사정문's opening in the north.
  const xl = ax - COURT.half;
  const xr = ax + COURT.half;
  const s = zk(COURT.south);
  const n = zk(COURT.north);
  const corridor = (a: Vec2, b: Vec2, cuts: [number, number][] = []): PalaceWall[] =>
    cutWall(a, b, cuts, 'wall', 3.6, 5).map((w) => ({ ...w, kind: 'corridor' as const }));
  const sa = { x: xl, z: s };
  const sb = { x: xr, z: s };
  const na = { x: xl, z: n };
  const nb = { x: xr, z: n };
  out.push(
    ...corridor(sa, sb, [open(sa, sb, gateAt('geunjeongmun'), by('geunjeongmun').w / 2 + 3)]),
    ...corridor(na, nb, [open(na, nb, { x: ax, z: n }, 7)]),
    ...corridor(sa, na),
    ...corridor(sb, nb),
  );
  // Inner wall closing 사정전's court, opening on the axis.
  const a2 = { x: xl, z: zk(WALL_B) };
  const b2 = { x: xr, z: zk(WALL_B) };
  out.push(...cutWall(a2, b2, [open(a2, b2, { x: ax, z: a2.z }, 7)], 'wall', 3.2, 1.2));
  // 근정전's two-tier terrace (월대): the lower one wider, the upper one on it. Both stay below the
  // hall's stone base (palaceHall plinth: at least 1.5 m); the upper one stops 0.5 m short of the
  // hall so the two never end on one plane.
  const hall = by('geunjeongjeon');
  const face = hall.k - hall.d / 2;
  out.push(
    {
      a: { x: ax, z: zk(COURT.south + 6) },
      b: { x: ax, z: zk(face) },
      kind: 'terrace',
      height: 0.8,
      width: hall.w + 8,
    },
    {
      a: { x: ax, z: zk(COURT.south + 11) },
      b: { x: ax, z: zk(face - 0.5) },
      kind: 'terrace',
      height: 1.4,
      width: hall.w - 6,
    },
  );
  return out;
}

/** A rectangular pond around a pavilion: margins east-west and south-north (m). */
function pondAround(id: PalaceId, mx: number, mz: number): Vec2[] {
  const b = by(id);
  const c = palaceCenter(b);
  const hx = b.w / 2 + mx;
  const hz = b.d / 2 + mz;
  return [
    { x: c.x - hx, z: c.z - hz },
    { x: c.x + hx, z: c.z - hz },
    { x: c.x + hx, z: c.z + hz },
    { x: c.x - hx, z: c.z + hz },
  ];
}

/** Ponds: [0] the large square pond of 경회루, [1] the rear-garden pond of 향원정. */
export function palacePonds(): Vec2[][] {
  return [pondAround('gyeonghoeru', 16, 11.5), pondAround('hyangwonjeong', 16.5, 3)];
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
