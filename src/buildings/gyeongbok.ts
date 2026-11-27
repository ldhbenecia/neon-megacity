// Gyeongbokgung halls by name (SEOUL.md 4.5, user request): silhouette and proportion of each
// hall, not its ornament. Rank reads from size and roof count: main hall > council > quarters.
import type { BuildingSpec } from '../city/types';
import type { GeoBuilder, Style, V3 } from './builder';
import { SEOUL_COLORS, face, frame, hipRoof } from './seoul';
import { glow, plain } from './shapes';

export type PalaceForm =
  | 'main'
  | 'council'
  | 'quarters'
  | 'gate'
  | 'minor'
  | 'gwanghwamun'
  | 'gyeonghoeru'
  | 'hyangwonjeong';

/** Form of a palace building from its layout id (tags.palaceId) and rank (tags.palacePart). */
export function palaceForm(id: string | undefined, part: string | undefined): PalaceForm {
  switch (id) {
    case 'geunjeongjeon':
      return 'main';
    case 'sajeongjeon':
    case 'sujeongjeon':
      return 'council';
    case 'gangnyeongjeon':
    case 'gyotaejeon':
      return 'quarters';
    case 'heungnyemun':
    case 'geunjeongmun':
      return 'gate';
    case 'gwanghwamun':
    case 'gyeonghoeru':
    case 'hyangwonjeong':
      return id;
    default:
      return part === 'hall' ? 'council' : 'minor';
  }
}

/** Forms drawn entirely here: the generic tier shell would put walls where there are none. */
export function isCustomForm(f: PalaceForm): boolean {
  return f === 'gwanghwamun' || f === 'gyeonghoeru' || f === 'hyangwonjeong';
}

const tile = (): Style => plain(SEOUL_COLORS.palaceTile, 0.55);
const ridgeStyle = (): Style => plain(SEOUL_COLORS.ridge, 0.7);
const stone = (): Style => plain(0x7a766c, 0.9);
const column = (): Style => plain(SEOUL_COLORS.column, 0.8);

function rectWalls(
  g: GeoBuilder,
  cx: number,
  cz: number,
  rot: number,
  hw: number,
  hd: number,
  y0: number,
  y1: number,
  s: Style,
): void {
  const P = frame(cx, cz, rot);
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

function columns(
  g: GeoBuilder,
  cx: number,
  cz: number,
  rot: number,
  w: number,
  d: number,
  y0: number,
  h: number,
  spacing: number,
  size: number,
  s: Style,
): void {
  const P = frame(cx, cz, rot);
  const nx = Math.max(1, Math.round(w / spacing));
  const nz = Math.max(1, Math.round(d / spacing));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      if (i !== 0 && i !== nx && j !== 0 && j !== nz) continue;
      const p = P(-w / 2 + (w * i) / nx, y0, -d / 2 + (d * j) / nz);
      g.box(p[0], y0, p[2], size, h, size, rot, s);
    }
  }
}

/**
 * Halls and gates on a plinth (tier 0) with a body (tier 1). `main` and `gate` carry an upper
 * storey under a second roof; `quarters` have no ridge line (the royal quarters' roofs).
 */
export function palaceBody(
  g: GeoBuilder,
  spec: BuildingSpec,
  form: PalaceForm,
  lv: 0 | 1 | 2,
): void {
  const plinth = spec.tiers[0];
  const hall = spec.tiers[1];
  if (!plinth || !hall) return;
  const P = frame(hall.x, hall.z, spec.rotY);
  const hw = hall.w / 2;
  const hd = hall.d / 2;
  const hallH = hall.y1 - hall.y0;
  const eave = Math.min(3.2, (plinth.w - hall.w) / 2 + 1.5);
  const lift = Math.min(1.3, eave * 0.45);
  const ridge = form === 'quarters' ? undefined : ridgeStyle();
  const twoRoofs = form === 'main' || form === 'gate';
  const rise = Math.min(hd, hw) * (form === 'main' ? 0.6 : 0.5);
  if (!twoRoofs) {
    hipRoof(g, P, hw + eave, hd + eave, hall.y1, rise, tile(), lift, ridge);
  } else {
    hipRoof(g, P, hw + eave, hd + eave, hall.y1, rise * 0.3, tile(), lift, ridge);
    const upper = hallH * (form === 'main' ? 0.6 : 0.4);
    const k = form === 'main' ? 0.82 : 0.75;
    if (lv < 2) {
      rectWalls(
        g,
        hall.x,
        hall.z,
        spec.rotY,
        hw * k,
        hd * k,
        hall.y1,
        hall.y1 + upper,
        plain(SEOUL_COLORS.wood, 0.9),
      );
      rectWalls(
        g,
        hall.x,
        hall.z,
        spec.rotY,
        hw * k + 0.04,
        hd * k + 0.04,
        hall.y1 + upper - 0.7,
        hall.y1 + upper,
        plain(SEOUL_COLORS.dancheong, 0.7),
      );
    }
    hipRoof(
      g,
      P,
      hw * k + eave * 0.85,
      hd * k + eave * 0.85,
      hall.y1 + upper,
      rise,
      tile(),
      lift,
      ridge,
    );
  }
  if (lv === 2) return;
  rectWalls(
    g,
    hall.x,
    hall.z,
    spec.rotY,
    hw + 0.05,
    hd + 0.05,
    hall.y1 - 0.9,
    hall.y1,
    plain(SEOUL_COLORS.dancheong, 0.7),
  );
  if (lv === 0) {
    rectWalls(
      g,
      hall.x,
      hall.z,
      spec.rotY,
      hw + 0.08,
      hd + 0.08,
      hall.y1 - 1.25,
      hall.y1 - 0.95,
      glow(SEOUL_COLORS.uplight, 0.45),
    );
  }
  columns(
    g,
    hall.x,
    hall.z,
    spec.rotY,
    hall.w + 2.4,
    hall.d + 2.4,
    hall.y0,
    hallH,
    3.6,
    0.55,
    column(),
  );
}

/** Gwanghwamun: high stone base with three arched openings, a two-roof gate tower on top. */
function gwanghwamun(g: GeoBuilder, spec: BuildingSpec, lv: 0 | 1 | 2): void {
  const y0 = spec.baseY;
  const W = spec.w;
  const D = spec.d;
  const baseH = spec.h * 0.42;
  g.box(spec.x, y0, spec.z, W, baseH, D, spec.rotY, stone(), true);
  const P = frame(spec.x, spec.z, spec.rotY);
  if (lv < 2) {
    // Dark arch openings on both long faces; the centre one (the king's) is wider.
    const dark = plain(0x0a0b0c, 0.9);
    for (const sgn of [-1, 1]) {
      const z = sgn * (D / 2 + 0.05);
      for (const [cx, hw] of [
        [0, W * 0.08],
        [-W * 0.22, W * 0.055],
        [W * 0.22, W * 0.055],
      ] as const) {
        const top = y0 + baseH * (hw > W * 0.06 ? 0.7 : 0.6);
        const spring = top - hw;
        const pts: V3[] = [
          P(cx - hw, y0, z),
          P(cx + hw, y0, z),
          P(cx + hw, spring, z),
          P(cx + hw * 0.7, spring + hw * 0.7, z),
          P(cx, top, z),
          P(cx - hw * 0.7, spring + hw * 0.7, z),
          P(cx - hw, spring, z),
        ];
        face(g, pts, dark, P(cx, spring, 0));
      }
    }
  }
  const towerW = W * 0.6;
  const towerD = D * 0.62;
  const yT = y0 + baseH;
  const bodyH = spec.h * 0.2;
  rectWalls(
    g,
    spec.x,
    spec.z,
    spec.rotY,
    towerW / 2,
    towerD / 2,
    yT,
    yT + bodyH,
    plain(SEOUL_COLORS.wood, 0.9),
  );
  if (lv < 2)
    columns(
      g,
      spec.x,
      spec.z,
      spec.rotY,
      towerW + 1.6,
      towerD + 1.6,
      yT,
      bodyH,
      3.4,
      0.5,
      column(),
    );
  const rise = Math.min(towerW, towerD) * 0.45;
  hipRoof(
    g,
    P,
    towerW / 2 + 2.6,
    towerD / 2 + 2.6,
    yT + bodyH,
    rise * 0.3,
    tile(),
    1,
    ridgeStyle(),
  );
  const upper = spec.h * 0.15;
  rectWalls(
    g,
    spec.x,
    spec.z,
    spec.rotY,
    towerW * 0.38,
    towerD * 0.38,
    yT + bodyH,
    yT + bodyH + upper,
    plain(SEOUL_COLORS.wood, 0.9),
  );
  hipRoof(
    g,
    P,
    towerW * 0.38 + 2.2,
    towerD * 0.38 + 2.2,
    yT + bodyH + upper,
    rise,
    tile(),
    1,
    ridgeStyle(),
  );
  if (lv === 0)
    g.box(
      spec.x,
      yT + bodyH - 1.2,
      spec.z,
      towerW + 0.2,
      0.3,
      towerD + 0.2,
      spec.rotY,
      glow(SEOUL_COLORS.uplight, 0.45),
    );
}

/** Gyeonghoeru: an open ground floor of 48 stone pillars carrying the hall and a wide roof. */
function gyeonghoeru(g: GeoBuilder, spec: BuildingSpec, lv: 0 | 1 | 2): void {
  const y0 = spec.baseY;
  const W = spec.w;
  const D = spec.d;
  const floorY = y0 + spec.h * 0.42;
  const P = frame(spec.x, spec.z, spec.rotY);
  const nx = lv === 2 ? 2 : 7;
  const nz = lv === 2 ? 2 : 5;
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const p = P(-W / 2 + (W * i) / nx, y0, -D / 2 + (D * j) / nz);
      const outer = i === 0 || i === nx || j === 0 || j === nz;
      g.box(p[0], y0, p[2], outer ? 1.1 : 0.9, floorY - y0, outer ? 1.1 : 0.9, spec.rotY, stone());
    }
  }
  g.box(spec.x, floorY, spec.z, W + 1, 0.8, D + 1, spec.rotY, plain(SEOUL_COLORS.wood, 0.85), true);
  const yU = floorY + 0.8;
  const top = y0 + spec.h;
  if (lv < 2) {
    columns(g, spec.x, spec.z, spec.rotY, W, D, yU, top - yU, 3.2, 0.5, column());
    rectWalls(
      g,
      spec.x,
      spec.z,
      spec.rotY,
      W / 2,
      D / 2,
      yU,
      yU + 1,
      plain(SEOUL_COLORS.wood, 0.9),
    );
    rectWalls(
      g,
      spec.x,
      spec.z,
      spec.rotY,
      W / 2 + 0.05,
      D / 2 + 0.05,
      top - 0.9,
      top,
      plain(SEOUL_COLORS.dancheong, 0.7),
    );
  }
  rectWalls(
    g,
    spec.x,
    spec.z,
    spec.rotY,
    W * 0.36,
    D * 0.3,
    yU,
    top,
    plain(SEOUL_COLORS.wood, 0.9),
  );
  hipRoof(g, P, W / 2 + 3.2, D / 2 + 3.2, top, Math.min(W, D) * 0.33, tile(), 1.4, ridgeStyle());
  if (lv === 0) {
    g.box(
      spec.x,
      top - 1.3,
      spec.z,
      W + 0.3,
      0.3,
      D + 0.3,
      spec.rotY,
      glow(SEOUL_COLORS.uplight, 0.45),
    );
  }
}

function hexPoints(cx: number, cz: number, r: number, y: number, lift = 0): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    out.push([cx + r * Math.cos(a), y + lift, cz - r * Math.sin(a)]);
  }
  return out;
}

/** Hexagonal hip roof from radius r at y up to an apex, eave corners lifted. */
function hexRoof(
  g: GeoBuilder,
  cx: number,
  cz: number,
  r: number,
  y: number,
  rise: number,
  lift: number,
  s: Style,
  inner = 0,
): void {
  const outer = hexPoints(cx, cz, r, y, lift);
  const top = inner > 0 ? hexPoints(cx, cz, inner, y + rise) : null;
  const apex: V3 = [cx, y + rise, cz];
  const inside: V3 = [cx, y + rise * 0.3, cz];
  for (let i = 0; i < 6; i++) {
    const a = outer[i] as V3;
    const b = outer[(i + 1) % 6] as V3;
    if (top) face(g, [a, b, top[(i + 1) % 6] as V3, top[i] as V3], s, inside);
    else face(g, [a, b, apex], s, inside);
  }
  face(g, [...outer].reverse(), s, [cx, y + lift + 1, cz]);
}

/** Hyangwonjeong: a small two-storey hexagonal pavilion. */
function hyangwonjeong(g: GeoBuilder, spec: BuildingSpec, lv: 0 | 1 | 2): void {
  const y0 = spec.baseY;
  const r = spec.w / 2;
  const cx = spec.x;
  const cz = spec.z;
  const y1 = y0 + spec.h * 0.45;
  const y2 = y0 + spec.h * 0.8;
  const posts = hexPoints(cx, cz, r * 0.85, y0);
  if (lv < 2) for (const p of posts) g.box(p[0], y0, p[2], 0.35, y1 - y0, 0.35, 0, column());
  hexRoof(g, cx, cz, r + 1, y1, (y2 - y1) * 0.45, 0.4, tile(), r * 0.6);
  const upper = hexPoints(cx, cz, r * 0.6, y1);
  const inside: V3 = [cx, (y1 + y2) / 2, cz];
  const wood = plain(SEOUL_COLORS.wood, 0.9);
  for (let i = 0; i < 6; i++) {
    const a = upper[i] as V3;
    const b = upper[(i + 1) % 6] as V3;
    face(g, [a, b, [b[0], y2, b[2]], [a[0], y2, a[2]]], wood, inside);
  }
  hexRoof(g, cx, cz, r * 0.6 + 1, y2, spec.h - (y2 - y0), 0.4, tile());
  if (lv === 0) g.box(cx, y1 - 0.5, cz, r * 1.4, 0.2, r * 1.4, 0, glow(SEOUL_COLORS.uplight, 0.35));
}

/** Draws a custom-form palace building at one LOD. */
export function emitPalaceCustom(
  g: GeoBuilder,
  spec: BuildingSpec,
  form: PalaceForm,
  lv: 0 | 1 | 2,
): void {
  if (form === 'gwanghwamun') gwanghwamun(g, spec, lv);
  else if (form === 'gyeonghoeru') gyeonghoeru(g, spec, lv);
  else if (form === 'hyangwonjeong') hyangwonjeong(g, spec, lv);
}
