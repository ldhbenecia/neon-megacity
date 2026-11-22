// Building geometry per archetype (ART_DIRECTION 4.2, 4.3) written into chunk builders per LOD.
// LOD0: everything (parapets, bands, fins, balconies, props, shop fronts).
// LOD1: tier shells + window shader, bracing, crowns, spires (bands become nothing; the shader
//       keeps the floor rhythm). LOD2: shells of buildings ≥ 40 m only, coarse cylinders.
import { createRng, type Rng } from '../core/random';
import { MATERIAL, NEON } from '../core/palette';
import { terrainHeight } from '../city/layout';
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
  hash01,
  keepInLod2,
  mixHex,
  scaleHex,
  windowStyle,
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

/** Per-building shared values. */
interface Bld {
  spec: BuildingSpec;
  rng: Rng;
  seed01: number;
  lit: number;
  wall: number;
  roof: number;
  windowY: number;
  inL2: boolean;
  tower: boolean;
  mega: boolean;
  /** Sides with a lit shop front at street level (front + other street-facing sides). */
  shopSides: Set<Side>;
}

/** Returns true when a point (a face's outer edge at ground level) is on a street. */
export type StreetTest = (x: number, z: number) => boolean;

const SHOP_ARCHETYPES = new Set(['sangga', 'officeSlab', 'pavilion']);
const ALL_SIDES: readonly Side[] = ['px', 'nx', 'pz', 'nz'];

function shopSides(spec: BuildingSpec, onStreet?: StreetTest): Set<Side> {
  const out = new Set<Side>();
  if (!spec.tags.storefront && spec.archetype !== 'pavilion') return out;
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
      // Painted concrete slabs read lighter than the office glass (still dark at night).
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

/** Style of one tier face. */
function faceStyle(b: Bld, side: Side | null, len: number, tierIdx: number): Style {
  const { spec } = b;
  const baseRole = side ? faceRole(spec, side) : 'side';
  const shop = side !== null && b.shopSides.has(side);
  const role = shop && baseRole === 'side' ? 'front' : baseRole;
  const ws = windowStyle(spec.archetype, role, spec.seed);
  if (
    ws.type === FACADE.plain ||
    (side === null && !(spec.archetype === 'cylinderTower') && len < 4)
  ) {
    return plain(b.wall, 0.85);
  }
  const fit = fitCells(len, ws.cellW);
  return style(ws.type, b.wall, {
    cellW: spec.archetype === 'cylinderTower' ? ws.cellW : fit.cellW,
    cellH: spec.archetype === 'warehouse' ? spec.h : spec.floorH,
    winW: ws.winW,
    winH: ws.winH,
    windowY: b.windowY,
    seed: b.seed01 + tierIdx * 0.013 + (side ? 'pnxz'.indexOf(side[1] ?? 'x') * 0.1 : 0),
    lit: b.lit,
    param: spec.archetype === 'hillHouse' ? 0.55 : 0,
    storefront: tierIdx === 0 && (b.tower || shop),
  });
}

/** Cylinder faces: one continuous u, cell width fitted to the circumference. */
function cylStyle(b: Bld, o: Outline, tierIdx: number): Style {
  const fit = fitCells(perimeter(o), 1.5);
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

/** Walls + roof of one tier (and the plinth band on slopes). */
function shell(
  g: GeoBuilder,
  b: Bld,
  t: Tier,
  o: Outline,
  tierIdx: number,
  plinthTop = t.y0,
): void {
  const cyl = t.shape === 'cylinder';
  const cs = cyl ? cylStyle(b, o, tierIdx) : null;
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

function crownStyle(b: Bld): Style {
  const pick = hash01(b.spec.seed + 7);
  const hex =
    pick < 0.45 ? NEON.neonWhite.hex : pick < 0.8 ? NEON.neonCyan.hex : NEON.neonOrange.hex;
  return glow(hex, pick < 0.45 ? 1.6 : 2.4);
}

// ---------------------------------------------------------------------------

export function emitBuilding(spec: BuildingSpec, T: Targets, onStreet?: StreetTest): void {
  const rng = createRng(spec.seed);
  const wall = facadeHex(spec, rng);
  const b: Bld = {
    spec,
    rng,
    seed01: hash01(spec.seed),
    lit: districtLitFactor(spec.district),
    wall,
    roof: scaleHex(wall, spec.archetype === 'apartmentSlab' ? 0.7 : 0.9),
    windowY: spec.baseY + spec.groundFloorH,
    inL2: keepInLod2(spec),
    tower: TOWERS.has(spec.archetype),
    mega: spec.h >= 200,
    shopSides: shopSides(spec, onStreet),
  };
  const levels: [GeoBuilder, 0 | 1 | 2][] = [
    [T.l0, 0],
    [T.l1, 1],
  ];
  if (b.inL2) levels.push([T.l2, 2]);
  else lowBox(b, T.l2);

  if (spec.archetype === 'hillHouse') return hillHouse(b, T);
  const roofKind = roofTopKind(spec);

  const stacks = spec.twin ? [spec.tiers, spec.twin] : [spec.tiers];
  for (const [g, lv] of levels) {
    for (const tiers of stacks) {
      tiers.forEach((t, i) => {
        const o = tierOutline(t, spec.rotY, cylinderSegments(lv));
        const outline =
          lv === 2 && t.shape === 'chamfer' ? rectOutline(t.x, t.z, t.w, t.d, spec.rotY) : o;
        shell(g, b, t, outline, i);
      });
      const topTier = tiers[tiers.length - 1];
      if (topTier && b.mega) {
        // Megatower crown: always visible (skyline identification, 4.5).
        const o = tierOutline(topTier, spec.rotY, lv === 0 ? 48 : 16);
        band(g, o, topTier.y1 - 3.2, 2.4, 0.35, crownStyle(b));
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
  detail(b, T.l0);
}

// ---------------------------------------------------------------------------
// LOD0 detail per archetype

function detail(b: Bld, g: GeoBuilder): void {
  const { spec, rng } = b;
  const stacks = spec.twin ? [spec.tiers, spec.twin] : [spec.tiers];
  const parapetH =
    spec.archetype === 'sangga' ? 1.0 : spec.archetype === 'apartmentSlab' ? 1.5 : 1.2;
  const bandStyle = plain(scaleHex(b.wall, 1.35), 0.7);
  for (const tiers of stacks) {
    tiers.forEach((t, i) => {
      const o = tierOutline(t, spec.rotY, 32);
      if (spec.archetype !== 'warehouse' && spec.archetype !== 'pavilion') {
        parapet(g, o, t.y1, parapetH, plain(scaleHex(b.wall, 1.15), 0.85));
      }
      // Horizontal bands every 4-8 floors on offices and towers.
      if (b.tower || spec.archetype === 'officeSlab') {
        const every = 4 + Math.floor(hash01(spec.seed + i) * 5);
        for (const y of bandLevels(t.y0, t.y1, b.windowY, spec.floorH, every)) {
          band(g, o, y - 0.25, 0.5, 0.4, bandStyle);
        }
      }
      // Lobby / plinth band of towers: a lighter stone base 0.5 m proud.
      if (i === 0 && b.tower && t.shape !== 'cylinder') {
        band(g, o, t.y0 + spec.groundFloorH - 0.6, 0.6, 0.6, bandStyle);
      }
    });
  }
  switch (spec.archetype) {
    case 'officeSlab':
      fins(g, b);
      roofMechanical(g, b, rng);
      break;
    case 'setbackTower':
    case 'cylinderTower':
    case 'bracedTower':
    case 'cantileverTower':
    case 'twinTower':
      roofMechanical(g, b, rng);
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

// ---------------------------------------------------------------------------

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
  // Aviation light housing at the tip (neon owns blinking lights; this is the dim fixture).
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

/** 4.2 bracedTower: exoskeleton 0.8 m off the wall, X braces every 16 m, 30% lit edges. */
function bracing(g: GeoBuilder, b: Bld, lv: 0 | 1): void {
  const { spec } = b;
  const steel = plain(MATERIAL.bracing, 0.45);
  const lit =
    hash01(spec.seed + 3) < 0.3
      ? glow(hash01(spec.seed + 5) < 0.5 ? NEON.neonCyan.hex : NEON.neonOrange.hex, 3)
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
        // Far away the lit edges read as the corner lines only.
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
  // Glowing soffit (4.2: HDR ×1.5 warm white).
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

/** Vertical fins on the long faces of office slabs (4.3 #2). */
function fins(g: GeoBuilder, b: Bld): void {
  const { spec } = b;
  const t = spec.tiers[0];
  if (!t || t.shape === 'chamfer') return;
  const spacing = 1.5 + hash01(spec.seed + 11) * 1.5;
  const depth = 0.5 + hash01(spec.seed + 13) * 0.5;
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

/** Roof mechanical floors, condensers, antennas, rare tower crane (4.3 #1). */
function roofMechanical(g: GeoBuilder, b: Bld, rng: Rng): void {
  const { spec } = b;
  const stacks = spec.twin ? [spec.tiers, spec.twin] : [spec.tiers];
  const dark = plain(scaleHex(b.roof, 0.8), 0.7);
  const metal = plain(0x2e3236, 0.5);
  for (const tiers of stacks) {
    const t = tiers[tiers.length - 1];
    if (!t) continue;
    const y = t.y1;
    const r = Math.min(t.w, t.d);
    if (t.shape === 'cylinder') continue;
    // Mechanical penthouse.
    const pw = t.w * rng.range(0.35, 0.6);
    const pd = t.d * rng.range(0.35, 0.6);
    g.box(t.x, y, t.z, pw, rng.range(3, 6), pd, spec.rotY, dark);
    // Condenser grid.
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
    // Antennas 4-20 m.
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
    // Tower crane on 0.5 % of tall buildings (and the odd one in core for character).
    if (r > 20 && (rng.chance(0.005) || hash01(spec.seed + 99) < 0.04)) crane(g, t, spec.rotY, rng);
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
  // Perimeter lights as a thin glowing ring (dim; bloom-safe).
  const o = tierOutline({ ...t, w: 2 * r, d: 2 * r }, 0, 24);
  band(g, o, t.y1 + 0.6, 0.15, 0.05, glow(NEON.neonTeal.hex, 1.2));
}

// ---------------------------------------------------------------------------
// Sangga: rooftop water tank, condensers, steel ad frame, side AC units, pipes, fire stairs.

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
  // Face tangent, same convention as BuildingFace.tangent: (n.z, -n.x).
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

const TANK_COLORS = [0x2c6f7a, 0x2a5a8c, 0x3a7a6a, 0x8a8f8c, 0x2f6a8a];

function sanggaProps(g: GeoBuilder, b: Bld, rng: Rng): void {
  const { spec } = b;
  const t = spec.tiers[0];
  if (!t) return;
  const y = t.y1;
  const metal = plain(0x2a2d30, 0.5);
  // Rooftop stair house (옥탑).
  if (rng.chance(0.65)) {
    const p = toWorldP(t.x, t.z, spec.rotY, rng.range(-0.25, 0.25) * t.w, -0.2 * t.d);
    g.box(p.x, y, p.z, 3.4, 2.8, 4.2, spec.rotY, plain(scaleHex(b.wall, 1.1)));
  }
  // Water tank.
  if (rng.chance(0.8)) {
    const p = toWorldP(t.x, t.z, spec.rotY, rng.range(-0.3, 0.3) * t.w, rng.range(-0.3, 0.1) * t.d);
    waterTank(g, p.x, y, p.z, rng.range(0.8, 1.2), rng.range(1.4, 2.2), rng.pick(TANK_COLORS));
  }
  // Condensers.
  const n = rng.int(2, 5);
  for (let i = 0; i < n; i++) {
    const p = toWorldP(t.x, t.z, spec.rotY, rng.range(-0.4, 0.4) * t.w, rng.range(-0.4, 0.4) * t.d);
    g.box(p.x, y, p.z, 1.0, 0.8, 0.5, spec.rotY + (rng.chance(0.5) ? Math.PI / 2 : 0), metal);
  }
  // Steel rooftop ad frame on the street edge (neon may hang signs; the lattice reads alone too).
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
  // Side walls: AC units hanging under windows-less walls, vertical drain pipes.
  const ac = plain(0x8a8e8e, 0.6);
  for (const side of ['px', 'nx', 'pz', 'nz'] as Side[]) {
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
      const yaw = Math.atan2(ff.along.x, ff.along.z) - Math.PI / 2;
      g.box(x, yy, z, 0.8, 0.6, 0.3, yaw + Math.PI / 2, ac);
    }
    if (rng.chance(0.5)) {
      const a = (rng.chance(0.5) ? 0.46 : -0.46) * ff.width;
      const x = ff.mid.x + ff.along.x * a + ff.out.x * 0.15;
      const z = ff.mid.z + ff.along.z * a + ff.out.z * 0.15;
      g.beam([x, t.y0, z], [x, t.y1, z], 0.15, 0.15, [ff.out.x, 0, ff.out.z], plain(0x3a3e40, 0.5));
    }
  }
  // Fire escape on the back of 15 % of low buildings.
  if (spec.h < 35 && rng.chance(0.15)) fireEscape(g, b, t);
}

function fireEscape(g: GeoBuilder, b: Bld, t: Tier): void {
  const { spec } = b;
  const back: Side =
    spec.front === 'px' ? 'nx' : spec.front === 'nx' ? 'px' : spec.front === 'pz' ? 'nz' : 'pz';
  const f = frontFrame(spec, t, back);
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
    // Railing.
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

// ---------------------------------------------------------------------------
// Storefront: glowing shop glass + canopy (4.3 #4, 6.2).

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
  const shop = glow(rng.chance(0.75) ? NEON.windowWarm.hex : NEON.windowCool.hex, 1.15, true);
  shop.seed = b.seed01;
  shop.windowY = t.y0 + 0.15;
  g.wall(a.x, a.z, c.x, c.z, t.y0 + 0.15, t.y0 + gh - 1.0, 0, shop);
  // Canopy (깊이 1.5-3 m), 30 % striped awnings.
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
  // Sloped top (fabric awning falls toward the street).
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
  // Lit underside (shop lights under the canopy wash the sidewalk).
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

// ---------------------------------------------------------------------------
// Apartment slab (판상형 복도식): balconies south, corridors north, 동 number on gables.

function apartment(g: GeoBuilder, b: Bld, rng: Rng): void {
  const { spec } = b;
  const t = spec.tiers[0];
  if (!t) return;
  const slab = plain(scaleHex(b.wall, 1.2), 0.8);
  const rail = plain(scaleHex(b.wall, 1.05), 0.8);
  for (const side of ['px', 'nx', 'pz', 'nz'] as Side[]) {
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
        // Parapet / railing: solid on corridors, lower glassy rail on balconies.
        const ex = f.mid.x + f.out.x * dep;
        const ez = f.mid.z + f.out.z * dep;
        const ax = ex - f.along.x * f.width * 0.5;
        const az = ez - f.along.z * f.width * 0.5;
        const bx = ex + f.along.x * f.width * 0.5;
        const bz = ez + f.along.z * f.width * 0.5;
        g.wall(ax, az, bx, bz, y, y + (role === 'south' ? railH * 0.85 : railH), 0, rail);
      }
      // Ground floor pilotis columns for 30 % of slabs.
      if (spec.groundFloorH > 4 && role === 'south') {
        for (const off of finOffsets(f.width, 6)) {
          const p = {
            x: f.mid.x + f.along.x * off - f.out.x * 0.6,
            z: f.mid.z + f.along.z * off - f.out.z * 0.6,
          };
          g.box(p.x, t.y0, p.z, 0.7, spec.groundFloorH, 0.7, yaw, slab);
        }
      }
    } else if (spec.tags.dong !== undefined) {
      // 동 number: 6 m glyphs near the top of the gable.
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
  // Rooftop: elevator / stair houses (옥탑) and a water tank.
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

// ---------------------------------------------------------------------------
// Warehouse: shallow gable roof, roof vents, chimneys (industrial).

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
  const i0 = g.vertex(a, N, 0, s);
  const i1 = g.vertex(c, N, 0, s);
  const i2 = g.vertex(top, N, 0, s);
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

/** Chimneys and tanks are tall silhouettes: emitted in LOD0 and LOD1. */
export function industrialStacks(spec: BuildingSpec, T: Targets): void {
  if (spec.archetype !== 'warehouse') return;
  const rng = createRng(spec.seed ^ 0x5a5a);
  const t = spec.tiers[0];
  if (!t || !rng.chance(0.3)) return;
  const p = toWorldP(t.x, t.z, spec.rotY, t.w * 0.35, t.d * 0.3);
  const h = rng.range(25, 50);
  const r = rng.range(1.2, 2);
  const body = plain(0x4a4c4a, 0.8);
  for (const g of [T.l0, T.l1]) {
    g.place(UNIT_CYL8, p.x, t.y0, p.z, r, h, r, 0, body);
    // Red / white warning bands near the top.
    g.place(UNIT_CYL8, p.x, t.y0 + h - 5, p.z, r * 1.02, 2, r * 1.02, 0, plain(0x6a1a1a, 0.7));
    g.box(p.x, t.y0 + h, p.z, 0.6, 0.6, 0.6, 0, glow(NEON.neonRed.hex, 2.5));
  }
}

// ---------------------------------------------------------------------------
// Hill house (별계단동): small box, concrete plinth on slopes, cyan tank, 옥탑.

function hillHouse(b: Bld, T: Targets): void {
  const { spec, rng } = b;
  const t = spec.tiers[0];
  if (!t) return;
  // Highest terrain under the footprint: the plinth (옹벽) covers baseY → there.
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
  const o = tierOutline(t, spec.rotY, 8);
  shell(T.l0, b, t, o, 0, plinth);
  shell(T.l1, b, t, o, 0, plinth);
  const g = T.l0;
  parapet(g, o, t.y1, 0.6, plain(scaleHex(b.wall, 1.1)));
  // Rooftop water tank (청록·파랑, 지름 1.6 m).
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
  // Pots / clutter.
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
  // Laundry line between two posts.
  if (rng.chance(0.3)) {
    const a = toWorldP(t.x, t.z, spec.rotY, -0.35 * t.w, 0.35 * t.d);
    const c = toWorldP(t.x, t.z, spec.rotY, 0.35 * t.w, 0.35 * t.d);
    const pole = plain(0x3a3a3a);
    g.beam([a.x, t.y1, a.z], [a.x, t.y1 + 1.8, a.z], 0.06, 0.06, [1, 0, 0], pole);
    g.beam([c.x, t.y1, c.z], [c.x, t.y1 + 1.8, c.z], 0.06, 0.06, [1, 0, 0], pole);
    g.beam([a.x, t.y1 + 1.7, a.z], [c.x, t.y1 + 1.7, c.z], 0.03, 0.03, [0, 1, 0], pole);
  }
  // Exterior stair to the upper floor on 30 % (다세대주택).
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

// ---------------------------------------------------------------------------
// Skyline tops (4.2 setbackTower crown: "발광 링 또는 사선 지붕") and the LOD2 stand-in.

export type RoofKind = 'flat' | 'wedge' | 'lattice';

const ROOF_ARCHETYPES = new Set(['setbackTower', 'officeSlab', 'bracedTower', 'cantileverTower']);

/** Roof silhouette for tall offices and towers without a spire (deterministic per seed). */
export function roofTopKind(
  spec: Pick<BuildingSpec, 'archetype' | 'h' | 'spireH' | 'seed' | 'tiers'>,
): RoofKind {
  const top = spec.tiers[spec.tiers.length - 1];
  if (!top || top.shape === 'cylinder' || spec.spireH > 0 || spec.h < 90) return 'flat';
  if (!ROOF_ARCHETYPES.has(spec.archetype)) return 'flat';
  const r = hash01(spec.seed + 21);
  return r < 0.3 ? 'wedge' : r < 0.7 ? 'lattice' : 'flat';
}

/** Slanted roof rising toward the tier's -X side. */
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

/** Open steel crown frame above the roof (screen for the mechanical floor). */
function latticeCrown(g: GeoBuilder, b: Bld, lv: 0 | 1 | 2): void {
  const { spec } = b;
  const t = spec.tiers[spec.tiers.length - 1];
  if (!t) return;
  const h = 8 + hash01(spec.seed + 23) * 8;
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

/** LOD2 stand-in for buildings under 40 m: one box per building, still window-shaded. */
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
