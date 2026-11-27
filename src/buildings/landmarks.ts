// Landmark towers (SEOUL.md 4.5): location and height ratio follow the real skyline; the forms
// are this city's own. Each replaces the spec's tier stack and stays inside its footprint.
import { NEON } from '../core/palette';
import type { BuildingSpec, LandmarkId } from '../city/types';
import type { GeoBuilder, Style, V3 } from './builder';
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
  const legW = W * 0.36;
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

/** Namsan mast (SEOUL.md 4.5): thin three-leg lattice, viewing ring low, glowing ring high. */
export function namsanMast(
  g: GeoBuilder,
  x: number,
  y0: number,
  z: number,
  h: number,
  lv: 1 | 2,
): void {
  const steel = plain(0x2a2e32, 0.5);
  const legR = (t: number): number => 7 * (1 - t) + 1.2 * t;
  const leg = (k: number, t: number): V3 => {
    const a = (k * Math.PI * 2) / 3;
    const r = legR(t);
    return [x + r * Math.cos(a), y0 + t * h, z + r * Math.sin(a)];
  };
  const bays = lv === 2 ? 4 : 14;
  for (let i = 0; i < bays; i++) {
    const t0 = i / bays;
    const t1 = (i + 1) / bays;
    for (let k = 0; k < 3; k++) {
      g.beam(leg(k, t0), leg(k, t1), 0.7, 0.7, [1, 0, 0], steel);
      if (lv === 2) continue;
      g.beam(leg(k, t1), leg((k + 1) % 3, t1), 0.3, 0.3, [0, 1, 0], steel);
      g.beam(leg(k, t0), leg((k + 1) % 3, t1), 0.22, 0.22, [0, 1, 0], steel);
    }
  }
  const ring = (t: number, r: number, hh: number, s: Style): void => {
    const o: Outline = {
      pts: Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return { x: x + r * Math.cos(a), z: z - r * Math.sin(a) };
      }),
      sides: Array.from({ length: 12 }, () => null),
      curved: true,
      cx: x,
      cz: z,
    };
    walls(g, o, y0 + t * h, y0 + t * h + hh, () => s);
    g.cap(o.pts, y0 + t * h + hh, s);
    g.cap(o.pts, y0 + t * h, s, true);
  };
  ring(0.42, 9, 5, plain(0x14181c, 0.4));
  if (lv === 1) ring(0.42 + 2.2 / h, 9.1, 0.6, glow(NEON.neonAmber.hex, 0.9));
  ring(0.8, 4.5, 1.2, glow(NEON.neonCyan.hex, 1.3));
  g.box(x, y0 + h, z, 1.4, 1.4, 1.4, 0, glow(NEON.neonRed.hex, 1.4));
}

/** Low palace wall with a dark tile coping from a to b; open where `gate` (a road) says so. */
export function palaceWall(
  g: GeoBuilder,
  a: P2,
  b: P2,
  ground: (x: number, z: number) => number,
  gate: (x: number, z: number) => boolean,
): void {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 0.5) return;
  const n = Math.max(1, Math.ceil(len / 16));
  const rot = Math.atan2(-(b.z - a.z), b.x - a.x);
  const wall = plain(0x5a5650, 0.9);
  const tile = plain(0x1a1d1f, 0.6);
  for (let i = 0; i < n; i++) {
    const p = { x: a.x + ((b.x - a.x) * (i + 0.5)) / n, z: a.z + ((b.z - a.z) * (i + 0.5)) / n };
    if (gate(p.x, p.z)) continue;
    const seg = len / n;
    const y0 = ground(p.x, p.z) - 0.6;
    g.box(p.x, y0, p.z, seg + 0.6, 4.6, 1.1, rot, wall);
    g.box(p.x, y0 + 4.6, p.z, seg + 0.6, 0.5, 1.9, rot, tile);
  }
}
