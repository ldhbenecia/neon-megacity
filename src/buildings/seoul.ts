// Geometry for the layout v3 archetypes (SEOUL.md 4.3). Walls come from the shared tier shell;
// these add roofs, columns, seams and props.
import type { BuildingSpec, Side, Tier } from '../city/types';
import { UNIT_CYL12, type GeoBuilder, type Style, type V3 } from './builder';
import { band, glow, offsetOutline, plain, tierOutline, toWorldP, type Outline } from './shapes';
import type { Rng } from '../core/random';

/** SEOUL.md 4.3 material colors. */
export const SEOUL_COLORS = {
  brick: [0x7a3324, 0x6a2c20, 0x84402c, 0x5e2a20],
  stone: [0x5e5a52, 0x6a655c, 0x524f4a],
  plaster: [0x6e665a, 0x5c564c],
  tile: 0x1a1d1f,
  palaceTile: 0x2a3036,
  ridge: 0x8a8c88,
  dancheong: 0x1f5a55,
  paving: [0x58544d, 0x5d5850, 0x55514b, 0x605a52],
  water: 0x0b1a1e,
  foliage: 0x16261c,
  column: 0x5a1a14,
  wood: 0x2a1c16,
  plinth: 0x4a4844,
  showroom: 0xf4f7ff,
  tungsten: 0xffcf8a,
  sodium: 0xffb050,
  uplight: 0xfff0d8,
  steel: 0x2c3034,
  screenOff: 0x07090b,
} as const;

export type Frame = (lx: number, y: number, lz: number) => V3;

export function frame(cx: number, cz: number, rotY: number): Frame {
  return (lx, y, lz) => {
    const p = toWorldP(cx, cz, rotY, lx, lz);
    return [p.x, y, p.z];
  };
}

/** Planar convex polygon, flipped if needed so its normal points away from `inside`. */
export function face(g: GeoBuilder, pts: readonly V3[], s: Style, inside: V3): void {
  const [a, b, c] = pts;
  if (!a || !b || !c) return;
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-9) return;
  nx /= len;
  ny /= len;
  nz /= len;
  const toIn = (inside[0] - a[0]) * nx + (inside[1] - a[1]) * ny + (inside[2] - a[2]) * nz;
  const list = toIn > 0 ? [...pts].reverse() : [...pts];
  const n: V3 = toIn > 0 ? [-nx, -ny, -nz] : [nx, ny, nz];
  const p0 = list[0] as V3;
  const p1 = list[1] as V3;
  const el = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) || 1;
  const e: V3 = [(p1[0] - p0[0]) / el, (p1[1] - p0[1]) / el, (p1[2] - p0[2]) / el];
  const base = g.vertexCount;
  for (const p of list) {
    const u = (p[0] - p0[0]) * e[0] + (p[1] - p0[1]) * e[1] + (p[2] - p0[2]) * e[2];
    g.vertex(p, n, u, s);
  }
  for (let i = 1; i < list.length - 1; i++) g.tri(base, base + i, base + i + 1);
}

/** Hip roof over a hw × hd rectangle at y, ridge along the longer axis, with a soffit below. */
export function hipRoof(
  g: GeoBuilder,
  P: Frame,
  hw: number,
  hd: number,
  y: number,
  rise: number,
  s: Style,
  lift = 0,
  ridge?: Style,
): void {
  const inside = P(0, y + rise * 0.3, 0);
  const top = y + rise;
  // Eave corners lifted by `lift` give the upturned hanok silhouette.
  const C = (sx: number, sz: number): V3 => P(sx * hw, y + lift, sz * hd);
  if (hw >= hd) {
    const r = hw - hd;
    face(g, [C(-1, 1), C(1, 1), P(r, top, 0), P(-r, top, 0)], s, inside);
    face(g, [C(1, -1), C(-1, -1), P(-r, top, 0), P(r, top, 0)], s, inside);
    face(g, [C(1, 1), C(1, -1), P(r, top, 0)], s, inside);
    face(g, [C(-1, -1), C(-1, 1), P(-r, top, 0)], s, inside);
  } else {
    const r = hd - hw;
    face(g, [C(1, 1), C(1, -1), P(0, top, -r), P(0, top, r)], s, inside);
    face(g, [C(-1, -1), C(-1, 1), P(0, top, r), P(0, top, -r)], s, inside);
    face(g, [C(-1, 1), C(1, 1), P(0, top, r)], s, inside);
    face(g, [C(1, -1), C(-1, -1), P(0, top, -r)], s, inside);
  }
  face(g, [C(-1, -1), C(1, -1), C(1, 1), C(-1, 1)], s, P(0, y + lift + 1, 0));
  if (!ridge) return;
  // Ridge and hip lines so the roof reads as tile from above.
  const r = Math.abs(hw - hd);
  const e: [V3, V3] = hw >= hd ? [P(-r, top, 0), P(r, top, 0)] : [P(0, top, -r), P(0, top, r)];
  const t = Math.max(0.25, Math.min(hw, hd) * 0.04);
  const up: V3 = [0, 1, 0];
  if (r > 0.1) g.beam(e[0], e[1], t * 1.6, t * 1.2, up, ridge);
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ] as const) {
    const end = hw >= hd ? e[sx > 0 ? 1 : 0] : e[sz > 0 ? 1 : 0];
    g.beam(C(sx, sz), end, t, t, up, ridge);
  }
}

function topTier(spec: BuildingSpec): Tier | undefined {
  return spec.tiers[spec.tiers.length - 1];
}

/** Saw-tooth roof: glazed vertical faces toward local -z (or -x), sloped backs. */
function sawtooth(g: GeoBuilder, t: Tier, rotY: number, roof: Style, glass: Style): void {
  const longX = t.w >= t.d;
  const len = longX ? t.w : t.d;
  const span = longX ? t.d : t.w;
  const n = Math.max(2, Math.round(len / 6));
  const step = len / n;
  const rise = Math.min(3.2, step * 0.55);
  const P = frame(t.x, t.z, rotY);
  // a = along the long axis, c = across.
  const L = (a: number, y: number, c: number): V3 => (longX ? P(a, y, c) : P(c, y, a));
  const y = t.y1;
  const hs = span / 2;
  for (let i = 0; i < n; i++) {
    const a0 = -len / 2 + i * step;
    const a1 = a0 + step;
    const inside = L(a0 + step * 0.6, y + rise * 0.3, 0);
    face(
      g,
      [L(a0, y, -hs), L(a0, y, hs), L(a0, y + rise, hs), L(a0, y + rise, -hs)],
      glass,
      inside,
    );
    face(g, [L(a0, y + rise, -hs), L(a0, y + rise, hs), L(a1, y, hs), L(a1, y, -hs)], roof, inside);
    face(g, [L(a0, y, hs), L(a1, y, hs), L(a0, y + rise, hs)], roof, inside);
    face(g, [L(a0, y, -hs), L(a1, y, -hs), L(a0, y + rise, -hs)], roof, inside);
  }
}

export function brickWarehouseRoof(
  g: GeoBuilder,
  spec: BuildingSpec,
  pick: number,
  lv: 0 | 1 | 2,
): void {
  const t = topTier(spec);
  if (!t) return;
  if (pick < 0.55) {
    // Only some workshops are lit at night; the rest keep dark glass.
    const glass = pick < 0.2 ? glow(SEOUL_COLORS.tungsten, 0.35) : plain(0x1a1c1e, 0.15);
    sawtooth(g, t, spec.rotY, plain(0x3a2a26, 0.7), glass);
    return;
  }
  if (lv === 2 || pick > 0.85) return;
  // Steel-and-glass extension on the flat roof.
  const w = t.w * 0.55;
  const d = t.d * 0.55;
  const h = Math.min(5, spec.floorH);
  const P = frame(t.x, t.z, spec.rotY);
  const c = P(t.w * 0.15, t.y1, 0);
  const s = glow(SEOUL_COLORS.tungsten, 0.12);
  g.box(c[0], t.y1, c[2], w, h, d, spec.rotY, s);
  g.box(c[0], t.y1 + h, c[2], w + 0.6, 0.4, d + 0.6, spec.rotY, plain(SEOUL_COLORS.steel, 0.5));
}

export function brickProps(g: GeoBuilder, spec: BuildingSpec, rng: Rng): void {
  const t = topTier(spec);
  if (!t || !rng.chance(0.15)) return;
  const P = frame(t.x, t.z, spec.rotY);
  if (rng.chance(0.5)) {
    const p = P(-t.w * 0.3, t.y1, -t.d * 0.25);
    const legs = plain(SEOUL_COLORS.steel, 0.5);
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      g.box(p[0] + dx * 0.9, t.y1, p[2] + dz * 0.9, 0.2, 3, 0.2, 0, legs);
    }
    g.place(UNIT_CYL12, p[0], t.y1 + 3, p[2], 1.4, 2.6, 1.4, 0, plain(0x4a3a30, 0.6));
  } else {
    const p = P(t.w * 0.35, t.y1, t.d * 0.3);
    g.place(UNIT_CYL12, p[0], t.y1, p[2], 0.9, 12, 0.9, 0, plain(SEOUL_COLORS.brick[2], 0.9));
  }
}

/** Palace hall: stone plinth (tier 0) and hall (tier 1); adds columns, double hip roof, uplight. */
export function palaceHall(g: GeoBuilder, spec: BuildingSpec, lv: 0 | 1 | 2): void {
  const plinth = spec.tiers[0];
  const hall = spec.tiers[1];
  if (!plinth || !hall) return;
  const P = frame(hall.x, hall.z, spec.rotY);
  const hw = hall.w / 2;
  const hd = hall.d / 2;
  const tile = plain(SEOUL_COLORS.palaceTile, 0.55);
  const hallH = hall.y1 - hall.y0;
  const eave = Math.min(3, (plinth.w - hall.w) / 2 + 1.5);
  const rise = Math.min(hd, hw) * 0.55;
  const lift = Math.min(1.2, eave * 0.4);
  const ridge = plain(SEOUL_COLORS.ridge, 0.7);
  hipRoof(g, P, hw + eave, hd + eave, hall.y1, rise * 0.35, tile, lift, ridge);
  const upper = Math.max(1.5, hallH * 0.28);
  if (lv < 2) {
    walls(g, P, hw * 0.78, hd * 0.72, hall.y1, hall.y1 + upper, plain(SEOUL_COLORS.wood, 0.9));
  }
  hipRoof(
    g,
    P,
    hw * 0.78 + eave * 0.8,
    hd * 0.72 + eave * 0.8,
    hall.y1 + upper,
    rise,
    tile,
    lift,
    ridge,
  );
  if (lv === 2) return;
  // Dancheong read: a teal band under the eaves; warm light below it at night.
  walls(g, P, hw + 0.05, hd + 0.05, hall.y1 - 0.9, hall.y1, plain(SEOUL_COLORS.dancheong, 0.7));
  if (lv === 0) {
    walls(
      g,
      P,
      hw + 0.08,
      hd + 0.08,
      hall.y1 - 1.25,
      hall.y1 - 0.95,
      glow(SEOUL_COLORS.uplight, 0.45),
    );
  }
  const col = plain(SEOUL_COLORS.column, 0.8);
  const off = 1.2;
  for (const [ax, len] of [
    [1, hall.w],
    [0, hall.d],
  ] as const) {
    const n = Math.max(2, Math.round(len / 3.6));
    for (let i = 0; i <= n; i++) {
      const s = -len / 2 + (len * i) / n;
      for (const sgn of [-1, 1]) {
        const lx = ax ? s : sgn * (hw + off);
        const lz = ax ? sgn * (hd + off) : s;
        const p = P(lx, hall.y0, lz);
        g.box(p[0], hall.y0, p[2], 0.55, hallH, 0.55, spec.rotY, col);
      }
    }
  }
  if (lv === 0) {
    const o = tierOutline(plinth, spec.rotY, 8);
    band(g, o, plinth.y1 - 0.25, 0.2, 0.06, glow(SEOUL_COLORS.uplight, 0.6));
  }
}

function walls(
  g: GeoBuilder,
  P: Frame,
  hw: number,
  hd: number,
  y0: number,
  y1: number,
  s: Style,
): void {
  const inside = P(0, (y0 + y1) / 2, 0);
  const c: [number, number][] = [
    [-hw, hd],
    [hw, hd],
    [hw, -hd],
    [-hw, -hd],
  ];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = c[i] as [number, number];
    const [bx, bz] = c[(i + 1) % 4] as [number, number];
    face(g, [P(ax, y0, az), P(bx, y0, bz), P(bx, y1, bz), P(ax, y1, az)], s, inside);
  }
}

/** Hanok row: tiled hip roof with deep eaves and a warm strip under the street eave. */
export function hanokRoof(g: GeoBuilder, spec: BuildingSpec, front: Side, lv: 0 | 1 | 2): void {
  const t = topTier(spec);
  if (!t) return;
  const P = frame(t.x, t.z, spec.rotY);
  const eave = 1.1;
  const rise = Math.min(t.w, t.d) * 0.28;
  hipRoof(g, P, t.w / 2 + eave, t.d / 2 + eave, t.y1, rise, plain(SEOUL_COLORS.tile, 0.55));
  if (lv !== 0) return;
  const alongX = front === 'pz' || front === 'nz';
  const sgn = front === 'px' || front === 'pz' ? 1 : -1;
  const half = (alongX ? t.d : t.w) / 2 + 0.05;
  const len = (alongX ? t.w : t.d) * 0.9;
  const y = t.y1 - 0.45;
  const L = (a: number, yy: number): V3 => (alongX ? P(a, yy, sgn * half) : P(sgn * half, yy, a));
  face(
    g,
    [L(-len / 2, y), L(len / 2, y), L(len / 2, y + 0.18), L(-len / 2, y + 0.18)],
    glow(SEOUL_COLORS.sodium, 0.8),
    P(0, y, 0),
  );
}

/** Taper tower: thin vertical glow seams on the chamfered corners. */
export function taperSeams(
  g: GeoBuilder,
  spec: BuildingSpec,
  hex: number,
  tiers: readonly Tier[],
): void {
  const s = glow(hex, 1.0);
  tiers.forEach((t) => {
    if (t.shape !== 'chamfer') return;
    const o = offsetOutline(tierOutline(t, spec.rotY, 8), 0.08);
    o.pts.forEach((a, i) => {
      if (o.sides[i] !== null) return;
      const b = o.pts[(i + 1) % o.pts.length];
      if (!b) return;
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const k = Math.min(0.5, 0.3 / len);
      const ux = (b.x - a.x) * k;
      const uz = (b.z - a.z) * k;
      g.wall(mx - ux, mz - uz, mx + ux, mz + uz, t.y0 + 1, t.y1 - 0.5, 0, s);
    });
  });
}

/** Showroom: a dark slab that seems to float a little above the glass box. */
export function showroomSlab(g: GeoBuilder, spec: BuildingSpec): void {
  const t = topTier(spec);
  if (!t) return;
  g.box(t.x, t.y1 + 0.4, t.z, t.w + 3, 1.2, t.d + 3, spec.rotY, plain(0x101214, 0.4), true);
}

/** Stone cornice under the roof line. */
export function cornice(g: GeoBuilder, o: Outline, y: number, s: Style): void {
  band(g, o, y - 1.1, 0.6, 0.35, s);
}
