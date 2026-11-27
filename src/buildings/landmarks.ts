// Landmark towers (SEOUL.md 4.5): location and height ratio follow the real skyline; the forms
// are this city's own. Each replaces the spec's tier stack and stays inside its footprint.
import { NEON } from '../core/palette';
import type { BuildingSpec, LandmarkId } from '../city/types';
import { UNIT_CYL12, UNIT_CYL8, type GeoBuilder, type Style, type V3 } from './builder';
import { band, glow, plain, rectOutline, walls, type Outline, type P2 } from './shapes';
import { face, frame } from './seoul';

/** Curtain-wall style for a wall of length `len`; tier 0 gets the lobby storefront. */
export type WallStyle = (len: number, tier: number) => Style;

interface Ctx {
  g: GeoBuilder;
  spec: BuildingSpec;
  wall: WallStyle;
  roof: Style;
  lv: 0 | 1 | 2;
}

export function emitLandmark(
  id: LandmarkId,
  g: GeoBuilder,
  spec: BuildingSpec,
  wall: WallStyle,
  roof: Style,
  lv: 0 | 1 | 2,
): boolean {
  const c: Ctx = { g, spec, wall, roof, lv };
  switch (id) {
    case 'yongsan-apex':
      yongsanApex(c);
      return true;
    case 'jamsil-blade':
      jamsilBlade(c);
      return true;
    case 'yeouido-gold':
      yeouidoSlab(c);
      return true;
    default:
      return false;
  }
}

function prism(c: Ctx, o: Outline, y0: number, y1: number, tier: number, bottom = false): void {
  walls(c.g, o, y0, y1, (_i, len) => c.wall(len, tier));
  c.g.cap(o.pts, y1, c.roof);
  if (bottom) c.g.cap(o.pts, y0, c.roof, true);
}

function beacon(c: Ctx, x: number, y: number, z: number): void {
  c.g.box(x, y, z, 1.2, 1.2, 1.2, 0, glow(NEON.neonRed.hex, 1.4));
}

/** Twin legs joined above an arch into one stepped crown; two ring frames at the waist. */
function yongsanApex(c: Ctx): void {
  const { spec, g } = c;
  const W = spec.w;
  const D = spec.d;
  const H = spec.h;
  const y0 = spec.baseY;
  const P = frame(spec.x, spec.z, spec.rotY);
  const at = (lx: number, lz: number): P2 => {
    const p = P(lx, 0, lz);
    return { x: p[0], z: p[2] };
  };
  const legW = W * 0.32;
  const gap = W - 2 * legW;
  const legD = D * 0.9;
  const yM = y0 + H * 0.8;
  for (const sgn of [-1, 1]) {
    const m = at(sgn * (W / 2 - legW / 2), 0);
    prism(c, rectOutline(m.x, m.z, legW, legD, spec.rotY, 3), y0, yM, 0);
  }
  const yA = y0 + H * 0.62;
  const steps = c.lv === 2 ? 3 : 8;
  const archD = legD * 0.85;
  for (let k = 0; k < steps; k++) {
    const ya = yA + ((yM - yA) * k) / steps;
    const yb = yA + ((yM - yA) * (k + 1)) / steps;
    const t = (k + 1) / steps;
    const voidHalf = (gap / 2) * Math.sqrt(Math.max(0, 1 - t * t));
    const fill = gap / 2 - voidHalf;
    if (fill < 0.05) continue;
    for (const sgn of [-1, 1]) {
      const m = at(sgn * (voidHalf + fill / 2), 0);
      g.box(m.x, ya, m.z, fill, yb - ya, archD, spec.rotY, c.wall(fill, 1), true);
    }
  }
  const crown = [
    [0.98, 0.86, 0.08],
    [0.8, 0.72, 0.07],
    [0.6, 0.56, 0.05],
  ] as const;
  let y = yM;
  crown.forEach(([kw, kd, kh], i) => {
    const y1 = i === crown.length - 1 ? y0 + H : y + H * kh;
    prism(c, rectOutline(spec.x, spec.z, W * kw, D * kd, spec.rotY, 4), y, y1, 1, i === 0);
    y = y1;
  });
  beacon(c, spec.x, y0 + H, spec.z);
  for (const f of [0.4, 0.48]) {
    const ry = y0 + H * f;
    const o = rectOutline(spec.x, spec.z, W + 4, legD + 4, spec.rotY, 8);
    band(g, o, ry, 5, 0.8, plain(0x0c0f12, 0.4));
    if (c.lv === 2) continue;
    const cyan = glow(NEON.neonCyan.hex, 1.1);
    band(g, o, ry - 0.05, 0.35, 0.9, cyan);
    band(g, o, ry + 4.7, 0.35, 0.9, cyan);
  }
}

function triangle(cx: number, cz: number, r: number, a0: number): Outline {
  const pts: P2[] = [];
  for (let i = 0; i < 3; i++) {
    const a = a0 + (i * Math.PI * 2) / 3;
    pts.push({ x: cx + r * Math.cos(a), z: cz - r * Math.sin(a) });
  }
  return { pts, sides: [null, null, null], curved: false, cx, cz };
}

/** Three-sided prism twisting a little per segment, orange helix, two tilted blades on top. */
function jamsilBlade(c: Ctx): void {
  const { spec, g } = c;
  const H = spec.h;
  const y0 = spec.baseY;
  const R0 = (Math.min(spec.w, spec.d) / 2) * 0.96;
  const bodyH = H * 0.9;
  const n = c.lv === 2 ? 10 : 24;
  const segH = bodyH / n;
  const helix = glow(NEON.neonOrange.hex, 1.2);
  let last: Outline | null = null;
  for (let k = 0; k < n; k++) {
    const t = k / n;
    const o = triangle(spec.x, spec.z, R0 * (1 - 0.1 * t), spec.rotY + t * (Math.PI / 3));
    const ya = y0 + k * segH;
    prism(c, o, ya, ya + segH, k === 0 ? 0 : 1, k > 0);
    last = o;
    if (c.lv === 2) continue;
    const e = k % 3;
    const a = o.pts[e] as P2;
    const b = o.pts[(e + 1) % 3] as P2;
    const nx = (a.x + b.x) / 2 - spec.x;
    const nz = (a.z + b.z) / 2 - spec.z;
    const nl = Math.hypot(nx, nz) || 1;
    const ox = (nx / nl) * 0.2;
    const oz = (nz / nl) * 0.2;
    const q = (p: P2, yy: number): V3 => [p.x + ox, yy, p.z + oz];
    face(g, [q(a, ya), q(b, ya + segH - 1.4), q(b, ya + segH), q(a, ya + 1.4)], helix, [
      spec.x,
      ya + segH / 2,
      spec.z,
    ]);
  }
  if (!last) return;
  const yT = y0 + bodyH;
  const P = frame(spec.x, spec.z, spec.rotY + Math.PI / 3);
  const r = R0 * 0.9 * 0.5;
  const blade = glow(NEON.neonRed.hex, 1.3);
  const top = y0 + H + 25;
  for (const sgn of [-1, 1]) {
    const base = sgn * r * 0.35;
    const quad: V3[] = [
      P(-r, yT, base),
      P(r, yT, base),
      P(r * 0.15, top, base + sgn * 12),
      P(-r * 0.35, top - 6, base + sgn * 11),
    ];
    face(g, quad, blade, P(0, yT, base - sgn));
    face(g, quad, blade, P(0, yT, base + sgn));
  }
  beacon(c, spec.x, top - 1, spec.z);
}

/** Riverside slab tower stepping round floor by floor; cyan and amber bands between steps. */
function yeouidoSlab(c: Ctx): void {
  const { spec, g } = c;
  const W = Math.min(spec.w, spec.d);
  const L = W * 0.88;
  const T = W * 0.42;
  const H = spec.h;
  const y0 = spec.baseY;
  const n = c.lv === 2 ? 6 : 14;
  const segH = H / n;
  const twist = 0.55;
  for (let k = 0; k < n; k++) {
    const rot = spec.rotY + (k / (n - 1)) * twist;
    const o = rectOutline(spec.x, spec.z, L, T, rot, 2);
    const ya = y0 + k * segH;
    prism(c, o, ya, ya + segH, k === 0 ? 0 : 1, k > 0);
    if (c.lv === 2 || k === 0) continue;
    const hex = k % 2 === 1 ? NEON.neonCyan.hex : NEON.neonAmber.hex;
    band(g, o, ya - 0.3, 0.6, 0.25, glow(hex, 1.0));
  }
  beacon(c, spec.x, y0 + H, spec.z);
}

/**
 * Namsan tower (SEOUL.md 4.5): a thick shaft, a disc-shaped viewing pod near its top and an
 * antenna above, so it reads as a tower on the hill. Silhouette and proportion only: no windows,
 * colour bands or logos from the real tower.
 */
export function namsanMast(
  g: GeoBuilder,
  x: number,
  y0: number,
  z: number,
  h: number,
  lv: 1 | 2,
): void {
  const concrete = plain(0x8a8c88, 0.75);
  const dark = plain(0x14181c, 0.4);
  const segs = lv === 2 ? UNIT_CYL8 : UNIT_CYL12;
  const shaftTop = y0 + h * 0.62;
  // Base pavilion, then a shaft that narrows a little toward the pod.
  g.place(segs, x, y0, z, 9, h * 0.04, 9, 0, dark);
  g.place(segs, x, y0, z, 4.2, h * 0.35, 4.2, 0, concrete);
  g.place(segs, x, y0 + h * 0.35, z, 3.4, shaftTop - (y0 + h * 0.35), 3.4, 0, concrete);
  // Viewing pod: wide disc, a dark glass band and a teal lit rim at night.
  const podY = y0 + h * 0.52;
  g.place(segs, x, podY, z, 10, h * 0.025, 10, 0, concrete);
  g.place(segs, x, podY + h * 0.025, z, 9.4, h * 0.045, 9.4, 0, dark);
  g.place(segs, x, podY + h * 0.07, z, 10.5, h * 0.03, 10.5, 0, concrete);
  // Night markers are drawn at every LOD so the hilltop still reads from the overview.
  g.place(segs, x, podY + h * 0.06, z, 10.6, 0.8, 10.6, 0, glow(NEON.neonCyan.hex, 1.2));
  g.place(segs, x, shaftTop, z, 6, 1.5, 6, 0, concrete);
  {
    // Night wash up the shaft: thin lit sleeves, strongest at the foot and fading toward the pod,
    // all below the bloom threshold; a faint warm glow under the pod.
    const wash = 0x5fb8b0;
    const steps = lv === 2 ? 3 : 6;
    for (let i = 0; i < steps; i++) {
      const ya = y0 + h * 0.04 + ((podY - y0 - h * 0.04) * i) / steps;
      const yb = y0 + h * 0.04 + ((podY - y0 - h * 0.04) * (i + 1)) / steps;
      const r = (ya + yb) / 2 < y0 + h * 0.35 ? 4.25 : 3.45;
      g.place(segs, x, ya, z, r, yb - ya, r, 0, glow(wash, 0.5 * (1 - i / steps) + 0.06));
    }
    g.place(segs, x, podY - 0.3, z, 9.8, 0.3, 9.8, 0, glow(0xfff0d8, 0.35));
  }
  // Antenna: two stepped thin masts and the red obstacle light.
  g.place(segs, x, shaftTop + 1.5, z, 1.6, h * 0.16, 1.6, 0, plain(0xb8bab6, 0.6));
  g.place(
    segs,
    x,
    shaftTop + 1.5 + h * 0.16,
    z,
    0.7,
    h - (shaftTop - y0) - 1.5 - h * 0.16,
    0.7,
    0,
    plain(0xb8bab6, 0.6),
  );
  g.place(segs, x, y0 + h * 0.86, z, 1.9, 0.6, 1.9, 0, glow(NEON.neonRed.hex, 1.0));
  g.box(x, y0 + h, z, 1.4, 1.4, 1.4, 0, glow(NEON.neonRed.hex, 1.4));
}

/** Low palace wall with a dark tile coping from a to b; a piece is left out where `gate` says so. */
export function palaceWall(
  g: GeoBuilder,
  a: P2,
  b: P2,
  ground: (x: number, z: number) => number,
  gate: (a: P2, b: P2) => boolean,
  height = 4,
  width = 1.1,
): void {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 0.5) return;
  const n = Math.max(1, Math.ceil(len / 16));
  const rot = Math.atan2(-(b.z - a.z), b.x - a.x);
  const wall = plain(0x5a5650, 0.9);
  const tile = plain(0x1a1d1f, 0.6);
  for (let i = 0; i < n; i++) {
    const at = (k: number): P2 => ({
      x: a.x + ((b.x - a.x) * k) / n,
      z: a.z + ((b.z - a.z) * k) / n,
    });
    const p = at(i + 0.5);
    if (gate(at(i), at(i + 1))) continue;
    const seg = len / n;
    const y0 = ground(p.x, p.z) - 0.6;
    g.box(p.x, y0, p.z, seg + 0.6, height + 0.6, width, rot, wall);
    g.box(p.x, y0 + height + 0.6, p.z, seg + 0.6, 0.5, width + 0.8, rot, tile);
  }
}
