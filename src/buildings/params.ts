// Pure, side-effect-free parameters for the buildings module (ART_DIRECTION 3.4, 4.1-4.5).
// Everything here is unit tested in tests/buildings.test.ts; geometry code only consumes it.
import { WINDOW_LIT } from '../core/palette';
import { createRng } from '../core/random';
import { sideNormal } from '../city/math';
import type { Archetype, BuildingSpec, DistrictKind, Side } from '../city/types';

// ---------------------------------------------------------------------------
// Facade shader types (aInfo.x in the facade material). Keep in sync with facadeMaterial.ts.

export const FACADE = {
  /** Albedo only (roofs, props, blank walls). */
  plain: 0,
  /** Curtain wall: 1.5 m mullions, 2.4 m vision glass, spandrels. */
  curtain: 1,
  /** Punched windows in a solid wall (sangga, precast offices, hill houses). */
  punched: 2,
  /** Apartment south face: living room + bedroom window per household. */
  aptSouth: 3,
  /** Apartment north face: open corridor light strip per floor (복도식). */
  aptCorridor: 4,
  /** Constant emissive (shop glass, soffits, crowns, skybridges); vertex color = light color. */
  emissive: 5,
  /** Painted 동 number on an apartment gable. */
  dong: 6,
  /** Corrugated metal (warehouses) with a high strip window. */
  corrugated: 7,
  /** Striped awning fabric. */
  awning: 8,
} as const;

export type FacadeType = (typeof FACADE)[keyof typeof FACADE];

// ---------------------------------------------------------------------------
// Window dimensions (4.1, real meters).

export interface WindowStyle {
  type: FacadeType;
  /** Target cell width (m); `fitCells` stretches it to fit the face exactly. */
  cellW: number;
  /** Window width / height inside a cell (m). */
  winW: number;
  winH: number;
}

/** Window style per archetype and face role. */
export function windowStyle(
  archetype: Archetype,
  role: 'front' | 'side' | 'back' | 'south' | 'north' | 'gable',
  seed: number,
): WindowStyle {
  switch (archetype) {
    case 'setbackTower':
    case 'cylinderTower':
    case 'bracedTower':
    case 'cantileverTower':
    case 'twinTower':
      return { type: FACADE.curtain, cellW: 1.5, winW: 1.4, winH: 2.4 };
    case 'officeSlab':
      // Half curtain wall, half precast concrete with punched 1.8 × 1.6 m windows.
      return seed % 2 === 0
        ? { type: FACADE.curtain, cellW: 1.5, winW: 1.4, winH: 2.4 }
        : { type: FACADE.punched, cellW: 2.4, winW: 1.8, winH: 1.6 };
    case 'sangga':
      if (role === 'side') return { type: FACADE.plain, cellW: 3, winW: 0, winH: 0 };
      return role === 'back'
        ? { type: FACADE.punched, cellW: 4.2, winW: 1.2, winH: 1.2 }
        : { type: FACADE.punched, cellW: 2.6, winW: 1.6, winH: 1.6 };
    case 'apartmentSlab':
      if (role === 'south') return { type: FACADE.aptSouth, cellW: 6, winW: 2.6, winH: 2 };
      if (role === 'north') return { type: FACADE.aptCorridor, cellW: 3, winW: 0.9, winH: 0.9 };
      return { type: FACADE.plain, cellW: 3, winW: 0, winH: 0 };
    case 'hillHouse':
      return { type: FACADE.punched, cellW: 2.6, winW: 0.9, winH: 1.1 };
    case 'warehouse':
      return { type: FACADE.corrugated, cellW: 4, winW: 3, winH: 0.8 };
    case 'pavilion':
      return { type: FACADE.plain, cellW: 3, winW: 0, winH: 0 };
  }
}

/** Number of whole cells that fit `width` closest to `target` (≥ 1), and the stretched cell width. */
export function fitCells(width: number, target: number): { count: number; cellW: number } {
  const count = Math.max(1, Math.round(width / target));
  return { count, cellW: width / count };
}

// ---------------------------------------------------------------------------
// Lit windows (3.4).

/** Median night lit ratio from the palette (`NIGHT.windowLitRatio`). */
export const NIGHT_MEDIAN_LIT = 0.32;

/**
 * Per-district factor multiplied onto `env.windowLitRatio` in the shader: the middle of the
 * 3.4 night range relative to the city median. Industrial / riverside follow midtown.
 */
export function districtLitFactor(d: DistrictKind): number {
  const n = WINDOW_LIT.night;
  const r =
    d === 'core' || d === 'sangga' || d === 'apartment' || d === 'hillside' || d === 'midtown'
      ? n[d]
      : ([0.1, 0.16] as const);
  return (r[0] + r[1]) / 2 / NIGHT_MEDIAN_LIT;
}

// ---------------------------------------------------------------------------
// Façade relief (4.3 #2): horizontal bands and vertical fins.

/** World y of horizontal bands on a tier: every `every` floors, skipping the ends. */
export function bandLevels(
  y0: number,
  y1: number,
  windowStart: number,
  floorH: number,
  every: number,
): number[] {
  const out: number[] = [];
  const step = floorH * every;
  for (let y = windowStart + step; y < y1 - floorH * 1.5; y += step) {
    if (y > y0 + 1.5) out.push(y);
  }
  return out;
}

/** Fin offsets along a face of width `width`, `spacing` apart, centered, keeping 1 m margins. */
export function finOffsets(width: number, spacing: number): number[] {
  const usable = width - 2;
  if (usable <= 0) return [];
  const n = Math.floor(usable / spacing) + 1;
  const start = -((n - 1) * spacing) / 2;
  return Array.from({ length: n }, (_, i) => start + i * spacing);
}

/**
 * Exoskeleton bay heights for a braced tower (4.2): X braces every `bay` m (16 m = 4 office
 * floors). Returns the bay boundaries from y0 to y1 (last bay absorbs the remainder).
 */
export function braceLevels(y0: number, y1: number, bay = 16): number[] {
  const h = y1 - y0;
  const n = Math.max(1, Math.round(h / bay));
  return Array.from({ length: n + 1 }, (_, i) => y0 + (h * i) / n);
}

/** Column positions along a face: corners plus intermediate columns at most `maxSpan` apart. */
export function columnOffsets(width: number, maxSpan = 24): number[] {
  const n = Math.max(1, Math.ceil(width / maxSpan));
  return Array.from({ length: n + 1 }, (_, i) => -width / 2 + (width * i) / n);
}

// ---------------------------------------------------------------------------
// Face roles.

/** Outward normal of a local side for rotY (alias of city/math `sideNormal`). */
export const sideNormalXZ: (side: Side, rotY: number) => { x: number; z: number } = sideNormal;

export const OPPOSITE: Record<Side, Side> = { px: 'nx', nx: 'px', pz: 'nz', nz: 'pz' };

/** Role of a local side for window styling. */
export function faceRole(
  spec: Pick<BuildingSpec, 'archetype' | 'front' | 'rotY' | 'w' | 'd'>,
  side: Side,
): 'front' | 'side' | 'back' | 'south' | 'north' | 'gable' {
  if (spec.archetype === 'apartmentSlab') {
    const longIsX = spec.w >= spec.d; // long walls are the ±Z sides
    const isLong = longIsX ? side === 'pz' || side === 'nz' : side === 'px' || side === 'nx';
    if (!isLong) return 'gable';
    return sideNormalXZ(side, spec.rotY).z >= 0 ? 'south' : 'north';
  }
  if (side === spec.front) return 'front';
  if (side === OPPOSITE[spec.front]) return 'back';
  return 'side';
}

// ---------------------------------------------------------------------------
// Chunks and LOD (4.4, 4.5).

export const CHUNK_SIZE = 256;
/** Camera distance (m, to the chunk center) where each LOD level starts. */
export const LOD_DISTANCES = [0, 380, 1100] as const;
export const LOD_HYSTERESIS = 0.1;
/** LOD2 keeps only buildings at least this tall (m above their base). */
export const LOD2_MIN_HEIGHT = 40;

/** Chunk grid index of a world position; the map is split from -half in 256 m steps. */
export function chunkIndex(x: number, z: number, half = 1200): { i: number; j: number } {
  const n = chunksPerAxis(half);
  const idx = (v: number): number =>
    Math.min(n - 1, Math.max(0, Math.floor((v + half) / CHUNK_SIZE)));
  return { i: idx(x), j: idx(z) };
}

/**
 * Chunks per axis: 2400 / 256 = 9.375, so the thin remainder strip joins the last chunk
 * (9 × 9 chunks; the outer row is 352 m wide). Keeps the draw call count ≤ 81 + 2.
 */
export function chunksPerAxis(half = 1200): number {
  return Math.max(1, Math.floor((2 * half) / CHUNK_SIZE));
}

/** World [min, max] of chunk index k along one axis. */
function chunkSpan(k: number, half: number): [number, number] {
  const n = chunksPerAxis(half);
  const lo = -half + k * CHUNK_SIZE;
  return [lo, k === n - 1 ? half : lo + CHUNK_SIZE];
}

/** World center of chunk (i, j). */
export function chunkCenter(i: number, j: number, half = 1200): { x: number; z: number } {
  const [x0, x1] = chunkSpan(i, half);
  const [z0, z1] = chunkSpan(j, half);
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
}

/**
 * Which LOD level THREE.LOD would show at `distance` without hysteresis (mirrors
 * `LOD.update`): the last level whose start distance is ≤ distance.
 */
export function lodLevel(distance: number): 0 | 1 | 2 {
  if (distance >= LOD_DISTANCES[2]) return 2;
  if (distance >= LOD_DISTANCES[1]) return 1;
  return 0;
}

/** True when a building belongs in the coarsest level. */
export function keepInLod2(spec: Pick<BuildingSpec, 'h' | 'archetype'>): boolean {
  return spec.h >= LOD2_MIN_HEIGHT;
}

/** Cylinder segment count per LOD (4.4). */
export function cylinderSegments(level: 0 | 1 | 2): number {
  return level === 0 ? 48 : level === 1 ? 16 : 8;
}

// ---------------------------------------------------------------------------
// Small deterministic helpers.

/** One deterministic draw in [0, 1) for a derived seed (`createRng(seed).next()`). */
export function seeded01(seed: number): number {
  return createRng(seed).next();
}

/** Linear interpolation of two sRGB hex colors, returned as a hex. */
export function mixHex(a: number, b: number, t: number): number {
  const ch = (s: number): number => {
    const x = (a >> s) & 255;
    const y = (b >> s) & 255;
    return Math.round(x + (y - x) * t) & 255;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Scale an sRGB hex color by k (clamped). */
export function scaleHex(a: number, k: number): number {
  const ch = (s: number): number => Math.min(255, Math.round(((a >> s) & 255) * k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Stair steps along a sloped path: count and riser height for tread `tread` (m). */
export function stairSteps(
  length: number,
  rise: number,
  tread = 0.3,
): { n: number; riser: number } {
  const n = Math.max(1, Math.round(length / tread));
  return { n, riser: rise / n };
}

/**
 * Intervals [t0, t1] (0..1 along segment a→b) covered by crossing roads, merged and sorted.
 * Each crossing is given as its parameter t and its half width in meters.
 */
export function mergeIntervals(
  crossings: readonly { t: number; half: number }[],
  length: number,
): [number, number][] {
  const iv = crossings
    .map((c): [number, number] => [c.t - c.half / length, c.t + c.half / length])
    .sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [a, b] of iv) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
