import * as THREE from 'three';
import type { Side, Tier } from '../city/types';
import type { GeoBuilder, Style } from './builder';
import { FACADE, type FacadeType } from './params';

export interface P2 {
  x: number;
  z: number;
}

export function toWorldP(cx: number, cz: number, rotY: number, lx: number, lz: number): P2 {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  return { x: cx + c * lx + s * lz, z: cz - s * lx + c * lz };
}

// Wall outlines must be negative here (see GeoBuilder.wall).
export function shoelace(pts: readonly P2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as P2;
    const b = pts[(i + 1) % pts.length] as P2;
    s += a.x * b.z - b.x * a.z;
  }
  return s;
}

export interface Outline {
  pts: P2[];
  sides: (Side | null)[];
  curved: boolean;
  cx: number;
  cz: number;
}

export function rectOutline(
  cx: number,
  cz: number,
  w: number,
  d: number,
  rotY: number,
  chamfer = 0,
): Outline {
  const hw = w / 2;
  const hd = d / 2;
  const c = Math.min(chamfer, hw * 0.45, hd * 0.45);
  const local: [number, number][] =
    c > 0.05
      ? [
          [-hw + c, hd],
          [hw - c, hd],
          [hw, hd - c],
          [hw, -hd + c],
          [hw - c, -hd],
          [-hw + c, -hd],
          [-hw, -hd + c],
          [-hw, hd - c],
        ]
      : [
          [-hw, hd],
          [hw, hd],
          [hw, -hd],
          [-hw, -hd],
        ];
  const sides: (Side | null)[] =
    c > 0.05 ? ['pz', null, 'px', null, 'nz', null, 'nx', null] : ['pz', 'px', 'nz', 'nx'];
  return {
    pts: local.map(([x, z]) => toWorldP(cx, cz, rotY, x, z)),
    sides,
    curved: false,
    cx,
    cz,
  };
}

export function circleOutline(cx: number, cz: number, r: number, segs: number): Outline {
  const pts: P2[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    pts.push({ x: cx + r * Math.cos(a), z: cz - r * Math.sin(a) });
  }
  return { pts, sides: pts.map(() => null), curved: true, cx, cz };
}

export function tierOutline(t: Tier, rotY: number, segs: number): Outline {
  if (t.shape === 'cylinder') return circleOutline(t.x, t.z, t.w / 2, segs);
  return rectOutline(t.x, t.z, t.w, t.d, rotY, t.shape === 'chamfer' ? t.chamfer : 0);
}

export function offsetOutline(o: Outline, d: number): Outline {
  const n = o.pts.length;
  const pts: P2[] = [];
  for (let i = 0; i < n; i++) {
    const p = o.pts[i] as P2;
    const a = o.pts[(i - 1 + n) % n] as P2;
    const b = o.pts[(i + 1) % n] as P2;
    const n1 = edgeNormal(a, p);
    const n2 = edgeNormal(p, b);
    const k = d / Math.max(0.2, 1 + n1.x * n2.x + n1.z * n2.z);
    pts.push({ x: p.x + (n1.x + n2.x) * k, z: p.z + (n1.z + n2.z) * k });
  }
  return { ...o, pts };
}

export function edgeNormal(a: P2, b: P2): P2 {
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: -(b.z - a.z) / len, z: (b.x - a.x) / len };
}

export function edgeLength(o: Outline, i: number): number {
  const a = o.pts[i] as P2;
  const b = o.pts[(i + 1) % o.pts.length] as P2;
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export function perimeter(o: Outline): number {
  let s = 0;
  for (let i = 0; i < o.pts.length; i++) s += edgeLength(o, i);
  return s;
}

export function walls(
  g: GeoBuilder,
  o: Outline,
  y0: number,
  y1: number,
  styleFor: (edge: number, len: number) => Style,
): void {
  const n = o.pts.length;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const a = o.pts[i] as P2;
    const b = o.pts[(i + 1) % n] as P2;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const s = styleFor(i, len);
    if (o.curved) {
      const ra = Math.hypot(a.x - o.cx, a.z - o.cz) || 1;
      const rb = Math.hypot(b.x - o.cx, b.z - o.cz) || 1;
      g.wall(
        a.x,
        a.z,
        b.x,
        b.z,
        y0,
        y1,
        u,
        s,
        [(a.x - o.cx) / ra, 0, (a.z - o.cz) / ra],
        [(b.x - o.cx) / rb, 0, (b.z - o.cz) / rb],
      );
      u += len;
    } else {
      g.wall(a.x, a.z, b.x, b.z, y0, y1, 0, s);
    }
  }
}

export function ring(
  g: GeoBuilder,
  inner: Outline,
  outer: Outline,
  y: number,
  s: Style,
  down = false,
): void {
  const n = inner.pts.length;
  const N: [number, number, number] = down ? [0, -1, 0] : [0, 1, 0];
  for (let i = 0; i < n; i++) {
    const a = inner.pts[i] as P2;
    const b = outer.pts[i] as P2;
    const c = outer.pts[(i + 1) % n] as P2;
    const d = inner.pts[(i + 1) % n] as P2;
    if (down) {
      g.quad([a.x, y, a.z], [d.x, y, d.z], [c.x, y, c.z], [b.x, y, b.z], N, [0, 0, 0, 0], s);
    } else {
      g.quad([a.x, y, a.z], [b.x, y, b.z], [c.x, y, c.z], [d.x, y, d.z], N, [0, 0, 0, 0], s);
    }
  }
}

export function band(g: GeoBuilder, o: Outline, y: number, h: number, out: number, s: Style): void {
  const outer = offsetOutline(o, out);
  walls(g, outer, y, y + h, () => s);
  ring(g, o, outer, y + h, s);
  ring(g, o, outer, y, s, true);
}

export function parapet(g: GeoBuilder, o: Outline, y: number, h: number, s: Style): void {
  const inner = offsetOutline(o, -0.25);
  walls(g, o, y, y + h, () => s);
  const rev: Outline = { ...inner, curved: false, pts: [...inner.pts].reverse() };
  walls(g, rev, y, y + h, () => s);
  ring(g, inner, o, y + h, s);
}

const tmpColor = new THREE.Color();

export interface StyleOpts {
  cellW?: number;
  cellH?: number;
  winW?: number;
  winH?: number;
  windowY?: number;
  seed?: number;
  lit?: number;
  param?: number;
  storefront?: boolean;
}

export function style(type: FacadeType, hex: number, o: StyleOpts = {}): Style {
  tmpColor.setHex(hex);
  return {
    type,
    color: tmpColor.clone(),
    cellW: o.cellW ?? 3,
    cellH: o.cellH ?? 3,
    winW: o.winW ?? 0,
    winH: o.winH ?? 0,
    windowY: o.windowY ?? 0,
    seed: o.seed ?? 0,
    lit: o.lit ?? 1,
    param: o.param ?? 0,
    storefront: o.storefront ?? false,
  };
}

export const plain = (hex: number, rough = 0.85): Style =>
  style(FACADE.plain, hex, { param: rough });
export const glow = (hex: number, hdr: number, shop = false): Style =>
  style(FACADE.emissive, hex, { param: hdr, storefront: shop });
