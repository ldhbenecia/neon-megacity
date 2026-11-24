import { createRng, type Rng } from '../core/random';
import { MATERIAL, NEON } from '../core/palette';
import { baseKind, terrainHeight } from '../city/layout';
import type { BuildingSpec, Side, Tier } from '../city/types';
import {
  UNIT_CONE8,
  UNIT_CYL12,
  UNIT_CYL8,
  UNIT_SPIRE,
  type GeoBuilder,
  type Style,
  type V3,
} from './builder';
import {
  FACADE,
  bandLevels,
  braceLevels,
  columnOffsets,
  cylinderSegments,
  districtLitFactor,
  faceRole,
  finOffsets,
  fitCells,
  seeded01,
  keepInLod2,
  mixHex,
  OPPOSITE,
  scaleHex,
  windowStyle,
  baseArchetype,
  withBaseArchetype,
  type BaseSpec,
} from './params';
import {
  band,
  edgeNormal,
  glow,
  offsetOutline,
  parapet,
  perimeter,
  plain,
  rectOutline,
  style,
  tierOutline,
  toWorldP,
  walls,
  type Outline,
  type P2,
} from './shapes';
import { NullBuilder } from './lod';

export interface Targets {
  l0: GeoBuilder;
  l1: GeoBuilder;
  l2: GeoBuilder;
}

const TOWERS = new Set([
  'setbackTower',
  'cylinderTower',
  'bracedTower',
  'cantileverTower',
  'twinTower',
]);

interface Bld {
  spec: BaseSpec;
  rng: Rng;
  seed01: number;
  lit: number;
  wall: number;
  roof: number;
  windowY: number;
  inL2: boolean;
  tower: boolean;
  mega: boolean;
  shopSides: Set<Side>;
}

export type StreetTest = (x: number, z: number) => boolean;

const SHOP_ARCHETYPES = new Set(['sangga', 'officeSlab', 'pavilion']);
const ALL_SIDES: readonly Side[] = ['px', 'nx', 'pz', 'nz'];

const tierStacks = (spec: BuildingSpec): Tier[][] =>
  spec.twin ? [spec.tiers, spec.twin] : [spec.tiers];

// `raw` is the layout archetype: fallback forms must not inherit pavilion's forced shop front.
function shopSides(spec: BaseSpec, raw: string, onStreet?: StreetTest): Set<Side> {
  const out = new Set<Side>();
  if (!spec.tags.storefront && raw !== 'pavilion') return out;
  out.add(spec.front);
  if (!onStreet || !SHOP_ARCHETYPES.has(spec.archetype)) return out;
  for (const side of ALL_SIDES) {
    const alongX = side === 'px' || side === 'nx';
    const sgn = side === 'px' || side === 'pz' ? 1 : -1;
    const off = (alongX ? spec.w : spec.d) / 2 + 3;
    const p = alongX
      ? toWorldP(spec.x, spec.z, spec.rotY, sgn * off, 0)
      : toWorldP(spec.x, spec.z, spec.rotY, 0, sgn * off);
    if (onStreet(p.x, p.z)) out.add(side);
  }
  return out;
}

function facadeHex(spec: BuildingSpec, rng: Rng): number {
  const t = rng.next();
  switch (spec.archetype) {
    case 'apartmentSlab':
      return mixHex(MATERIAL.facadeLight, 0x6b6e6c, 0.35 + 0.3 * t);
    case 'hillHouse':
      return mixHex(
        MATERIAL.facadeLight,
        rng.pick([0x5a4a40, 0x4e5450, 0x5c5850, 0x3f4a4c]),
        0.4 + 0.4 * t,
      );
    case 'sangga':
      return mixHex(
        MATERIAL.facadeDark,
        rng.pick([0x3a3430, 0x34383a, 0x40383a, 0x2e3436]),
        0.4 + 0.6 * t,
      );
    case 'warehouse':
      return mixHex(MATERIAL.facadeLight, rng.pick([0x3c4a50, 0x504a3e, 0x3a3f42]), 0.5 * t + 0.3);
    default:
      return mixHex(MATERIAL.facadeDark, MATERIAL.facadeLight, t);
  }
}

function faceStyle(b: Bld, side: Side | null, len: number, tierIdx: number): Style {
  const { spec } = b;
  const baseRole = side ? faceRole(spec, side) : 'side';
  const shop = side !== null && b.shopSides.has(side);
  const role = shop && baseRole === 'side' ? 'front' : baseRole;
  const ws = windowStyle(spec.archetype, role, spec.seed);
  if (ws.type === FACADE.plain || (side === null && len < 4)) {
    return plain(b.wall, 0.85);
  }
  const fit = fitCells(len, ws.cellW);
  return style(ws.type, b.wall, {
    cellW: fit.cellW,
    cellH: spec.archetype === 'warehouse' ? spec.h : spec.floorH,
    winW: ws.winW,
    winH: ws.winH,
    windowY: b.windowY,
    seed: b.seed01 + tierIdx * 0.013 + (side ? ALL_SIDES.indexOf(side) * 0.1 : 0),
    lit: b.lit,
    param: spec.archetype === 'hillHouse' ? 0.55 : 0,
    storefront: tierIdx === 0 && (b.tower || shop),
  });
}

// Cells are fitted to the LOD0 outline at every LOD so cell ids (and lit hashes) survive LOD swaps.
function cylStyle(b: Bld, t: Tier, tierIdx: number): Style {
  const fit = fitCells(perimeter(tierOutline(t, b.spec.rotY, cylinderSegments(0))), 1.5);
  return style(FACADE.curtain, b.wall, {
    cellW: fit.cellW,
    cellH: b.spec.floorH,
    winW: fit.cellW - 0.1,
    winH: 2.4,
    windowY: b.windowY,
    seed: b.seed01 + tierIdx * 0.013,
    lit: b.lit,
    storefront: tierIdx === 0,
  });
}

function shell(
  g: GeoBuilder,
  b: Bld,
  t: Tier,
  o: Outline,
  tierIdx: number,
  plinthTop = t.y0,
): void {
  const cyl = t.shape === 'cylinder';
  const cs = cyl ? cylStyle(b, t, tierIdx) : null;
  const top = t.y1;
  if (plinthTop > t.y0 + 0.05) {
    const wallStyle = plain(MATERIAL.retainingWall, 0.9);
    walls(g, offsetOutline(o, 0.05), t.y0, Math.min(plinthTop, top), () => wallStyle);
  }
  walls(
    g,
    o,
    Math.max(t.y0, Math.min(plinthTop, top - 0.5)),
    top,
    (i, len) => cs ?? faceStyle(b, o.sides[i] ?? null, len, tierIdx),
  );
  g.cap(o.pts, top, plain(b.roof, 0.92));
}

// Coloured, just above the palette bloom threshold: white crowns burned out the skyline.
function crownStyle(b: Bld): Style {
  const pick = seeded01(b.spec.seed + 7);
  const hex =
    pick < 0.5 ? NEON.neonCyan.hex : pick < 0.8 ? NEON.neonAmber.hex : NEON.neonOrange.hex;
  return glow(hex, 1.3 + 0.3 * seeded01(b.spec.seed + 8));
}

export function emitBuilding(raw: BuildingSpec, T: Targets, onStreet?: StreetTest): void {
  const spec = withBaseArchetype(raw);
  const rng = createRng(spec.seed);
  const wall = facadeHex(spec, rng);
  const b: Bld = {
    spec,
    rng,
    seed01: seeded01(spec.seed),
    lit: districtLitFactor(spec.district),
    wall,
    roof: scaleHex(wall, spec.archetype === 'apartmentSlab' ? 0.7 : 0.9),
    windowY: spec.baseY + spec.groundFloorH,
    inL2: keepInLod2(spec),
    tower: TOWERS.has(spec.archetype),
    mega: spec.h >= 200,
    shopSides: shopSides(spec, raw.archetype, onStreet),
  };
  // Discarded levels are skipped. Only LOD0 detail draws from `rng` after facadeHex, so the far
  // and near passes consume it identically.
  const levels: [GeoBuilder, 0 | 1 | 2][] = [
    [T.l0, 0],
    [T.l1, 1],
  ];
  if (spec.archetype === 'hillHouse') return hillHouse(b, T);
  if (b.inL2) levels.push([T.l2, 2]);
  else if (!discards(T.l2)) lowBox(b, T.l2);

  const roofKind = roofTopKind(spec);

  const stacks = tierStacks(spec);
  for (const [g, lv] of levels) {
    if (discards(g)) continue;
    for (const tiers of stacks) {
      tiers.forEach((t, i) => {
        const o = tierOutline(t, spec.rotY, cylinderSegments(lv));
        const outline =
          lv === 2 && t.shape === 'chamfer' ? rectOutline(t.x, t.z, t.w, t.d, spec.rotY) : o;
        shell(g, b, t, outline, i);
      });
      const topTier = tiers[tiers.length - 1];
      if (topTier && b.mega) {
        const o = tierOutline(topTier, spec.rotY, lv === 0 ? 48 : 16);
        band(g, o, topTier.y1 - 2.6, 1.2, 0.35, crownStyle(b));
      }
    }
    if (spec.spireH > 0) spire(g, b);
    if (roofKind === 'wedge') wedgeRoof(g, b);
    if (roofKind === 'lattice' && (lv !== 2 || b.mega)) latticeCrown(g, b, lv);
    if (lv !== 2) {
      if (spec.archetype === 'bracedTower') bracing(g, b, lv);
      if (spec.cantilever) cantilever(g, b);
      if (spec.skybridge && spec.twin) skybridge(g, b);
    }
    if (lv === 1 && spec.archetype === 'warehouse') warehouseRoof(g, b);
  }
  if (!discards(T.l0)) detail(b, T.l0);
}

const discards = (g: GeoBuilder): boolean => g instanceof NullBuilder;

function detail(b: Bld, g: GeoBuilder): void {
  const { spec, rng } = b;
  const stacks = tierStacks(spec);
  const parapetH =
    spec.archetype === 'sangga' ? 1.0 : spec.archetype === 'apartmentSlab' ? 1.5 : 1.2;
  const bandStyle = plain(scaleHex(b.wall, 1.35), 0.7);
  for (const tiers of stacks) {
    tiers.forEach((t, i) => {
      const o = tierOutline(t, spec.rotY, cylinderSegments(0));
      if (spec.archetype !== 'warehouse' && spec.archetype !== 'pavilion') {
        parapet(g, o, t.y1, parapetH, plain(scaleHex(b.wall, 1.15), 0.85));
      }
      if (b.tower || spec.archetype === 'officeSlab') {
        const every = 4 + Math.floor(seeded01(spec.seed + i) * 5);
        for (const y of bandLevels(t.y0, t.y1, b.windowY, spec.floorH, every)) {
          band(g, o, y - 0.25, 0.5, 0.4, bandStyle);
        }
      }
      if (i === 0 && b.tower && t.shape !== 'cylinder') {
        band(g, o, t.y0 + spec.groundFloorH - 0.6, 0.6, 0.6, bandStyle);
      }
    });
  }
  // Rooftop plant sits on a flat y1 and would poke through the sloped wedge glazing.
  const flatRoof = roofTopKind(spec) !== 'wedge';
  switch (spec.archetype) {
    case 'officeSlab':
      fins(g, b);
      if (flatRoof) roofMechanical(g, b, rng);
      break;
    case 'setbackTower':
    case 'cylinderTower':
    case 'bracedTower':
    case 'cantileverTower':
    case 'twinTower':
      if (flatRoof) roofMechanical(g, b, rng);
      if (spec.archetype === 'cylinderTower') helipad(g, b);
      break;
    case 'sangga':
      sanggaProps(g, b, rng);
      break;
    case 'apartmentSlab':
      apartment(g, b, rng);
      break;
    case 'warehouse':
      warehouseRoof(g, b);
      warehouseProps(g, b, rng);
      break;
    default:
      break;
  }
  for (const side of b.shopSides) storefront(g, b, rng, side);
}

function spire(g: GeoBuilder, b: Bld): void {
  const { spec } = b;
  const top = spec.tiers[spec.tiers.length - 1];
  if (!top) return;
  const r = Math.min(top.w, top.d) * 0.14;
  g.place(
    UNIT_SPIRE,
    top.x,
    top.y1,
    top.z,
    r,
    spec.spireH,
    r,
    spec.rotY,
    plain(scaleHex(b.wall, 1.2), 0.4),
  );
  g.box(
    top.x,
    top.y1 + spec.spireH - 1.2,
    top.z,
    0.9,
    1.2,
    0.9,
    spec.rotY,
    glow(NEON.neonRed.hex, 2.5),
  );
}

function bracing(g: GeoBuilder, b: Bld, lv: 0 | 1): void {
  const { spec } = b;
  const steel = plain(MATERIAL.bracing, 0.45);
  const lit =
    seeded01(spec.seed + 3) < 0.3
      ? glow(seeded01(spec.seed + 5) < 0.5 ? NEON.neonCyan.hex : NEON.neonOrange.hex, 3)
      : null;
  const size = 0.8;
  for (const t of spec.tiers) {
    const off = 0.8 + size / 2;
    const ys = braceLevels(t.y0 + spec.groundFloorH, t.y1);
    for (const side of ['pz', 'px', 'nz', 'nx'] as Side[]) {
      const alongX = side === 'pz' || side === 'nz';
      const half = alongX ? t.d / 2 : t.w / 2;
      const width = alongX ? t.w : t.d;
      const sgn = side === 'pz' || side === 'px' ? 1 : -1;
      const pt = (along: number, y: number): V3 => {
        const p = alongX
          ? toWorldP(t.x, t.z, spec.rotY, along, sgn * (half + off))
          : toWorldP(t.x, t.z, spec.rotY, sgn * (half + off), along);
        return [p.x, y, p.z];
      };
      const nrm = toWorldP(0, 0, spec.rotY, alongX ? 0 : sgn, alongX ? sgn : 0);
      const n3: V3 = [nrm.x, 0, nrm.z];
      const cols = columnOffsets(width + 2 * off, 24);
      for (const c of cols) g.beam(pt(c, t.y0), pt(c, t.y1), size, size, n3, steel);
      for (const y of ys)
        g.beam(pt(cols[0] ?? 0, y), pt(cols[cols.length - 1] ?? 0, y), size, size * 0.8, n3, steel);
      for (let k = 0; k < ys.length - 1; k++) {
        const ya = ys[k] ?? 0;
        const yb = ys[k + 1] ?? 0;
        for (let c = 0; c < cols.length - 1; c++) {
          const ca = cols[c] ?? 0;
          const cb = cols[c + 1] ?? 0;
          g.beam(pt(ca, ya), pt(cb, yb), size * 0.8, size * 0.8, n3, steel);
          g.beam(pt(cb, ya), pt(ca, yb), size * 0.8, size * 0.8, n3, steel);
          if (lit && lv === 0) {
            const o = 0.5;
            const pa = pt(ca, ya);
            const pb = pt(cb, yb);
            g.beam(
              [pa[0] + n3[0] * o, pa[1], pa[2] + n3[2] * o],
              [pb[0] + n3[0] * o, pb[1], pb[2] + n3[2] * o],
              0.18,
              0.18,
              n3,
              lit,
            );
          }
        }
      }
      if (lit && lv === 1) {
        for (const c of [cols[0] ?? 0, cols[cols.length - 1] ?? 0]) {
          const p = pt(c, 0);
          g.beam(
            [p[0] + n3[0] * 0.5, t.y0 + spec.groundFloorH, p[2] + n3[2] * 0.5],
            [p[0] + n3[0] * 0.5, t.y1, p[2] + n3[2] * 0.5],
            0.25,
            0.25,
            n3,
            lit,
          );
        }
      }
    }
  }
}

function cantilever(g: GeoBuilder, b: Bld): void {
  const { spec } = b;
  const c = spec.cantilever;
  const body = spec.tiers[1];
  if (!c || !body) return;
  const alongX = c.side === 'pz' || c.side === 'nz';
  const half = alongX ? body.d / 2 : body.w / 2;
  const sgn = c.side === 'pz' || c.side === 'px' ? 1 : -1;
  const depth = c.out + 2;
  const centerOff = sgn * (half - 2 + depth / 2);
  const ctr = alongX
    ? toWorldP(body.x, body.z, spec.rotY, 0, centerOff)
    : toWorldP(body.x, body.z, spec.rotY, centerOff, 0);
  const w = alongX ? c.width : depth;
  const d = alongX ? depth : c.width;
  const o = rectOutline(ctr.x, ctr.z, w, d, spec.rotY);
  const t: Tier = { x: ctr.x, z: ctr.z, w, d, y0: c.y0, y1: c.y1, shape: 'box', chamfer: 0 };
  shell(g, b, t, o, 1);
  g.cap(offsetOutline(o, -0.3).pts, c.y0 - 0.02, glow(NEON.windowWarm.hex, 1.5), true);
}

function skybridge(g: GeoBuilder, b: Bld): void {
  const { spec } = b;
  const sb = spec.skybridge;
  const a = spec.tiers[0];
  const c = spec.twin?.[0];
  if (!sb || !a || !c) return;
  const lenX = Math.max(0, Math.hypot(c.x - a.x, c.z - a.z) - a.w / 2 - c.w / 2) + 1;
  const mid = { x: (a.x + c.x) / 2, z: (a.z + c.z) / 2 };
  const o = rectOutline(mid.x, mid.z, lenX, sb.width, spec.rotY);
  walls(g, o, sb.y0, sb.y1, () => glow(NEON.neonCyan.hex, 1.4));
  g.cap(o.pts, sb.y1, plain(b.roof));
  g.cap(o.pts, sb.y0, plain(b.roof), true);
}

function fins(g: GeoBuilder, b: Bld): void {
  const { spec } = b;
  const t = spec.tiers[0];
  if (!t || t.shape === 'chamfer') return;
  const spacing = 1.5 + seeded01(spec.seed + 11) * 1.5;
  const depth = 0.5 + seeded01(spec.seed + 13) * 0.5;
  const finStyle = plain(scaleHex(b.wall, 1.25), 0.6);
  const longX = t.w >= t.d;
  for (const sgn of [1, -1]) {
    const width = longX ? t.w : t.d;
    for (const off of finOffsets(width, spacing)) {
      const lx = longX ? off : sgn * (t.w / 2 + depth / 2);
      const lz = longX ? sgn * (t.d / 2 + depth / 2) : off;
      const p = toWorldP(t.x, t.z, spec.rotY, lx, lz);
      g.box(
        p.x,
        b.windowY,
        p.z,
        longX ? 0.3 : depth,
        t.y1 - b.windowY,
        longX ? depth : 0.3,
        spec.rotY,
        finStyle,
      );
    }
  }
}

function roofMechanical(g: GeoBuilder, b: Bld, rng: Rng): void {
  const { spec } = b;
  const stacks = tierStacks(spec);
  const dark = plain(scaleHex(b.roof, 0.8), 0.7);
  const metal = plain(0x2e3236, 0.5);
  for (const tiers of stacks) {
    const t = tiers[tiers.length - 1];
    if (!t) continue;
    const y = t.y1;
    const r = Math.min(t.w, t.d);
    if (t.shape === 'cylinder') continue;
    const pw = t.w * rng.range(0.35, 0.6);
    const pd = t.d * rng.range(0.35, 0.6);
    g.box(t.x, y, t.z, pw, rng.range(3, 6), pd, spec.rotY, dark);
    const n = rng.int(2, 6);
    for (let i = 0; i < n; i++) {
      const p = toWorldP(
        t.x,
        t.z,
        spec.rotY,
        rng.range(-0.4, 0.4) * t.w,
        rng.range(-0.4, 0.4) * t.d,
      );
      g.box(p.x, y, p.z, 2.2, 1.4, 1.6, spec.rotY, metal);
    }
    if (spec.spireH === 0 && rng.chance(0.6)) {
      const k = rng.int(1, 3);
      for (let i = 0; i < k; i++) {
        const p = toWorldP(
          t.x,
          t.z,
          spec.rotY,
          rng.range(-0.3, 0.3) * t.w,
          rng.range(-0.3, 0.3) * t.d,
        );
        const h = rng.range(4, 20);
        g.beam([p.x, y, p.z], [p.x, y + h, p.z], 0.25, 0.25, [1, 0, 0], metal);
      }
    }
    if (
      r > 20 &&
      (rng.chance(0.005) || (baseKind(spec.district) === 'core' && seeded01(spec.seed + 99) < 0.04))
    ) {
      crane(g, t, spec.rotY, rng);
    }
  }
}

function crane(g: GeoBuilder, t: Tier, rotY: number, rng: Rng): void {
  const steel = plain(0x4a3a1c, 0.6);
  const p = toWorldP(t.x, t.z, rotY, t.w * 0.25, -t.d * 0.2);
  const h = rng.range(18, 30);
  g.beam([p.x, t.y1, p.z], [p.x, t.y1 + h, p.z], 1.6, 1.6, [1, 0, 0], steel);
  const yaw = rng.range(0, Math.PI * 2);
  const dx = Math.cos(yaw);
  const dz = Math.sin(yaw);
  g.beam(
    [p.x - dx * 10, t.y1 + h, p.z - dz * 10],
    [p.x + dx * 40, t.y1 + h, p.z + dz * 40],
    1.2,
    1.2,
    [0, 1, 0],
    steel,
  );
  g.box(p.x - dx * 9, t.y1 + h - 3, p.z - dz * 9, 3, 3, 3, yaw, plain(0x2a2c2e));
}

function helipad(g: GeoBuilder, b: Bld): void {
  const t = b.spec.tiers[b.spec.tiers.length - 1];
  if (!t) return;
  const r = t.w / 2 - 1.5;
  g.place(UNIT_CYL12, t.x, t.y1, t.z, r, 0.6, r, 0, plain(0x1c2022, 0.6));
  const o = tierOutline({ ...t, w: 2 * r, d: 2 * r }, 0, 24);
  band(g, o, t.y1 + 0.6, 0.15, 0.05, glow(NEON.neonTeal.hex, 1.2));
}

function frontFrame(
  spec: BuildingSpec,
  t: Tier,
  side: Side,
): { along: P2; out: P2; half: number; width: number; mid: P2 } {
  const alongX = side === 'pz' || side === 'nz';
  const sgn = side === 'pz' || side === 'px' ? 1 : -1;
  const half = alongX ? t.d / 2 : t.w / 2;
  const width = alongX ? t.w : t.d;
  const out = toWorldP(0, 0, spec.rotY, alongX ? 0 : sgn, alongX ? sgn : 0);
  const tangent = { x: out.z, z: -out.x };
  const mid = { x: t.x + out.x * half, z: t.z + out.z * half };
  return { along: tangent, out, half, width, mid };
}

function waterTank(
  g: GeoBuilder,
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
  hex: number,
): void {
  g.box(x, y, z, r * 1.9, 0.5, r * 1.9, 0, plain(0x1e2022, 0.7));
  g.place(UNIT_CYL8, x, y + 0.5, z, r, h, r, 0, plain(hex, 0.55));
  g.place(UNIT_CONE8, x, y + 0.5 + h, z, r * 1.02, r * 0.35, r * 1.02, 0, plain(hex, 0.55));
}

// 동 numbers travel in a half-float attribute: integers are exact only below 2048.
export const MAX_HALF_INT = 2048;

const TANK_COLORS = [0x2c6f7a, 0x2a5a8c, 0x3a7a6a, 0x8a8f8c, 0x2f6a8a];

function sanggaProps(g: GeoBuilder, b: Bld, rng: Rng): void {
  const { spec } = b;
  const t = spec.tiers[0];
  if (!t) return;
  const y = t.y1;
  const metal = plain(0x2a2d30, 0.5);
  if (rng.chance(0.65)) {
    const p = toWorldP(t.x, t.z, spec.rotY, rng.range(-0.25, 0.25) * t.w, -0.2 * t.d);
    g.box(p.x, y, p.z, 3.4, 2.8, 4.2, spec.rotY, plain(scaleHex(b.wall, 1.1)));
  }
  if (rng.chance(0.8)) {
    const p = toWorldP(t.x, t.z, spec.rotY, rng.range(-0.3, 0.3) * t.w, rng.range(-0.3, 0.1) * t.d);
    waterTank(g, p.x, y, p.z, rng.range(0.8, 1.2), rng.range(1.4, 2.2), rng.pick(TANK_COLORS));
  }
  const n = rng.int(2, 5);
  for (let i = 0; i < n; i++) {
    const p = toWorldP(t.x, t.z, spec.rotY, rng.range(-0.4, 0.4) * t.w, rng.range(-0.4, 0.4) * t.d);
    g.box(p.x, y, p.z, 1.0, 0.8, 0.5, spec.rotY + (rng.chance(0.5) ? Math.PI / 2 : 0), metal);
  }
  const f = frontFrame(spec, t, spec.front);
  if (rng.chance(0.45)) {
    const w = f.width * rng.range(0.5, 0.8);
    const h = rng.range(3.5, 6);
    const inset = 1.2;
    const cx = f.mid.x - f.out.x * inset;
    const cz = f.mid.z - f.out.z * inset;
    const n3: V3 = [f.out.x, 0, f.out.z];
    const pa: V3 = [cx - f.along.x * w * 0.5, y, cz - f.along.z * w * 0.5];
    const pb: V3 = [cx + f.along.x * w * 0.5, y, cz + f.along.z * w * 0.5];
    for (const p of [pa, pb]) g.beam(p, [p[0], y + h, p[2]], 0.25, 0.25, n3, metal);
    for (const k of [0.35, 0.68, 1]) {
      g.beam([pa[0], y + h * k, pa[2]], [pb[0], y + h * k, pb[2]], 0.18, 0.18, n3, metal);
    }
    g.beam([pa[0], y + h * 0.35, pa[2]], [pb[0], y + h, pb[2]], 0.12, 0.12, n3, metal);
    g.beam([pb[0], y + h * 0.35, pb[2]], [pa[0], y + h, pa[2]], 0.12, 0.12, n3, metal);
  }
  const ac = plain(0x8a8e8e, 0.6);
  for (const side of ALL_SIDES) {
    if (side === spec.front) continue;
    const ff = frontFrame(spec, t, side);
    const floors = Math.max(1, spec.floors - 1);
    const count = Math.floor(floors * ff.width * 0.022 * rng.range(0.5, 1.5));
    for (let i = 0; i < count; i++) {
      const fl = rng.int(1, floors - 1);
      const yy = b.windowY + fl * spec.floorH + 0.3;
      if (yy + 0.6 > t.y1) continue;
      const a = rng.range(-0.42, 0.42) * ff.width;
      const x = ff.mid.x + ff.along.x * a + ff.out.x * 0.2;
      const z = ff.mid.z + ff.along.z * a + ff.out.z * 0.2;
      const yaw = Math.atan2(ff.out.x, ff.out.z);
      g.box(x, yy, z, 0.8, 0.6, 0.3, yaw, ac);
    }
    if (rng.chance(0.5)) {
      const a = (rng.chance(0.5) ? 0.46 : -0.46) * ff.width;
      const x = ff.mid.x + ff.along.x * a + ff.out.x * 0.15;
      const z = ff.mid.z + ff.along.z * a + ff.out.z * 0.15;
      g.beam([x, t.y0, z], [x, t.y1, z], 0.15, 0.15, [ff.out.x, 0, ff.out.z], plain(0x3a3e40, 0.5));
    }
  }
  if (spec.h < 35 && rng.chance(0.15)) fireEscape(g, b, t);
}

function fireEscape(g: GeoBuilder, b: Bld, t: Tier): void {
  const { spec } = b;
  const f = frontFrame(spec, t, OPPOSITE[spec.front]);
  const steel = plain(0x24272a, 0.5);
  const n3: V3 = [f.out.x, 0, f.out.z];
  const w = 3;
  const dep = 1.3;
  for (let k = 1; k < spec.floors; k++) {
    const y = b.windowY + (k - 1) * spec.floorH;
    if (y > t.y1 - 1) break;
    const cx = f.mid.x + f.out.x * (dep / 2);
    const cz = f.mid.z + f.out.z * (dep / 2);
    const yaw = Math.atan2(f.out.x, f.out.z);
    g.box(cx, y - 0.1, cz, w, 0.1, dep, yaw, steel, true);
    const dir = k % 2 ? 1 : -1;
    const ex = cx + f.out.x * 0.3;
    const ez = cz + f.out.z * 0.3;
    g.beam(
      [ex - f.along.x * dir * w * 0.45, y, ez - f.along.z * dir * w * 0.45],
      [ex + f.along.x * dir * w * 0.45, y + spec.floorH, ez + f.along.z * dir * w * 0.45],
      0.7,
      0.12,
      n3,
      steel,
    );
    g.beam(
      [cx + f.out.x * dep * 0.5, y + 1, cz + f.out.z * dep * 0.5],
      [
        cx + f.out.x * dep * 0.5 + f.along.x * w * 0.5,
        y + 1,
        cz + f.out.z * dep * 0.5 + f.along.z * w * 0.5,
      ],
      0.06,
      0.06,
      n3,
      steel,
    );
  }
}

function storefront(g: GeoBuilder, b: Bld, rng: Rng, side: Side): void {
  const { spec } = b;
  const t = spec.tiers[0];
  if (!t || t.shape === 'cylinder') return;
  const f = frontFrame(spec, t, side);
  const gh = spec.groundFloorH;
  const margin = 0.5;
  const w = f.width - 2 * margin;
  if (w < 2) return;
  const a = {
    x: f.mid.x - f.along.x * (w / 2) + f.out.x * 0.06,
    z: f.mid.z - f.along.z * (w / 2) + f.out.z * 0.06,
  };
  const c = {
    x: f.mid.x + f.along.x * (w / 2) + f.out.x * 0.06,
    z: f.mid.z + f.along.z * (w / 2) + f.out.z * 0.06,
  };
  const shop = glow(rng.chance(0.55) ? NEON.windowWarm.hex : NEON.windowAmber.hex, 0.6, true);
  shop.seed = b.seed01;
  shop.windowY = t.y0 + 0.15;
  g.wall(a.x, a.z, c.x, c.z, t.y0 + 0.15, t.y0 + gh - 1.0, 0, shop);
  const depth = rng.range(1.5, 3);
  const y = t.y0 + gh - 0.85;
  const striped = rng.chance(0.3);
  const top = striped
    ? style(FACADE.awning, rng.pick([0x5a1a1a, 0x1a4a44, 0x5a3a12, 0x1a2a4a]))
    : plain(0x1a1c1e, 0.6);
  const p0 = { x: a.x, z: a.z };
  const p1 = { x: c.x, z: c.z };
  const q0 = { x: a.x + f.out.x * depth, z: a.z + f.out.z * depth };
  const q1 = { x: c.x + f.out.x * depth, z: c.z + f.out.z * depth };
  const drop = striped ? 0.5 : 0.2;
  const n: V3 = [f.out.x * 0.2, 1, f.out.z * 0.2];
  g.quad(
    [q0.x, y - drop, q0.z],
    [q1.x, y - drop, q1.z],
    [p1.x, y + 0.2, p1.z],
    [p0.x, y + 0.2, p0.z],
    n,
    [0, w, w, 0],
    top,
  );
  g.wall(q0.x, q0.z, q1.x, q1.z, y - drop - 0.35, y - drop, 0, top);
  g.quad(
    [p0.x, y - 0.05, p0.z],
    [p1.x, y - 0.05, p1.z],
    [q1.x, y - drop - 0.05, q1.z],
    [q0.x, y - drop - 0.05, q0.z],
    [0, -1, 0],
    [0, 0, 0, 0],
    glow(NEON.windowWarm.hex, 0.55),
  );
}

function apartment(g: GeoBuilder, b: Bld, rng: Rng): void {
  const { spec } = b;
  const t = spec.tiers[0];
  if (!t) return;
  const slab = plain(scaleHex(b.wall, 1.2), 0.8);
  const rail = plain(scaleHex(b.wall, 1.05), 0.8);
  for (const side of ALL_SIDES) {
    const role = faceRole(spec, side);
    const f = frontFrame(spec, t, side);
    const yaw = Math.atan2(f.out.x, f.out.z);
    if (role === 'south' || role === 'north') {
      const dep = role === 'south' ? 1.4 : 1.6;
      const railH = 1.1;
      const cx = f.mid.x + f.out.x * (dep / 2);
      const cz = f.mid.z + f.out.z * (dep / 2);
      for (let k = 1; k < spec.floors; k++) {
        const y = b.windowY + (k - 1) * spec.floorH;
        if (y > t.y1 - 1) break;
        g.box(cx, y - 0.15, cz, f.width, 0.15, dep, yaw, slab, true);
        const ex = f.mid.x + f.out.x * dep;
        const ez = f.mid.z + f.out.z * dep;
        const ax = ex - f.along.x * f.width * 0.5;
        const az = ez - f.along.z * f.width * 0.5;
        const bx = ex + f.along.x * f.width * 0.5;
        const bz = ez + f.along.z * f.width * 0.5;
        g.wall(ax, az, bx, bz, y, y + (role === 'south' ? railH * 0.85 : railH), 0, rail);
      }
      if (spec.groundFloorH > 4 && role === 'south') {
        for (const off of finOffsets(f.width, 6)) {
          const p = {
            x: f.mid.x + f.along.x * off - f.out.x * 0.6,
            z: f.mid.z + f.along.z * off - f.out.z * 0.6,
          };
          g.box(p.x, t.y0, p.z, 0.7, spec.groundFloorH, 0.7, yaw, slab);
        }
      }
    } else if (spec.tags.dong !== undefined && spec.tags.dong < MAX_HALF_INT) {
      const digits = String(spec.tags.dong).length;
      const gh = Math.min(6, (t.y1 - t.y0) * 0.12);
      const total = gh * 0.62 * digits;
      if (total > f.width - 2) continue;
      const y0 = t.y1 - gh - 3;
      const ax = f.mid.x - f.along.x * total * 0.5 + f.out.x * 0.05;
      const az = f.mid.z - f.along.z * total * 0.5 + f.out.z * 0.05;
      const bx = f.mid.x + f.along.x * total * 0.5 + f.out.x * 0.05;
      const bz = f.mid.z + f.along.z * total * 0.5 + f.out.z * 0.05;
      const s = style(FACADE.dong, b.wall, {
        windowY: y0,
        cellW: spec.tags.dong,
        cellH: digits,
        winW: gh,
      });
      g.wall(ax, az, bx, bz, y0, y0 + gh, 0, s);
    }
  }
  const longX = t.w >= t.d;
  const len = longX ? t.w : t.d;
  const houses = Math.max(1, Math.round(len / 30));
  for (let i = 0; i < houses; i++) {
    const off = (i - (houses - 1) / 2) * (len / houses);
    const p = toWorldP(t.x, t.z, spec.rotY, longX ? off : 0, longX ? 0 : off);
    g.box(
      p.x,
      t.y1,
      p.z,
      longX ? 6 : 8,
      rng.range(3, 4.5),
      longX ? 8 : 6,
      spec.rotY,
      plain(scaleHex(b.wall, 1.1)),
    );
  }
  const p = toWorldP(t.x, t.z, spec.rotY, longX ? len * 0.3 : 0, longX ? 0 : len * 0.3);
  waterTank(g, p.x, t.y1, p.z, 1.6, 2.4, 0x8a8f8c);
}

function warehouseRoof(g: GeoBuilder, b: Bld): void {
  const { spec } = b;
  const t = spec.tiers[0];
  if (!t) return;
  const longX = t.w >= t.d;
  const span = longX ? t.d : t.w;
  const rise = span * 0.1;
  const y = t.y1;
  const hw = t.w / 2;
  const hd = t.d / 2;
  const P = (lx: number, ly: number, lz: number): V3 => {
    const p = toWorldP(t.x, t.z, spec.rotY, lx, lz);
    return [p.x, ly, p.z];
  };
  const roof = plain(scaleHex(b.wall, 0.85), 0.55);
  if (longX) {
    const n1 = toWorldP(0, 0, spec.rotY, 0, 1);
    const n2 = toWorldP(0, 0, spec.rotY, 0, -1);
    g.quad(
      P(-hw, y, hd),
      P(hw, y, hd),
      P(hw, y + rise, 0),
      P(-hw, y + rise, 0),
      [n1.x * 0.2, 1, n1.z * 0.2],
      [0, 0, 0, 0],
      roof,
    );
    g.quad(
      P(hw, y, -hd),
      P(-hw, y, -hd),
      P(-hw, y + rise, 0),
      P(hw, y + rise, 0),
      [n2.x * 0.2, 1, n2.z * 0.2],
      [0, 0, 0, 0],
      roof,
    );
    gable(g, P(hw, y, hd), P(hw, y, -hd), P(hw, y + rise, 0), roof);
    gable(g, P(-hw, y, -hd), P(-hw, y, hd), P(-hw, y + rise, 0), roof);
  } else {
    const n1 = toWorldP(0, 0, spec.rotY, 1, 0);
    const n2 = toWorldP(0, 0, spec.rotY, -1, 0);
    g.quad(
      P(hw, y, hd),
      P(hw, y, -hd),
      P(0, y + rise, -hd),
      P(0, y + rise, hd),
      [n1.x * 0.2, 1, n1.z * 0.2],
      [0, 0, 0, 0],
      roof,
    );
    g.quad(
      P(-hw, y, -hd),
      P(-hw, y, hd),
      P(0, y + rise, hd),
      P(0, y + rise, -hd),
      [n2.x * 0.2, 1, n2.z * 0.2],
      [0, 0, 0, 0],
      roof,
    );
    gable(g, P(-hw, y, hd), P(hw, y, hd), P(0, y + rise, hd), roof);
    gable(g, P(hw, y, -hd), P(-hw, y, -hd), P(0, y + rise, -hd), roof);
  }
}

function gable(g: GeoBuilder, a: V3, c: V3, top: V3, s: Style): void {
  const n = edgeNormal({ x: a[0], z: a[2] }, { x: c[0], z: c[2] });
  const N: V3 = [n.x, 0, n.z];
  const len = Math.hypot(c[0] - a[0], c[2] - a[2]) || 1;
  const uTop = ((top[0] - a[0]) * (c[0] - a[0]) + (top[2] - a[2]) * (c[2] - a[2])) / len;
  const i0 = g.vertex(a, N, 0, s);
  const i1 = g.vertex(c, N, len, s);
  const i2 = g.vertex(top, N, uTop, s);
  g.tri(i0, i1, i2);
}

function warehouseProps(g: GeoBuilder, b: Bld, rng: Rng): void {
  const { spec } = b;
  const t = spec.tiers[0];
  if (!t) return;
  const metal = plain(0x3a3e40, 0.5);
  const n = rng.int(2, 6);
  for (let i = 0; i < n; i++) {
    const p = toWorldP(t.x, t.z, spec.rotY, rng.range(-0.4, 0.4) * t.w, rng.range(-0.4, 0.4) * t.d);
    g.place(UNIT_CYL8, p.x, t.y1, p.z, 0.6, rng.range(1.5, 3), 0.6, 0, metal);
  }
}

export function industrialStacks(spec: BuildingSpec, T: Targets): void {
  if (baseArchetype(spec) !== 'warehouse') return;
  const rng = createRng(spec.seed ^ 0x5a5a);
  const t = spec.tiers[0];
  if (!t || !rng.chance(0.3)) return;
  const p = toWorldP(t.x, t.z, spec.rotY, t.w * 0.35, t.d * 0.3);
  const h = rng.range(25, 50);
  const r = rng.range(1.2, 2);
  const body = plain(0x4a4c4a, 0.8);
  // Taller than the warehouse itself, so it must stay in LOD2 for the skyline.
  for (const g of [T.l0, T.l1, T.l2]) {
    if (discards(g)) continue;
    g.place(UNIT_CYL8, p.x, t.y0, p.z, r, h, r, 0, body);
    g.place(UNIT_CYL8, p.x, t.y0 + h - 5, p.z, r * 1.02, 2, r * 1.02, 0, plain(0x6a1a1a, 0.7));
    g.box(p.x, t.y0 + h, p.z, 0.6, 0.6, 0.6, 0, glow(NEON.neonRed.hex, 2.5));
  }
}

function hillHouse(b: Bld, T: Targets): void {
  const { spec, rng } = b;
  const t = spec.tiers[0];
  if (!t) return;
  let maxT = spec.baseY;
  for (const [sx, sz] of [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ] as const) {
    const p = toWorldP(spec.x, spec.z, spec.rotY, sx * spec.w, sz * spec.d);
    maxT = Math.max(maxT, terrainHeight(p.x, p.z));
  }
  const plinth = maxT - spec.baseY > 0.4 ? Math.min(maxT + 0.2, t.y1 - 2.4) : t.y0;
  b.windowY = Math.max(spec.baseY, plinth);
  // After windowY: LOD2 window rows must line up with the plinth like LOD0/1.
  if (!b.inL2 && !discards(T.l2)) lowBox(b, T.l2);
  const o = tierOutline(t, spec.rotY, 8);
  if (!discards(T.l1)) shell(T.l1, b, t, o, 0, plinth);
  const g = T.l0;
  if (discards(g)) return;
  shell(g, b, t, o, 0, plinth);
  parapet(g, o, t.y1, 0.6, plain(scaleHex(b.wall, 1.1)));
  if (rng.chance(0.75)) {
    const p = toWorldP(
      t.x,
      t.z,
      spec.rotY,
      rng.range(-0.25, 0.25) * t.w,
      rng.range(-0.25, 0.25) * t.d,
    );
    waterTank(
      g,
      p.x,
      t.y1,
      p.z,
      0.8,
      rng.range(1.1, 1.6),
      rng.pick([0x1f8a96, 0x2a6ab0, 0x2a8a9a, 0x3a5aa0]),
    );
  }
  if (rng.chance(0.35)) {
    const p = toWorldP(t.x, t.z, spec.rotY, -0.25 * t.w, 0.2 * t.d);
    g.box(p.x, t.y1, p.z, 2.6, 2.3, 2.6, spec.rotY, plain(scaleHex(b.wall, 1.05)));
  }
  const k = rng.int(0, 3);
  for (let i = 0; i < k; i++) {
    const p = toWorldP(t.x, t.z, spec.rotY, rng.range(-0.4, 0.4) * t.w, rng.range(-0.4, 0.4) * t.d);
    g.box(
      p.x,
      t.y1,
      p.z,
      0.5,
      0.45,
      0.5,
      rng.range(0, 3),
      plain(rng.chance(0.5) ? 0x1c2a1c : 0x3a2a22),
    );
  }
  if (rng.chance(0.3)) {
    const a = toWorldP(t.x, t.z, spec.rotY, -0.35 * t.w, 0.35 * t.d);
    const c = toWorldP(t.x, t.z, spec.rotY, 0.35 * t.w, 0.35 * t.d);
    const pole = plain(0x3a3a3a);
    g.beam([a.x, t.y1, a.z], [a.x, t.y1 + 1.8, a.z], 0.06, 0.06, [1, 0, 0], pole);
    g.beam([c.x, t.y1, c.z], [c.x, t.y1 + 1.8, c.z], 0.06, 0.06, [1, 0, 0], pole);
    g.beam([a.x, t.y1 + 1.7, a.z], [c.x, t.y1 + 1.7, c.z], 0.03, 0.03, [0, 1, 0], pole);
  }
  if (rng.chance(0.3) && spec.floors >= 2) {
    const side: Side = rng.chance(0.5) ? 'px' : 'nx';
    const f = frontFrame(spec, t, side);
    const s0 = {
      x: f.mid.x + f.out.x * 0.7 - f.along.x * t.d * 0.4,
      z: f.mid.z + f.out.z * 0.7 - f.along.z * t.d * 0.4,
    };
    const s1 = {
      x: f.mid.x + f.out.x * 0.7 + f.along.x * t.d * 0.35,
      z: f.mid.z + f.out.z * 0.7 + f.along.z * t.d * 0.35,
    };
    g.beam(
      [s0.x, b.windowY, s0.z],
      [s1.x, b.windowY + spec.floorH, s1.z],
      1.0,
      0.25,
      [f.out.x, 0, f.out.z],
      plain(0x3a3c3c),
    );
  }
}

export type RoofKind = 'flat' | 'wedge' | 'lattice';

const ROOF_ARCHETYPES = new Set(['setbackTower', 'officeSlab', 'bracedTower', 'cantileverTower']);

export function roofTopKind(
  spec: Pick<BuildingSpec, 'archetype' | 'h' | 'spireH' | 'seed' | 'tiers'>,
): RoofKind {
  const top = spec.tiers[spec.tiers.length - 1];
  if (!top || top.shape === 'cylinder' || spec.spireH > 0 || spec.h < 90) return 'flat';
  if (!ROOF_ARCHETYPES.has(spec.archetype)) return 'flat';
  const r = seeded01(spec.seed + 21);
  return r < 0.3 ? 'wedge' : r < 0.7 ? 'lattice' : 'flat';
}

function wedgeRoof(g: GeoBuilder, b: Bld): void {
  const { spec } = b;
  const t = spec.tiers[spec.tiers.length - 1];
  if (!t) return;
  const hw = t.w / 2;
  const hd = t.d / 2;
  const rise = Math.min(18, Math.min(t.w, t.d) * 0.45);
  const y = t.y1;
  const P = (lx: number, ly: number, lz: number): V3 => {
    const p = toWorldP(t.x, t.z, spec.rotY, lx, lz);
    return [p.x, ly, p.z];
  };
  const s = plain(scaleHex(b.wall, 1.1), 0.5);
  const glass = style(FACADE.curtain, b.wall, {
    cellW: 1.5,
    cellH: spec.floorH,
    winW: 1.4,
    winH: 2.4,
    windowY: b.windowY,
    seed: b.seed01 + 0.5,
    lit: b.lit * 0.6,
  });
  const nrm = toWorldP(0, 0, spec.rotY, rise, 0);
  const len = Math.hypot(t.w, rise);
  const n: V3 = [nrm.x / len, t.w / len, nrm.z / len];
  g.quad(
    P(hw, y, hd),
    P(hw, y, -hd),
    P(-hw, y + rise, -hd),
    P(-hw, y + rise, hd),
    n,
    [0, 0, 0, 0],
    s,
  );
  const back = toWorldP(0, 0, spec.rotY, -1, 0);
  const B: V3 = [back.x, 0, back.z];
  const i0 = g.vertex(P(-hw, y, -hd), B, 0, glass);
  const i1 = g.vertex(P(-hw, y, hd), B, t.d, glass);
  const i2 = g.vertex(P(-hw, y + rise, hd), B, t.d, glass);
  const i3 = g.vertex(P(-hw, y + rise, -hd), B, 0, glass);
  g.tri(i0, i1, i2);
  g.tri(i0, i2, i3);
  gable(g, P(-hw, y, hd), P(hw, y, hd), P(-hw, y + rise, hd), glass);
  gable(g, P(hw, y, -hd), P(-hw, y, -hd), P(-hw, y + rise, -hd), glass);
}

function latticeCrown(g: GeoBuilder, b: Bld, lv: 0 | 1 | 2): void {
  const { spec } = b;
  const t = spec.tiers[spec.tiers.length - 1];
  if (!t) return;
  const h = 8 + seeded01(spec.seed + 23) * 8;
  const steel = plain(MATERIAL.bracing, 0.5);
  const o = rectOutline(t.x, t.z, t.w - 0.6, t.d - 0.6, spec.rotY);
  const n = o.pts.length;
  for (let i = 0; i < n; i++) {
    const a = o.pts[i] as P2;
    const c = o.pts[(i + 1) % n] as P2;
    const nn = edgeNormal(a, c);
    const N: V3 = [nn.x, 0, nn.z];
    g.beam([a.x, t.y1, a.z], [a.x, t.y1 + h, a.z], 0.9, 0.9, N, steel);
    for (const k of lv === 0 ? [0.5, 1] : [1]) {
      g.beam([a.x, t.y1 + h * k, a.z], [c.x, t.y1 + h * k, c.z], 0.6, 0.6, N, steel);
    }
    if (lv === 0) {
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      const k = Math.floor(len / 3);
      for (let j = 1; j < k; j++) {
        const f = j / k;
        const x = a.x + (c.x - a.x) * f;
        const z = a.z + (c.z - a.z) * f;
        g.beam([x, t.y1 + 1, z], [x, t.y1 + h, z], 0.3, 0.3, N, steel);
      }
    }
  }
  if (b.mega) band(g, o, t.y1 + h - 0.3, 0.3, 0.1, glow(NEON.neonRed.hex, 1.6));
}

function lowBox(b: Bld, g: GeoBuilder): void {
  const { spec } = b;
  const t = spec.tiers[0];
  if (!t) return;
  const box: Tier = {
    ...t,
    y1: spec.baseY + spec.h,
    shape: t.shape === 'cylinder' ? 'cylinder' : 'box',
  };
  shell(g, b, box, tierOutline(box, spec.rotY, 8), 0);
}
