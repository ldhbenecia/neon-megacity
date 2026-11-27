// Shared bridge geometry: the bridge-local frame, span and pier layout (islands included), pier
// placement against roads and highways, and pier uplights. Pure.
import {
  RIVER,
  bridgeDeckY,
  islandAt,
  surfaceHeight,
  type Bridge,
  type IslandKind,
  type Road,
} from '../city/layout';
import { obbSegmentDistance } from '../city/math';
import type { InfraColors } from './colors';
import type { HwPath } from './highways';
import { len, sub, type RGB, type V3 } from './mesh';
import type { ColumnInstance, DetailParts, InfraParts } from './parts';
import { DECK_THICKNESS } from './profile';

/**
 * Bridge builders write the always-drawn parts (deck, piers, structural silhouette, lights) into
 * InfraParts and the fine parts (rails, posts, lane paint, bracing) into `detail`.
 */
export type BridgeParts = InfraParts & { detail: DetailParts };

/** What pier placement must keep clear of. */
export interface Obstacles {
  roads: readonly Road[];
  highways: readonly HwPath[];
}

export type BridgeBuilder = (
  b: Bridge,
  f: BridgeFrame,
  parts: BridgeParts,
  c: InfraColors,
  o: Obstacles,
) => void;

/** Lower road deck height of a double-deck bridge when the layout leaves it unset. */
const LOWER_DECK_Y = 4;

/** Abutment block depth along s (m). */
export const ABUT = 8;

/** Bridge-local frame: s along a → b (south), l lateral (right of a → b), y world height. */
export interface BridgeFrame {
  mid: V3;
  u: V3;
  v: V3;
  /** Half span between the abutments. */
  spanHalf: number;
  /** s of the north (landA, negative) and south (landB, positive) approach landings. */
  landA: number;
  landB: number;
}

export function bridgeFrame(b: Bridge): BridgeFrame {
  const mid: V3 = [(b.a.x + b.b.x) / 2, 0, (b.a.z + b.b.z) / 2];
  const d = sub([b.b.x, 0, b.b.z], [b.a.x, 0, b.a.z]);
  const span = len(d);
  const u: V3 = [d[0] / span, 0, d[2] / span];
  const v: V3 = [-u[2], 0, u[0]];
  const along = (q: { x: number; z: number }): number =>
    (q.x - mid[0]) * u[0] + (q.z - mid[2]) * u[2];
  return { mid, u, v, spanHalf: span / 2, landA: along(b.landA), landB: along(b.landB) };
}

export function bridgePoint(f: BridgeFrame, s: number, l: number, y: number): V3 {
  return [f.mid[0] + f.u[0] * s + f.v[0] * l, y, f.mid[2] + f.u[2] * s + f.v[2] * l];
}

/** Deck surface y on the bridge axis at s, from the layout's bridgeDeckY (0 off the ends). */
export function deckYAt(b: Bridge, f: BridgeFrame, s: number): number {
  const p = bridgePoint(f, s, 0, 0);
  return Math.max(0, bridgeDeckY(b, p[0], p[2]) ?? 0);
}

/** Builder key for a bridge. Unknown kinds (newer layouts) fall back to 'girder'. */
export type BridgeShape =
  'arch' | 'truss' | 'doubleDeck' | 'girder' | 'deckArch' | 'tiedArch' | 'cableStayed';

const SHAPES: ReadonlySet<string> = new Set<BridgeShape>([
  'arch',
  'truss',
  'doubleDeck',
  'girder',
  'deckArch',
  'tiedArch',
  'cableStayed',
]);

export function bridgeShape(b: Bridge): BridgeShape {
  // Widened to string so a layout whose BridgeKind union drops a name still compiles.
  const kind: string = b.kind;
  return SHAPES.has(kind) ? (kind as BridgeShape) : 'girder';
}

/**
 * Lower deck surface y, or undefined for a single-deck bridge. Only 'doubleDeck' and the plain
 * girder carry one: every other shape has piers, ribs or pylon legs where it would run.
 */
export function lowerDeckY(b: Bridge): number | undefined {
  const shape = bridgeShape(b);
  if (shape === 'doubleDeck') return b.lowerDeckY ?? LOWER_DECK_Y;
  return shape === 'girder' ? b.lowerDeckY : undefined;
}

/**
 * Minimum span count per shape (truss: continuous three-span Warren), and the typical span (m)
 * used only when the layout's `spans` is not a finite number.
 */
const SPANS: Record<BridgeShape, { len: number; min: number }> = {
  arch: { len: Infinity, min: 2 },
  truss: { len: 80, min: 3 },
  doubleDeck: { len: 40, min: 2 },
  girder: { len: 70, min: 2 },
  deckArch: { len: 90, min: 2 },
  tiedArch: { len: 80, min: 1 },
  cableStayed: { len: 90, min: 2 },
};

/** Shortest span `spans` may ask for (m); bounds the pier count for a bad layout value. */
const MIN_SPAN = 10;

/**
 * Pier-to-pier spans between the abutments: the layout's `spans`, clamped to the shape minimum
 * and span/MIN_SPAN, or a count from the span length when it is not a finite number. 'arch'
 * always has two (the builder draws two arches over one center pier).
 */
export function spanCount(b: Bridge, f: BridgeFrame): number {
  const shape = bridgeShape(b);
  const { len, min } = SPANS[shape];
  if (shape === 'arch') return min;
  if (!Number.isFinite(b.spans)) return Math.max(min, Math.round((2 * f.spanHalf) / len));
  const most = Math.max(min, Math.floor((2 * f.spanHalf) / MIN_SPAN));
  return Math.min(most, Math.max(min, Math.round(b.spans)));
}

/**
 * Islands the road stops on (노들섬): the deck rests on the island and the over-deck structure
 * (arches, trusses) breaks there. Marsh and park islands pass under the structure.
 */
const STOP_ISLANDS: ReadonlySet<IslandKind> = new Set<IslandKind>(['culture', 'land']);

/** Pier distance inside each island edge (m). */
const ISLAND_INSET = 6;

/** Shortest island crossing that gets its own span (m). */
const MIN_ISLAND_SPAN = 20;

/**
 * s range where the deck (anywhere across its width) crosses the bridge's stop island: the
 * longest unbroken run, insets applied. Undefined when there is none or it is too short.
 */
export function islandRange(b: Bridge, f: BridgeFrame): { s0: number; s1: number } | undefined {
  if (!b.island) return undefined;
  const h = f.spanHalf;
  const on = (s: number): boolean =>
    [-b.width / 2, 0, b.width / 2].some((l) => {
      const p = bridgePoint(f, s, l, 0);
      const isl = islandAt(p[0], p[2]);
      return isl !== null && isl.id === b.island && STOP_ISLANDS.has(isl.kind);
    });
  let best = { s0: 0, s1: -Infinity };
  let start: number | undefined;
  for (let s = -h; s <= h + 1e-9; s += 2) {
    if (on(s)) {
      start ??= s;
      if (s - start > best.s1 - best.s0) best = { s0: start, s1: s };
    } else {
      start = undefined;
    }
  }
  if (best.s1 - best.s0 < MIN_ISLAND_SPAN + 2 * ISLAND_INSET) return undefined;
  return { s0: best.s0 + ISLAND_INSET, s1: best.s1 - ISLAND_INSET };
}

/** `k` - 1 evenly spaced interior points of [x0, x1]. */
function interior(x0: number, x1: number, k: number): number[] {
  return Array.from({ length: Math.max(0, k - 1) }, (_, i) => x0 + ((x1 - x0) * (i + 1)) / k);
}

/**
 * River piers (s positions); abutments are separate blocks at ±spanHalf. Evenly spaced, except
 * that a stop island gets one span of its own between piers on its edges and the other spans
 * split the water on both sides in proportion to its width.
 */
export function pierStations(b: Bridge, f: BridgeFrame): number[] {
  const h = f.spanHalf;
  const n = spanCount(b, f);
  const isl = n >= 3 ? islandRange(b, f) : undefined;
  if (!isl || isl.s0 <= -h + MIN_SPAN || isl.s1 >= h - MIN_SPAN) return interior(-h, h, n);
  const wa = isl.s0 + h;
  const wb = h - isl.s1;
  const na = Math.min(n - 2, Math.max(1, Math.round(((n - 1) * wa) / (wa + wb))));
  return [...interior(-h, isl.s0, na), isl.s0, isl.s1, ...interior(isl.s1, h, n - 1 - na)];
}

export interface Span {
  s0: number;
  s1: number;
  /** Over the stop island: no over-deck structure. */
  island: boolean;
}

/** Spans between consecutive piers / abutments. */
export function spanList(b: Bridge, f: BridgeFrame): Span[] {
  const isl = islandRange(b, f);
  const ends = [-f.spanHalf, ...pierStations(b, f), f.spanHalf];
  return ends.slice(1).map((s1, i) => {
    const s0 = ends[i] as number;
    return { s0, s1, island: isl !== undefined && s0 === isl.s0 && s1 === isl.s1 };
  });
}

/** Approach pier spacing on the long south ramp, beyond the riverside highway. */
const APPROACH_BAY = 35;

/** First ramp pier past the riverside highway, measured from the abutment (m). */
const APPROACH_START = 55;

/** Ground supports under a stop island span, at most this far apart (m). */
const ISLAND_BAY = 30;

/**
 * Approach piers: one per side just outside the abutment, then every APPROACH_BAY m from
 * APPROACH_START past the abutment, stopping 20 m short of the landing. Stations that fall on
 * a highway are dropped later in `pushPiers`.
 */
export function approachStations(f: BridgeFrame): number[] {
  const near = f.spanHalf + 13;
  const out = [-near, near];
  for (const [sgn, land] of [
    [-1, -f.landA],
    [1, f.landB],
  ] as const) {
    for (let s = f.spanHalf + APPROACH_START; s < land - 20; s += APPROACH_BAY) out.push(sgn * s);
  }
  return out.sort((a, b) => a - b);
}

/** Points every `step` m (arc length) along a polyline. */
export function resample(pts: readonly V3[], step: number): V3[] {
  const out: V3[] = [];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i] as V3;
    const b = pts[i + 1] as V3;
    const seg = len(sub(b, a));
    if (seg < 1e-9) continue; // repeated point: nothing to walk
    let t = carry;
    while (t <= seg) {
      const k = t / seg;
      out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
      t += step;
    }
    carry = t - seg;
  }
  return out;
}

/** Parabolic arch rib between s0 and s1: spring at `springY`, crown at `crownY`. */
export function archY(s: number, s0: number, s1: number, springY: number, crownY: number): number {
  const c = (s0 + s1) / 2;
  const h = (s1 - s0) / 2;
  const k = (s - c) / h;
  return springY + (crownY - springY) * Math.max(0, 1 - k * k);
}

/** True when an approach pier footprint would stand on (or within 0.5 m of) a ground road. */
export function approachPierBlocksRoad(
  c: { x: number; z: number; w: number; d: number; rotY: number },
  roads: readonly Road[],
): boolean {
  const obb = { x: c.x, z: c.z, hw: c.w / 2, hd: c.d / 2, rotY: c.rotY };
  const r = Math.hypot(c.w, c.d);
  return roads.some((road) => {
    const minX = Math.min(road.a.x, road.b.x) - road.width;
    const maxX = Math.max(road.a.x, road.b.x) + road.width;
    const minZ = Math.min(road.a.z, road.b.z) - road.width;
    const maxZ = Math.max(road.a.z, road.b.z) + road.width;
    if (c.x + r < minX || c.x - r > maxX || c.z + r < minZ || c.z - r > maxZ) return false;
    return obbSegmentDistance(obb, road.a, road.b) < road.width / 2 + 0.5;
  });
}

/**
 * True when a pier footprint would stand on (or within 0.5 m of) a highway deck that runs below
 * the pier top. Decks passing over the pier (above the bridge) do not block it.
 */
export function pierBlocksHighway(c: ColumnInstance, highways: readonly HwPath[]): boolean {
  const obb = { x: c.x, z: c.z, hw: c.w / 2, hd: c.d / 2, rotY: c.rotY };
  const r = Math.hypot(c.w, c.d) / 2;
  return highways.some((path) => {
    const pad = path.hw.width / 2 + r + 0.5;
    if (c.x < path.minX - pad || c.x > path.maxX + pad) return false;
    if (c.z < path.minZ - pad || c.z > path.maxZ + pad) return false;
    const pts = path.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i] as V3;
      const e = pts[i + 1] as V3;
      if (Math.min(a[1], e[1]) >= c.y1) continue;
      if (c.x < Math.min(a[0], e[0]) - pad || c.x > Math.max(a[0], e[0]) + pad) continue;
      if (c.z < Math.min(a[2], e[2]) - pad || c.z > Math.max(a[2], e[2]) + pad) continue;
      const d = obbSegmentDistance(obb, { x: a[0], z: a[2] }, { x: e[0], z: e[2] });
      if (d < path.hw.width / 2 + 0.5) return true;
    }
    return false;
  });
}

/** Shortest ground pier worth drawing (m): below this the deck practically rests on the ground. */
const MIN_PIER_H = 1.5;

/**
 * River piers (`w` × `d`, up to `topY`, a height or one per station) and ground piers under the approaches and a stop island.
 * Returns the river stations actually placed.
 */
export function pushPiers(
  b: Bridge,
  f: BridgeFrame,
  parts: BridgeParts,
  topY: number | ((s: number) => number),
  w: number,
  d: number,
  { roads, highways }: Obstacles,
): number[] {
  const topAt = typeof topY === 'number' ? () => topY : topY;
  const rotY = Math.atan2(-f.v[2], f.v[0]);
  const blocked = (c: ColumnInstance): boolean =>
    approachPierBlocksRoad(c, roads) || pierBlocksHighway(c, highways);
  // River piers can land outside the water when the span is wider than the channel.
  const placed: number[] = [];
  for (const s of pierStations(b, f)) {
    const p = bridgePoint(f, s, 0, 0);
    const column = { x: p[0], z: p[2], y0: -8, y1: topAt(s), w, d, rotY, owner: b.id };
    if (blocked(column)) continue;
    parts.columns.push(column);
    placed.push(s);
  }
  const ground = approachStations(f);
  const isl = spanList(b, f).find((sp) => sp.island);
  if (isl) {
    const k = Math.ceil((isl.s1 - isl.s0) / ISLAND_BAY);
    ground.push(...interior(isl.s0, isl.s1, k));
  }
  for (const s of ground) {
    const p = bridgePoint(f, s, 0, 0);
    const foot = surfaceHeight(p[0], p[2]);
    const top = deckYAt(b, f, s) - DECK_THICKNESS;
    if (top - foot < MIN_PIER_H) continue;
    const column = {
      x: p[0],
      z: p[2],
      y0: foot - 1,
      y1: top,
      w: b.width * 0.55,
      d: 1.8,
      rotY,
      owner: b.id,
    };
    if (!blocked(column)) parts.columns.push(column);
  }
  return placed;
}

/** Uplight washes on both river-facing faces of the river piers at `stations`. */
export function buildPierWashes(
  f: BridgeFrame,
  parts: BridgeParts,
  c: InfraColors,
  stations: readonly number[],
  pierW: number,
  pierD: number,
  topY: number | ((s: number) => number),
  color: (s: number) => { wash: RGB; strip: RGB } = () => ({
    wash: c.uplight,
    strip: c.uplightStrip,
  }),
): void {
  const waterY = RIVER.waterY;
  for (const s0 of stations) {
    const top = typeof topY === 'number' ? topY : topY(s0);
    // A pier head this close to the water leaves no face to light.
    if (top - waterY < 2) continue;
    const { wash, strip } = color(s0);
    for (const sgn of [-1, 1] as const) {
      const s = s0 + sgn * (pierD / 2 + 0.06);
      const w = pierW * 0.29;
      const p = (l: number, y: number): V3 => bridgePoint(f, s, l, y);
      const n: V3 = [f.u[0] * sgn, 0, f.u[2] * sgn];
      // Soft-edged wash: bright at the waterline, gone by the deck, dark at both sides.
      const cols = [-1, -0.6, 0.6, 1];
      const colK = [0, 1, 1, 0];
      const rows = [waterY, waterY + (top - waterY) * 0.35, top];
      const rowK = [1, 0.3, 0];
      const base = parts.wash.vertexCount;
      for (const [ri, y] of rows.entries()) {
        for (const [ci, k] of cols.entries()) {
          const m = (rowK[ri] ?? 0) * (colK[ci] ?? 0);
          const col: RGB = [wash[0] * m, wash[1] * m, wash[2] * m];
          parts.wash.vertex(p(-sgn * k * w, y), n, col);
        }
      }
      for (let r = 0; r < rows.length - 1; r++) {
        for (let k = 0; k < cols.length - 1; k++) {
          const a = base + r * cols.length + k;
          const d = a + cols.length;
          parts.wash.tri(a, a + 1, d + 1);
          parts.wash.tri(a, d + 1, d);
        }
      }
      // Fixture strip at the waterline.
      parts.glow.beam(p(-w, waterY + 0.4), p(w, waterY + 0.4), 0.25, 0.25, strip);
    }
  }
}

/** Washes near a park island (선유도) are its green; the rest cyan. */
export function islandWashColor(
  b: Bridge,
  f: BridgeFrame,
  c: InfraColors,
): (s: number) => { wash: RGB; strip: RGB } {
  return (s) => {
    if (b.island) {
      for (const k of [-40, 0, 40]) {
        const p = bridgePoint(f, s + k, 0, 0);
        if (islandAt(p[0], p[2])?.id === b.island)
          return { wash: c.islandWash, strip: c.islandStrip };
      }
    }
    return { wash: c.uplight, strip: c.uplightStrip };
  };
}
