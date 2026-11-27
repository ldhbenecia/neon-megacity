import { WINDOW_LIT } from '../core/palette';
import { createRng } from '../core/random';
import { baseKindOf, isUnbuilt } from '../city/layout';
import { sideNormal } from '../city/math';
import { ZONES } from '../city/districts';
import type { Archetype, BuildingSpec, DistrictKind, Side } from '../city/types';
import type { Quality } from '../core/types';

// Shader type ids decoded in facadeMaterial.ts.
export const FACADE = {
  plain: 0,
  curtain: 1,
  punched: 2,
  aptSouth: 3,
  aptCorridor: 4,
  emissive: 5,
  dong: 6,
  corrugated: 7,
  awning: 8,
  brick: 9,
} as const;

export type FacadeType = (typeof FACADE)[keyof typeof FACADE];

export interface WindowStyle {
  type: FacadeType;
  cellW: number;
  winW: number;
  winH: number;
}

const BASE_ARCHETYPES = [
  'setbackTower',
  'cylinderTower',
  'bracedTower',
  'cantileverTower',
  'twinTower',
  'officeSlab',
  'sangga',
  'apartmentSlab',
  'hillHouse',
  'warehouse',
  'pavilion',
  'taperTower',
  'mediaSlab',
  'lowOffice',
  'hanokRow',
  'palaceHall',
  'brickWarehouse',
  'showroomBox',
] as const;

/** Archetypes this module has dedicated geometry for. */
export type BaseArchetype = Extract<Archetype, (typeof BASE_ARCHETYPES)[number]>;

// Archetypes from newer layouts without geometry yet draw as a base form by height.
// A Map, so prototype keys like 'constructor' never match.
const BASE_OF = new Map<string, BaseArchetype>(BASE_ARCHETYPES.map((a) => [a, a] as const));

export function baseArchetype(spec: Pick<BuildingSpec, 'archetype' | 'h'>): BaseArchetype {
  return BASE_OF.get(spec.archetype) ?? (spec.h >= LOD2_MIN_HEIGHT ? 'officeSlab' : 'sangga');
}

export type BaseSpec = BuildingSpec & { archetype: BaseArchetype };

export function withBaseArchetype(spec: BuildingSpec): BaseSpec {
  return { ...spec, archetype: baseArchetype(spec) };
}

export function windowStyle(
  archetype: BaseArchetype,
  role: 'front' | 'side' | 'back' | 'south' | 'north' | 'gable',
  seed: number,
): WindowStyle {
  switch (archetype) {
    case 'setbackTower':
    case 'cylinderTower':
    case 'bracedTower':
    case 'cantileverTower':
    case 'twinTower':
    case 'taperTower':
      return { type: FACADE.curtain, cellW: 1.5, winW: 1.4, winH: 2.4 };
    case 'officeSlab':
    case 'mediaSlab':
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
    case 'palaceHall':
    case 'showroomBox':
      return { type: FACADE.plain, cellW: 3, winW: 0, winH: 0 };
    case 'lowOffice':
      return { type: FACADE.punched, cellW: 2.2, winW: 0.8, winH: 1.9 };
    case 'hanokRow':
      return role === 'front'
        ? { type: FACADE.punched, cellW: 3, winW: 2.2, winH: 1.5 }
        : { type: FACADE.plain, cellW: 3, winW: 0, winH: 0 };
    case 'brickWarehouse':
      // Blind brick walls (the back, and the sides of every other building) carry painted signs.
      return role === 'back' || (role === 'side' && seed % 2 === 0)
        ? { type: FACADE.brick, cellW: 4.5, winW: 0, winH: 0 }
        : { type: FACADE.brick, cellW: 4.5, winW: 2.2, winH: 2.6 };
  }
}

/** A wall drawn without any window cells. */
export function isBlankStyle(ws: WindowStyle): boolean {
  return ws.type === FACADE.plain || ws.winW <= 0;
}

export function fitCells(width: number, target: number): { count: number; cellW: number } {
  const count = Math.max(1, Math.round(width / target));
  return { count, cellW: width / count };
}

export const NIGHT_MEDIAN_LIT = 0.32;

// v3 kinds light like their closest v2 kind; the palace and parks stay dark.
export function districtLitFactor(kind: DistrictKind): number {
  if (isUnbuilt(kind)) return 0;
  const d = baseKindOf(kind);
  const r =
    d === 'core' || d === 'sangga' || d === 'apartment' || d === 'hillside' || d === 'midtown'
      ? WINDOW_LIT.night[d]
      : ([0.1, 0.16] as const);
  return (r[0] + r[1]) / 2 / NIGHT_MEDIAN_LIT;
}

const ZONE_LIT = new Map(ZONES.map((z) => [z.id, z.litScale]));

export function zoneLitScale(zoneId: string): number {
  return ZONE_LIT.get(zoneId) ?? 1;
}

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

export function finOffsets(width: number, spacing: number): number[] {
  const usable = width - 2;
  if (usable <= 0) return [];
  const n = Math.floor(usable / spacing) + 1;
  const start = -((n - 1) * spacing) / 2;
  return Array.from({ length: n }, (_, i) => start + i * spacing);
}

export function braceLevels(y0: number, y1: number, bay = 16): number[] {
  const h = y1 - y0;
  const n = Math.max(1, Math.round(h / bay));
  return Array.from({ length: n + 1 }, (_, i) => y0 + (h * i) / n);
}

export function columnOffsets(width: number, maxSpan = 24): number[] {
  const n = Math.max(1, Math.ceil(width / maxSpan));
  return Array.from({ length: n + 1 }, (_, i) => -width / 2 + (width * i) / n);
}

export const sideNormalXZ: (side: Side, rotY: number) => { x: number; z: number } = sideNormal;

export const OPPOSITE: Record<Side, Side> = { px: 'nx', nx: 'px', pz: 'nz', nz: 'pz' };

export function faceRole(
  spec: Pick<BuildingSpec, 'archetype' | 'front' | 'rotY' | 'w' | 'd'>,
  side: Side,
): 'front' | 'side' | 'back' | 'south' | 'north' | 'gable' {
  if (spec.archetype === 'apartmentSlab') {
    const longIsX = spec.w >= spec.d;
    const isLong = longIsX ? side === 'pz' || side === 'nz' : side === 'px' || side === 'nx';
    if (!isLong) return 'gable';
    return sideNormalXZ(side, spec.rotY).z >= 0 ? 'south' : 'north';
  }
  if (side === spec.front) return 'front';
  if (side === OPPOSITE[spec.front]) return 'back';
  return 'side';
}

export const LOD_DISTANCES = [0, 380, 1100] as const;
/** LOD0 radius on the medium tier (high uses LOD_DISTANCES[1]). */
export const LOD0_MEDIUM = 250;

/**
 * LOD start distances per quality tier (perf design #66). 'ci' and 'low' build no LOD0, so no
 * interior mapping either ('ci' also pulls LOD2 in); medium pulls LOD0 in to 250 m.
 */
export function lodDistancesFor(q: Quality): [number, number, number] {
  if (q === 'ci') return [0, 0, LOD_DISTANCES[1]];
  if (q === 'low') return [0, 0, LOD_DISTANCES[2]];
  return [0, q === 'medium' ? LOD0_MEDIUM : LOD_DISTANCES[1], LOD_DISTANCES[2]];
}
export const LOD_HYSTERESIS = 0.1;
export const LOD2_MIN_HEIGHT = 40;

export interface ChunkGrid {
  halfX: number;
  halfZ: number;
  size: number;
}

export function chunkGrid(layout: { extentX: number; extentZ: number }, size: number): ChunkGrid {
  return { halfX: layout.extentX / 2, halfZ: layout.extentZ / 2, size };
}

// The remainder joins the outer chunk when under half a chunk (v2: 2400 / 256 = 9.375 → 9),
// otherwise it becomes its own short chunk (v3: 2600 / 400 = 6.5 → 7).
export function chunkCount(half: number, size: number): number {
  return Math.max(1, Math.round((2 * half) / size));
}

function chunkAxis(v: number, half: number, size: number): number {
  const n = chunkCount(half, size);
  return Math.min(n - 1, Math.max(0, Math.floor((v + half) / size)));
}

export function chunkIndex(x: number, z: number, grid: ChunkGrid): { i: number; j: number } {
  return { i: chunkAxis(x, grid.halfX, grid.size), j: chunkAxis(z, grid.halfZ, grid.size) };
}

function chunkSpan(k: number, half: number, size: number): [number, number] {
  const n = chunkCount(half, size);
  const lo = -half + k * size;
  return [lo, k === n - 1 ? half : lo + size];
}

export function chunkCenter(i: number, j: number, grid: ChunkGrid): { x: number; z: number } {
  const [x0, x1] = chunkSpan(i, grid.halfX, grid.size);
  const [z0, z1] = chunkSpan(j, grid.halfZ, grid.size);
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
}

export function keepInLod2(spec: Pick<BuildingSpec, 'h' | 'archetype'>): boolean {
  return spec.h >= LOD2_MIN_HEIGHT;
}

export function cylinderSegments(level: 0 | 1 | 2): number {
  return level === 0 ? 48 : level === 1 ? 16 : 8;
}

export function seeded01(seed: number): number {
  return createRng(seed).next();
}

export function mixHex(a: number, b: number, t: number): number {
  const ch = (s: number): number => {
    const x = (a >> s) & 255;
    const y = (b >> s) & 255;
    return Math.round(x + (y - x) * t) & 255;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export function scaleHex(a: number, k: number): number {
  const ch = (s: number): number => Math.min(255, Math.round(((a >> s) & 255) * k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export function stairSteps(
  length: number,
  rise: number,
  tread = 0.3,
): { n: number; riser: number } {
  const n = Math.max(1, Math.round(length / tread));
  return { n, riser: rise / n };
}

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
