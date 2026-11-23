// Bridges (ART_DIRECTION 2.3): two-span tied arch, Warren truss and double-deck girder, plus a
// plain girder for any kind this module does not know yet, with their static lights. Original
// designs, not copies of real bridges. Pure: reads a Bridge from the layout and writes InfraParts.
import { RIVER, bridgeDeckY, surfaceHeight, type Bridge, type Road } from '../city/layout';
import { obbSegmentDistance } from '../city/math';
import type { InfraColors } from './colors';
import { nearestOnPath, type HwPath } from './highways';
import { framesAlong, len, sub, type Frame, type RGB, type V3 } from './mesh';
import type { InfraParts } from './parts';
import { DECK_THICKNESS, boxEdges, markingLines, slabEdges, slabLoop } from './profile';

/** Lower road deck height of a double-deck bridge when the layout leaves it unset. */
const LOWER_DECK_Y = 4;

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
export type BridgeShape = 'arch' | 'truss' | 'doubleDeck' | 'girder';

export function bridgeShape(b: Bridge): BridgeShape {
  // Widened to string so a layout whose BridgeKind union drops a name still compiles.
  const kind: string = b.kind;
  if (kind === 'arch' || kind === 'truss' || kind === 'doubleDeck') return kind;
  return 'girder';
}

/** Lower deck surface y, or undefined for a single-deck bridge. */
export function lowerDeckY(b: Bridge): number | undefined {
  return b.lowerDeckY ?? (bridgeShape(b) === 'doubleDeck' ? LOWER_DECK_Y : undefined);
}

/** Typical main span (m) per shape when the layout does not give a span count. */
const SPAN_LENGTH: Record<BridgeShape, number> = {
  arch: Infinity,
  truss: 80,
  doubleDeck: 40,
  girder: 70,
};

/** Number of spans between the abutments: the layout's `spans` if present, else by shape. */
export function spanCount(b: Bridge, f: BridgeFrame): number {
  const shape = bridgeShape(b);
  if (shape === 'arch') return 2;
  const given = (b as { spans?: unknown }).spans;
  if (typeof given === 'number' && Number.isFinite(given) && given >= 1) return Math.round(given);
  return Math.max(shape === 'truss' ? 3 : 2, Math.round((2 * f.spanHalf) / SPAN_LENGTH[shape]));
}

/** River piers (s positions), evenly spaced; abutments are separate blocks at ±spanHalf. */
export function pierStations(b: Bridge, f: BridgeFrame): number[] {
  const h = f.spanHalf;
  const n = spanCount(b, f);
  return Array.from({ length: n - 1 }, (_, i) => ((2 * (i + 1) - n) / n) * h);
}

/** Approach pier spacing on the long south ramp, beyond the riverside highway. */
const APPROACH_BAY = 35;

/** First ramp pier past the riverside highway, measured from the abutment (m). */
const APPROACH_START = 55;

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

/** Abutment block depth along s (m). */
const ABUT = 8;

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

function deckPath(
  b: Bridge,
  f: BridgeFrame,
  from: number,
  to: number,
  y: (s: number) => number,
): V3[] {
  // Rounded to the millimetre so a break point never lands a hair away from a 6 m station.
  const r = (s: number): number => Math.round(s * 1000) / 1000;
  const stations = new Set<number>([r(from), r(to)]);
  for (let s = Math.ceil(from / 6) * 6; s < to; s += 6) stations.add(r(s));
  for (const k of [-f.spanHalf, f.spanHalf]) if (k > from && k < to) stations.add(r(k));
  return [...stations].sort((p, q) => p - q).map((s) => bridgePoint(f, s, 0, y(s)));
}

/** Slab, curbs, rails, posts and lane paint of one deck level. */
function buildDeck(
  b: Bridge,
  f: BridgeFrame,
  parts: InfraParts,
  c: InfraColors,
  from: number,
  to: number,
  y: (s: number) => number,
  railColor: RGB,
): void {
  const pts = deckPath(b, f, from, to, y);
  const frames = framesAlong(pts);
  const half = b.width / 2;
  parts.concrete.sweep(frames, slabEdges(b.width, c));
  const loop = slabLoop(b.width);
  parts.concrete.cap(frames[0] as Frame, loop, c.concrete, -1);
  parts.concrete.cap(frames[frames.length - 1] as Frame, loop, c.concrete, 1);
  for (const sgn of [-1, 1] as const) {
    const lo = sgn === 1 ? half - 0.45 : -half;
    parts.concrete.sweep(frames, boxEdges(lo, lo + 0.45, -0.02, 0.5, c.concrete));
    const rl = sgn * (half - 0.2);
    parts.steel.sweep(frames, boxEdges(rl - 0.08, rl + 0.08, 1.05, 1.2, railColor));
  }
  // Rail posts every 3 m.
  for (let s = Math.ceil(from / 3) * 3; s <= to; s += 3) {
    for (const sgn of [-1, 1] as const) {
      const l = sgn * (half - 0.2);
      const yy = y(s);
      parts.steel.beam(
        bridgePoint(f, s, l, yy + 0.5),
        bridgePoint(f, s, l, yy + 1.06),
        0.1,
        0.1,
        railColor,
      );
    }
  }
  // Lane paint (bridges: no median barrier, double yellow center line).
  for (const line of markingLines({ lanes: b.lanes, kind: 'elevated', width: b.width })) {
    const color = line.yellow ? c.paintYellow : c.paintWhite;
    const edge = [
      { a: [line.l - 0.075, 0.02] as const, b: [line.l + 0.075, 0.02] as const, color },
    ];
    if (!line.dashed) {
      parts.markings.sweep(frames, edge);
      continue;
    }
    for (let s = from + 4; s + 6 < to; s += 15) {
      parts.markings.sweep(
        framesAlong([s, s + 3, s + 6].map((k) => bridgePoint(f, k, 0, y(k)))),
        edge,
      );
    }
  }
}

/** Concrete abutment blocks at both banks (top just under the deck). */
function buildAbutments(
  b: Bridge,
  f: BridgeFrame,
  parts: InfraParts,
  c: InfraColors,
  portalY?: number,
): void {
  for (const sgn of [-1, 1] as const) {
    const s0 = sgn * f.spanHalf;
    const s1 = sgn * (f.spanHalf + ABUT);
    const top = deckYAt(b, f, s0) - DECK_THICKNESS - 0.1;
    const bottom = -3;
    const yc = (top + bottom) / 2;
    parts.concrete.beam(
      bridgePoint(f, s0, 0, yc),
      bridgePoint(f, s1, 0, yc),
      b.width + 1.5,
      top - bottom,
      c.concrete,
      f.v,
    );
    if (portalY !== undefined) {
      // Dark portal where the lower deck runs into the abutment.
      const s = s0 - sgn * 0.05;
      const w = b.width / 2 - 1;
      const p = (l: number, yy: number): V3 => bridgePoint(f, s, l, yy);
      const y0 = portalY;
      const y1 = Math.min(top - 0.6, portalY + 4.6);
      if (sgn === -1) parts.concrete.quad(p(w, y0), p(-w, y0), p(-w, y1), p(w, y1), c.underside);
      else parts.concrete.quad(p(-w, y0), p(w, y0), p(w, y1), p(-w, y1), c.underside);
    }
  }
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

/** True when a pier of depth `d` (along the bridge) at (x, z) would stand on a highway deck. */
function onHighway(x: number, z: number, d: number, highways: readonly HwPath[]): boolean {
  return highways.some((path) => nearestOnPath(path, x, z).d < path.hw.width / 2 + d / 2 + 0.5);
}

/** What pier placement must keep clear of. */
interface Obstacles {
  roads: readonly Road[];
  highways: readonly HwPath[];
}

function pushPiers(
  b: Bridge,
  f: BridgeFrame,
  parts: InfraParts,
  topY: (s: number) => number,
  w: number,
  d: number,
  { roads, highways }: Obstacles,
): void {
  const rotY = Math.atan2(-f.v[2], f.v[0]);
  for (const s of pierStations(b, f)) {
    const p = bridgePoint(f, s, 0, 0);
    parts.columns.push({ x: p[0], z: p[2], y0: -8, y1: topY(s), w, d, rotY, owner: b.id });
  }
  for (const s of approachStations(f)) {
    const p = bridgePoint(f, s, 0, 0);
    const foot = surfaceHeight(p[0], p[2]);
    const top = deckYAt(b, f, s) - DECK_THICKNESS;
    if (top - foot < 1.5) continue;
    if (onHighway(p[0], p[2], 1.8, highways)) continue;
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
    if (approachPierBlocksRoad(column, roads)) continue;
    parts.columns.push(column);
  }
}

/** A: two parabolic arch spans over a center pier, white ribs, cyan points, white hangers. */
function buildArch(
  b: Bridge,
  f: BridgeFrame,
  parts: InfraParts,
  c: InfraColors,
  obstacles: Obstacles,
): void {
  const h = f.spanHalf;
  const springY = b.deckY - 1;
  const crownY = b.deckY + b.structureH;
  const ribL = b.width / 2 + 1.2;
  for (const [s0, s1] of [
    [-h, 0],
    [0, h],
  ] as const) {
    for (const sgn of [-1, 1] as const) {
      const l = sgn * ribL;
      const pts: V3[] = [];
      for (let i = 0; i <= 32; i++) {
        const s = s0 + ((s1 - s0) * i) / 32;
        pts.push(bridgePoint(f, s, l, archY(s, s0, s1, springY, crownY)));
      }
      parts.steel.sweep(framesAlong(pts), boxEdges(-0.8, 0.8, -1.1, 1.1, c.archSteel));
      // Cyan points along the rib crest, every 6 m of arc length.
      for (const p of resample(pts, 6)) {
        parts.points.push({
          p: [p[0], p[1] + 1.25, p[2]],
          size: [0.7, 0.7, 0.7],
          rotY: 0,
          color: c.archPoint,
        });
      }
      // White hangers every 6 m where the rib clears the deck.
      for (let s = s0 + 6; s < s1 - 3; s += 6) {
        const ry = archY(s, s0, s1, springY, crownY) - 1.1;
        if (ry - b.deckY < 2) continue;
        parts.glow.beam(
          bridgePoint(f, s, l, b.deckY + 0.3),
          bridgePoint(f, s, l, ry),
          0.14,
          0.14,
          c.hanger,
        );
      }
    }
    // Wind bracing between the ribs near the crown.
    for (let s = s0 + 12; s < s1 - 6; s += 12) {
      const ry = archY(s, s0, s1, springY, crownY);
      if (ry - b.deckY < 10) continue;
      parts.steel.beam(
        bridgePoint(f, s, -ribL, ry),
        bridgePoint(f, s, ribL, ry),
        0.9,
        0.9,
        c.archSteel,
      );
    }
  }
  // Rib springings rest on wide pier / abutment heads.
  pushPiers(b, f, parts, () => b.deckY - DECK_THICKNESS, b.width + 5, 6, obstacles);
}

/** B: continuous Warren truss over three spans, orange top chord line, white rail dots. */
function buildTruss(
  b: Bridge,
  f: BridgeFrame,
  parts: InfraParts,
  c: InfraColors,
  obstacles: Obstacles,
): void {
  const h = f.spanHalf;
  const panel = (2 * h) / Math.max(1, Math.round((2 * h) / 10));
  const yb = b.deckY - 0.4;
  const yt = b.deckY + b.structureH;
  const lt = b.width / 2 + 0.5;
  for (const sgn of [-1, 1] as const) {
    const l = sgn * lt;
    const P = (s: number, y: number): V3 => bridgePoint(f, s, l, y);
    parts.steel.beam(P(-h, yb), P(h, yb), 0.9, 1.0, c.archSteel, f.v);
    parts.steel.beam(P(-h + panel / 2, yt), P(h - panel / 2, yt), 0.9, 0.9, c.archSteel, f.v);
    for (let s = -h; s < h - 1e-6; s += panel) {
      const m = s + panel / 2;
      parts.steel.beam(P(s, yb), P(m, yt), 0.7, 0.7, c.archSteel, f.v);
      parts.steel.beam(P(m, yt), P(s + panel, yb), 0.7, 0.7, c.archSteel, f.v);
    }
    // Orange line along the top chord crest.
    parts.glow.beam(
      P(-h + panel / 2, yt + 0.5),
      P(h - panel / 2, yt + 0.5),
      0.3,
      0.12,
      c.trussLine,
      f.v,
    );
    // White dots on the rail every 4 m, approaches included.
    for (let s = f.landA + 2; s <= f.landB - 2; s += 4) {
      const y = deckYAt(b, f, s);
      parts.points.push({
        p: bridgePoint(f, s, sgn * (b.width / 2 - 0.2), y + 1.3),
        size: [0.2, 0.2, 0.2],
        rotY: 0,
        color: c.railDot,
      });
    }
  }
  // Top lateral struts at every top node.
  for (let s = -h + panel / 2; s <= h - panel / 2 + 1e-6; s += panel) {
    parts.steel.beam(bridgePoint(f, s, -lt, yt), bridgePoint(f, s, lt, yt), 0.5, 0.6, c.archSteel);
  }
  const lowY = lowerDeckY(b);
  const top = lowY === undefined ? b.deckY - DECK_THICKNESS - 0.4 : lowY - DECK_THICKNESS;
  pushPiers(b, f, parts, () => top, b.width - 2, 4, obstacles);
}

/** Lower deck between the abutments, posts up to the upper deck, red band on both fascias. */
function buildLowerDeck(
  b: Bridge,
  f: BridgeFrame,
  parts: InfraParts,
  c: InfraColors,
  lowY: number,
): void {
  const h = f.spanHalf;
  const half = b.width / 2;
  buildDeck(b, f, parts, c, -h - ABUT / 2, h + ABUT / 2, () => lowY, c.steel);
  for (let s = -h + 5; s < h; s += 10) {
    for (const sgn of [-1, 1] as const) {
      const l = sgn * (half - 0.7);
      parts.steel.beam(
        bridgePoint(f, s, l, lowY + 1.2),
        bridgePoint(f, s, l, b.deckY - DECK_THICKNESS),
        0.8,
        0.8,
        c.steel,
      );
    }
  }
  const lowFrames = framesAlong([
    bridgePoint(f, -h, 0, lowY),
    bridgePoint(f, 0, 0, lowY),
    bridgePoint(f, h, 0, lowY),
  ]);
  for (const sgn of [-1, 1] as const) {
    const l0 = sgn === 1 ? half : -half - 0.06;
    parts.glow.sweep(lowFrames, boxEdges(l0, l0 + 0.06, -0.62, -0.32, c.lowerDeckBand));
  }
}

/** Cyan uplight washes on both river-facing faces of every river pier. */
function buildPierWashes(
  b: Bridge,
  f: BridgeFrame,
  parts: InfraParts,
  c: InfraColors,
  pierW: number,
  pierD: number,
  top: number,
): void {
  const waterY = RIVER.waterY;
  // A pier head this close to the water leaves no face to light.
  if (top - waterY < 2) return;
  for (const s0 of pierStations(b, f)) {
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
          const col: RGB = [c.uplight[0] * m, c.uplight[1] * m, c.uplight[2] * m];
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
      parts.glow.beam(p(-w, waterY + 0.4), p(w, waterY + 0.4), 0.25, 0.25, c.uplightStrip);
    }
  }
}

/**
 * Girder piers under the lowest deck, with uplights. Used by 'doubleDeck' and by every kind
 * this module does not know, so any span length, width, deck height or lower deck renders.
 */
function buildGirder(
  b: Bridge,
  f: BridgeFrame,
  parts: InfraParts,
  c: InfraColors,
  obstacles: Obstacles,
): void {
  const pierW = Math.max(4, b.width - 4);
  const pierD = 3.5;
  const top = (lowerDeckY(b) ?? b.deckY) - DECK_THICKNESS;
  pushPiers(b, f, parts, () => top, pierW, pierD, obstacles);
  buildPierWashes(b, f, parts, c, pierW, pierD, top - 0.2);
}

const BUILDERS: Record<
  BridgeShape,
  (b: Bridge, f: BridgeFrame, parts: InfraParts, c: InfraColors, o: Obstacles) => void
> = {
  arch: buildArch,
  truss: buildTruss,
  doubleDeck: buildGirder,
  girder: buildGirder,
};

/**
 * `roads`: ground roads approach piers must not stand on (the layout's `roads`).
 * `highways`: decks approach piers must not stand on.
 */
export function buildBridge(
  b: Bridge,
  parts: InfraParts,
  c: InfraColors,
  roads: readonly Road[] = [],
  highways: readonly HwPath[] = [],
): BridgeFrame {
  const f = bridgeFrame(b);
  const shape = bridgeShape(b);
  const lowY = lowerDeckY(b);
  const deckY = (s: number): number => deckYAt(b, f, s);
  buildDeck(b, f, parts, c, f.landA, f.landB, deckY, shape === 'arch' ? c.archSteel : c.steel);
  buildAbutments(b, f, parts, c, lowY);
  if (lowY !== undefined) buildLowerDeck(b, f, parts, c, lowY);
  BUILDERS[shape](b, f, parts, c, { roads, highways });
  return f;
}
