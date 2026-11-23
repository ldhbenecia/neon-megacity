// Elevated highway decks, ramps, barriers, sound walls, lane paint, median lamps and their
// static glow lines (ART_DIRECTION 2.5). Pure: reads the layout, writes InfraParts.
import type { CatmullRomCurve3 } from 'three';
import { CITY, highwayCurve, type Highway } from '../city/layout';
import { clamp } from '../city/math';
import type { InfraColors } from './colors';
import { framesAlong, frameAt, type Frame, type V3 } from './mesh';
import { rotYForLateral, type InfraParts } from './parts';
import {
  BARRIER,
  DECK_THICKNESS,
  SOUND_WALL,
  barrierEdges,
  boxEdges,
  isDivided,
  markingLines,
  medianEdges,
  slabEdges,
  slabLoop,
} from './profile';

/** Deck ring spacing along the curve (m). */
export const RING_STEP = 6;
/** At-grade road slab: surface y comes from the layout, slab goes this far down. */
const AT_GRADE_THICKNESS = 0.6;
/** Two decks closer than this in height count as the same level (ramp junctions). */
export const SAME_LEVEL = 4;
/** Ramps sink this far below the parent deck where they overlap, to avoid z-fighting. */
const OVERLAP_SINK = 0.06;
const DASH = 6;
const DASH_GAP = 9;
const PAINT_W = 0.15;
const PAINT_Y = 0.02;

export interface DeckRing {
  /** Deck surface point (y possibly sunk under a parent deck). */
  p: V3;
  t: V3;
  /** Sweep frame at (p, t), computed once and shared by every sweep over this ring. */
  f: Frame;
  /** Arc length from the curve start (m). */
  s: number;
  /** Ramp ring fully inside another deck: not drawn. */
  hidden: boolean;
  /** Ramp ring overlapping another deck: no paint, lamps. */
  overlap: boolean;
  /** Barrier / sound wall allowed on the left (l < 0) and right side. */
  barrierL: boolean;
  barrierR: boolean;
}

/** Path samples of a highway for nearest-point queries. */
export interface HwPath {
  hw: Highway;
  curve: CatmullRomCurve3;
  pts: V3[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function hwPath(hw: Highway, step = RING_STEP): HwPath {
  const curve = highwayCurve(hw);
  const n = Math.max(2, Math.ceil(curve.getLength() / step));
  const pts = curve.getSpacedPoints(n).map((v): V3 => [v.x, v.y, v.z]);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[2]);
    maxZ = Math.max(maxZ, p[2]);
  }
  return { hw, curve, pts, minX, maxX, minZ, maxZ };
}

/** Horizontal distance from (x, z) to a highway centerline polyline, and the deck y there. */
export function nearestOnPath(path: HwPath, x: number, z: number): { d: number; y: number } {
  const pad = path.hw.width;
  if (x < path.minX - pad || x > path.maxX + pad || z < path.minZ - pad || z > path.maxZ + pad) {
    return { d: Infinity, y: 0 };
  }
  // Compare squared distances; one sqrt for the winner.
  let best2 = Infinity;
  let y = 0;
  const pts = path.pts;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i] as V3;
    const b = pts[i + 1] as V3;
    const abx = b[0] - a[0];
    const abz = b[2] - a[2];
    const l2 = abx * abx + abz * abz || 1;
    const t = clamp(((x - a[0]) * abx + (z - a[2]) * abz) / l2, 0, 1);
    const dx = x - (a[0] + abx * t);
    const dz = z - (a[2] + abz * t);
    const d2 = dx * dx + dz * dz;
    if (d2 < best2) {
      best2 = d2;
      y = a[1] + (b[1] - a[1]) * t;
    }
  }
  return { d: Math.sqrt(best2), y };
}

const isRaised = (hw: Highway): boolean => hw.kind !== 'atGrade';

/**
 * Deck rings for one highway, with ramp junction handling against the other raised decks:
 * ramp rings fully inside a parent deck are hidden, overlapping rings sink just below the
 * parent surface, and barriers are cut wherever they would cross another deck at the same level.
 */
export function deckRings(path: HwPath, others: readonly HwPath[]): DeckRing[] {
  const { hw, curve } = path;
  const half = hw.width / 2;
  const n = path.pts.length - 1;
  const length = curve.getLength();
  const level = others.filter((o) => o.hw.id !== hw.id && isRaised(o.hw) && isRaised(hw));
  return path.pts.map((p0, i) => {
    const u = i / n;
    const tv = curve.getTangentAt(Math.min(1, u));
    const t: V3 = [tv.x, tv.y, tv.z];
    let p: V3 = p0;
    let hidden = false;
    let overlap = false;
    for (const o of level) {
      const q = nearestOnPath(o, p0[0], p0[2]);
      if (Math.abs(q.y - p0[1]) > SAME_LEVEL) continue;
      const oh = o.hw.width / 2;
      if (hw.kind === 'ramp' && q.d < oh + half) {
        overlap = true;
        if (q.d < oh - half) hidden = true;
        p = [p[0], Math.min(p[1], q.y - OVERLAP_SINK), p[2]];
      }
    }
    const f = frameAt(p, t);
    const side = (sgn: 1 | -1): boolean => {
      const l = sgn * (half - BARRIER.base / 2);
      const bx = p[0] + f.lat[0] * l;
      const bz = p[2] + f.lat[2] * l;
      for (const o of level) {
        const q = nearestOnPath(o, bx, bz);
        if (Math.abs(q.y - p[1]) > SAME_LEVEL) continue;
        if (q.d < o.hw.width / 2 + 0.2) return false;
      }
      return true;
    };
    return {
      p,
      t,
      f,
      s: u * length,
      hidden,
      overlap,
      barrierL: !hidden && side(-1),
      barrierR: !hidden && side(1),
    };
  });
}

/** Contiguous index runs where `keep(i)` holds (each run ≥ 2 rings). */
export function runs<T>(items: readonly T[], keep: (item: T, i: number) => boolean): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  items.forEach((it, i) => {
    if (keep(it, i)) {
      cur.push(it);
    } else {
      if (cur.length >= 2) out.push(cur);
      cur = [];
    }
  });
  if (cur.length >= 2) out.push(cur);
  return out;
}

const framesOf = (rings: readonly DeckRing[]): Frame[] => rings.map((r) => r.f);
const barrierOk =
  (sgn: -1 | 1) =>
  (r: DeckRing): boolean =>
    sgn === -1 ? r.barrierL : r.barrierR;
const ringAt = (rings: readonly DeckRing[], s: number, length: number): DeckRing | undefined =>
  rings[Math.round((s / length) * (rings.length - 1))];

/** Every ring touched by the arc-length interval [s0, s1] (both neighbours of each end included). */
export function ringsCovering(
  rings: readonly DeckRing[],
  s0: number,
  s1: number,
  length: number,
): DeckRing[] {
  const n = rings.length - 1;
  const i0 = Math.max(0, Math.floor((s0 / length) * n));
  const i1 = Math.min(n, Math.ceil((s1 / length) * n));
  return rings.slice(i0, i1 + 1);
}

/** Which side gets a sound wall: the city side of hw-river-north, the park side of hw-south. */
function soundWallSide(hw: Highway): -1 | 0 {
  // Both riverside highways run west → east, so their left (l < 0) is north.
  return hw.id === 'hw-river-north' || hw.id === 'hw-south' ? -1 : 0;
}

function buildHighway(
  path: HwPath,
  others: readonly HwPath[],
  parts: InfraParts,
  c: InfraColors,
): void {
  const { hw } = path;
  const rings = deckRings(path, others);
  const half = hw.width / 2;
  const thick = hw.kind === 'atGrade' ? AT_GRADE_THICKNESS : DECK_THICKNESS;
  const slab = slabEdges(hw.width, c, thick);
  const loop = slabLoop(hw.width, thick);

  // Slab (with end caps on open curves).
  for (const run of runs(rings, (r) => !r.hidden)) {
    const frames = framesOf(run);
    parts.concrete.sweep(frames, slab);
    if (!hw.closed) {
      parts.concrete.cap(frames[0] as Frame, loop, c.concrete, -1);
      parts.concrete.cap(frames[frames.length - 1] as Frame, loop, c.concrete, 1);
    }
  }

  // Edge barriers.
  for (const sgn of [-1, 1] as const) {
    const edges = barrierEdges(sgn * half, sgn, c.concrete);
    for (const run of runs(rings, barrierOk(sgn))) parts.concrete.sweep(framesOf(run), edges);
  }
  if (isDivided(hw)) {
    for (const run of runs(rings, (r) => !r.hidden)) {
      parts.concrete.sweep(framesOf(run), medianEdges(c.concrete));
    }
  }

  // Sound wall on top of one barrier, with a teal band along its crest.
  const wall = soundWallSide(hw);
  if (wall !== 0) {
    const lo = wall * half;
    const li = wall * (half - SOUND_WALL.t);
    const [l0, l1] = lo < li ? [lo, li] : [li, lo];
    for (const run of runs(rings, barrierOk(wall))) {
      const frames = framesOf(run);
      parts.concrete.sweep(frames, boxEdges(l0, l1, BARRIER.h - 0.05, SOUND_WALL.h, c.concrete));
      parts.glow.sweep(
        frames,
        boxEdges(l0 - 0.03, l1 + 0.03, SOUND_WALL.h, SOUND_WALL.h + 0.22, c.wallBand),
      );
    }
  }

  // Ring road: thin cyan line on both fascias.
  if (hw.id === 'hw-ring') {
    for (const sgn of [-1, 1] as const) {
      const l0 = sgn === 1 ? half : -half - 0.06;
      for (const run of runs(rings, barrierOk(sgn))) {
        parts.glow.sweep(framesOf(run), boxEdges(l0, l0 + 0.06, -0.5, -0.36, c.ringLine));
      }
    }
  }

  buildMarkings(path, rings, parts, c);
  if (isDivided(hw) && isRaised(hw)) buildLamps(path, rings, parts, c);
}

/** Lane paint: solid lines as strips over the kept rings, dashes every DASH + DASH_GAP m. */
function buildMarkings(path: HwPath, rings: DeckRing[], parts: InfraParts, c: InfraColors): void {
  const { hw, curve } = path;
  const length = curve.getLength();
  const paintable = (r: DeckRing): boolean => !r.hidden && !r.overlap;
  const paintRuns = runs(rings, paintable).map(framesOf);
  for (const line of markingLines(hw)) {
    const color = line.yellow ? c.paintYellow : c.paintWhite;
    const edge = [
      {
        a: [line.l - PAINT_W / 2, PAINT_Y] as const,
        b: [line.l + PAINT_W / 2, PAINT_Y] as const,
        color,
      },
    ];
    if (!line.dashed) {
      for (const frames of paintRuns) parts.markings.sweep(frames, edge);
      continue;
    }
    for (let s = DASH_GAP / 2; s + DASH < length; s += DASH + DASH_GAP) {
      // Every ring under the dash must be paintable, or it pokes out over a parent deck.
      const under = ringsCovering(rings, s, s + DASH, length);
      if (under.length === 0 || !under.every(paintable)) continue;
      const pts: V3[] = [s, s + DASH / 2, s + DASH].map((d) => {
        const v = curve.getPointAt(d / length);
        return [v.x, v.y, v.z];
      });
      parts.markings.sweep(framesAlong(pts), edge);
    }
  }
}

/** Median lamp posts with two sodium heads, one per pillar bay. */
function buildLamps(path: HwPath, rings: DeckRing[], parts: InfraParts, c: InfraColors): void {
  const { hw, curve } = path;
  const length = curve.getLength();
  const spacing = hw.pillarSpacing > 0 ? hw.pillarSpacing : 36;
  const poleH = 11;
  const arm = 2.6;
  for (let s = spacing / 2; s < length; s += spacing) {
    const r = ringAt(rings, s, length);
    if (!r || r.hidden || r.overlap) continue;
    const v = curve.getPointAt(s / length);
    const tv = curve.getTangentAt(s / length);
    if (Math.abs(v.x) > CITY.halfX || Math.abs(v.z) > CITY.halfZ) continue;
    const f = frameAt([v.x, v.y, v.z], [tv.x, tv.y, tv.z]);
    const base: V3 = [v.x, v.y + BARRIER.h, v.z];
    const top: V3 = [v.x, v.y + poleH, v.z];
    parts.steel.beam(base, top, 0.28, 0.28, c.steel);
    for (const sgn of [-1, 1] as const) {
      const end: V3 = [v.x + f.lat[0] * sgn * arm, v.y + poleH - 0.2, v.z + f.lat[2] * sgn * arm];
      parts.steel.beam(top, end, 0.16, 0.16, c.steel);
      parts.points.push({
        p: [end[0], end[1] - 0.25, end[2]],
        size: [0.55, 0.14, 0.32],
        rotY: rotYForLateral(f.lat),
        color: c.lamp,
      });
    }
  }
}

export function buildHighways(paths: readonly HwPath[], parts: InfraParts, c: InfraColors): void {
  for (const p of paths) buildHighway(p, paths, parts, c);
}
