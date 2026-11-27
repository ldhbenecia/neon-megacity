// Palace grounds (SEOUL.md 4.3, 4.5): stone court, raised royal walk and terrace, inner walls with
// gates, a covered corridor around the main court, side halls and a rear garden. It follows the
// composition of a Joseon palace (layers of courts on one south-north axis), not any real plan.
import { createRng, type Rng } from '../core/random';
import { palaceWallDistance } from '../city/layout';
import { toLocal } from '../city/math';
import type { BuildingSpec, Layout, PalaceWall, Vec2 } from '../city/types';
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
  /** Gate and halls on the axis, south to north. */
  halls: BuildingSpec[];
  /** Every palace building (axis, annexes, pavilion). */
  parts: BuildingSpec[];
  walls: readonly PalaceWall[];
  ponds: readonly (readonly Vec2[])[];
  seed: number;
}

export function palacePlan(
  layout: Pick<Layout, 'districts' | 'buildings' | 'seed' | 'palaceWalls' | 'palacePonds'>,
): PalacePlan | null {
  const zone = layout.districts.find((d) => d.kind === 'palace');
  if (!zone || zone.polygon.length < 3) return null;
  const xs = zone.polygon.map((p) => p.x);
  const zs = zone.polygon.map((p) => p.z);
  const halls = layout.buildings
    .filter((b) => b.tags.palacePart === 'gate' || b.tags.palacePart === 'hall')
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
    parts: layout.buildings.filter((b) => b.tags.palacePart !== undefined),
    walls: layout.palaceWalls,
    ponds: layout.palacePonds,
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

/** One wall, corridor or terrace from layout.palaceWalls. */
function palaceStructure(g: GeoBuilder, w: PalaceWall, lv: 0 | 1 | 2): void {
  const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
  if (len < 0.5) return;
  const cx = (w.a.x + w.b.x) / 2;
  const cz = (w.a.z + w.b.z) / 2;
  const rot = Math.atan2(-(w.b.z - w.a.z), w.b.x - w.a.x);
  switch (w.kind) {
    case 'wall':
      palaceWall(g, w.a, w.b, flat, () => false, w.height, w.width);
      return;
    case 'terrace':
      g.box(cx, 0, cz, len, w.height, w.width, rot, plain(0x8a847a, 0.85));
      return;
    case 'corridor': {
      g.box(cx, 0, cz, len, w.height, w.width, rot, plain(SEOUL_COLORS.wood, 0.9));
      const roof = plain(SEOUL_COLORS.palaceTile, 0.55);
      const ridge = lv < 2 ? plain(SEOUL_COLORS.ridge, 0.7) : undefined;
      hipRoof(g, frame(cx, cz, rot), len / 2 + 1, w.width / 2 + 1, w.height, 1.6, roof, 0.3, ridge);
      return;
    }
  }
}

/** Pond water and tree clumps around it (the pavilion is a layout building). */
function garden(g: GeoBuilder, plan: PalacePlan, rng: Rng, lv: 0 | 1 | 2): void {
  const leaf = plain(SEOUL_COLORS.foliage, 0.95);
  // Trees stay north of the innermost east-west wall, off every wall and every palace building.
  const inner = plan.walls.filter(
    (w) =>
      w.kind === 'wall' &&
      Math.abs(w.a.z - w.b.z) < 0.5 &&
      w.a.z > plan.z0 + 2 &&
      w.a.z < plan.z1 - 2,
  );
  const northWall = inner.length > 0 ? Math.min(...inner.map((w) => w.a.z)) : plan.z1;
  const onPart = (x: number, z: number, m: number): boolean =>
    plan.parts.some((b) => {
      const l = toLocal(x - b.x, z - b.z, b.rotY);
      return Math.abs(l.x) < b.w / 2 + m && Math.abs(l.z) < b.d / 2 + m;
    });
  for (const pond of plan.ponds) {
    if (pond.length < 3) continue;
    const cx = pond.reduce((s, p) => s + p.x, 0) / pond.length;
    const cz = pond.reduce((s, p) => s + p.z, 0) / pond.length;
    const r = Math.max(...pond.map((p) => Math.hypot(p.x - cx, p.z - cz)));
    face(
      g,
      pond.map((p): V3 => [p.x, 0.09, p.z]),
      plain(SEOUL_COLORS.water, 0.08),
      [cx, -1, cz],
    );
    if (lv === 2) continue;
    // LOD1 plants the first candidates of LOD0, so trees never move between levels.
    const n = lv === 0 ? 24 : 10;
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2;
      const d = r + 5 + rng.next() * 16;
      const sz = 3 + rng.next() * 3;
      const rot = rng.next() * 3;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (x < plan.x0 + 4 || x > plan.x1 - 4 || z < plan.z0 + 4 || z > northWall - sz) continue;
      if (Math.abs(x - plan.axisX) < 30 || onPart(x, z, sz)) continue;
      if (plan.walls.some((w) => palaceWallDistance(w, x, z) < sz + 1)) continue;
      g.place(UNIT_ICO, x, sz * 0.9, z, sz, sz * 0.9, sz, rot, leaf);
    }
  }
}

/**
 * Ground decoration of the palace (paving, royal walk, garden) plus the walls, corridors and
 * terrace from layout.palaceWalls. Halls, annexes and the pavilion are layout buildings drawn by
 * archetypes.ts. Deterministic: the same plan always emits the same geometry.
 */
export function palaceGrounds(g: GeoBuilder, plan: PalacePlan, lv: 0 | 1 | 2): void {
  paving(g, plan, createRng(plan.seed + 1), lv);
  for (const w of plan.walls) palaceStructure(g, w, lv);
  // Royal walk from the south gate to the terrace, one step above the court.
  const terrace = plan.walls.find((w) => w.kind === 'terrace');
  const end = terrace ? Math.max(terrace.a.z, terrace.b.z) : plan.z1;
  const walkLen = plan.z1 - end;
  if (walkLen > 2) {
    g.box(plan.axisX, 0, plan.z1 - walkLen / 2, 6, 0.35, walkLen, 0, plain(0x8a847a, 0.85));
  }
  garden(g, plan, createRng(plan.seed + 3), lv);
  // Faint warm light along the inside of the outer wall base.
  if (lv === 0) {
    const s = glow(SEOUL_COLORS.uplight, 0.25);
    g.box((plan.x0 + plan.x1) / 2, 0.1, plan.z1 - 1.4, plan.x1 - plan.x0 - 4, 0.15, 0.3, 0, s);
    g.box((plan.x0 + plan.x1) / 2, 0.1, plan.z0 + 1.4, plan.x1 - plan.x0 - 4, 0.15, 0.3, 0, s);
  }
}
