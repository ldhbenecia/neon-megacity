// Deck cross-sections and lane geometry (pure). Profiles are lists of edges in the (l, y)
// plane, l = lateral offset (+ = right of travel along the curve), y = height above the deck
// surface. Loops run clockwise so MeshData.sweep gives outward normals.
import { MAX_DECK_THICKNESS, type Highway } from '../city/layout';
import type { ProfileEdge, RGB } from './mesh';

/**
 * Deck slab thickness (m): the underside is at deck y − DECK_THICKNESS (InfraApi). Equal to the
 * layout's MAX_DECK_THICKNESS, which its road clearance guarantee assumes.
 */
export const DECK_THICKNESS = MAX_DECK_THICKNESS;
/** Jersey barrier: base width, top width, height. */
export const BARRIER = { base: 0.5, top: 0.25, h: 0.95 } as const;
/** Median barrier width for divided roads (lanes ≥ 4). */
export const MEDIAN = 0.8;
/** Shoulder between the outer edge line and the barrier foot. */
export const SHOULDER = 0.6;
/** Sound wall height above the deck and thickness. */
export const SOUND_WALL = { h: 3.6, t: 0.3 } as const;

export interface DeckColors {
  asphalt: RGB;
  concrete: RGB;
  underside: RGB;
}

/** True for roads with a central median barrier (two directions of travel). */
export function isDivided(hw: Pick<Highway, 'lanes' | 'kind'>): boolean {
  return hw.kind !== 'ramp' && hw.lanes >= 4;
}

/**
 * Lane center offsets (m from the centerline, + = right of the curve direction), sorted
 * left to right. Divided roads split lanes evenly around the median; ramps are one-way.
 * Neon traffic can use these to put headlight streams on real lanes.
 */
export function laneOffsets(hw: Pick<Highway, 'lanes' | 'kind' | 'width'>): number[] {
  const half = hw.width / 2;
  const edge = half - BARRIER.base - SHOULDER;
  if (!isDivided(hw)) {
    const lw = (2 * edge) / hw.lanes;
    return Array.from({ length: hw.lanes }, (_, i) => -edge + lw * (i + 0.5));
  }
  const inner = MEDIAN / 2 + SHOULDER / 2;
  const per = hw.lanes / 2;
  const lw = (edge - inner) / per;
  const right = Array.from({ length: per }, (_, i) => inner + lw * (i + 0.5));
  return [...right.map((o) => -o).reverse(), ...right];
}

/** Lane width (m) for a highway (all lanes share it). */
export function laneWidth(hw: Pick<Highway, 'lanes' | 'kind' | 'width'>): number {
  const o = laneOffsets(hw);
  return o.length > 1 ? (o[1] as number) - (o[0] as number) : hw.width;
}

/**
 * Painted line offsets: solid edge lines and dashed lane dividers. Divided roads get solid
 * lines on both sides of the median.
 */
export function markingLines(
  hw: Pick<Highway, 'lanes' | 'kind' | 'width'>,
): { l: number; dashed: boolean; yellow: boolean }[] {
  const o = laneOffsets(hw);
  const lw = laneWidth(hw);
  const out: { l: number; dashed: boolean; yellow: boolean }[] = [];
  for (let i = 0; i < o.length; i++) {
    const c = o[i] as number;
    const leftEdge = c - lw / 2;
    if (i === 0) out.push({ l: leftEdge, dashed: false, yellow: false });
    const next = o[i + 1];
    if (next === undefined) {
      out.push({ l: c + lw / 2, dashed: false, yellow: false });
    } else if (next - c > lw + 1e-6) {
      // Gap = median.
      out.push({ l: c + lw / 2, dashed: false, yellow: true });
      out.push({ l: next - lw / 2, dashed: false, yellow: true });
    } else {
      out.push({ l: c + lw / 2, dashed: true, yellow: false });
    }
  }
  return out;
}

type P = readonly [number, number];

function loopEdges(points: readonly P[], colors: readonly RGB[]): ProfileEdge[] {
  return points.map((a, i) => ({
    a,
    b: points[(i + 1) % points.length] as P,
    color: colors[i] as RGB,
  }));
}

/**
 * Deck slab loop (without barriers): top surface, vertical fascias, tapered box-girder
 * underside. Convex, so it can be capped with a fan. Clockwise in (l, y).
 */
export function slabLoop(width: number, thickness = DECK_THICKNESS): P[] {
  const h = width / 2;
  const fascia = Math.min(0.7, thickness * 0.4);
  const bottom = h * 0.55;
  return [
    [-h, 0],
    [h, 0],
    [h, -fascia],
    [bottom, -thickness],
    [-bottom, -thickness],
    [-h, -fascia],
  ];
}

export function slabEdges(width: number, c: DeckColors, thickness = DECK_THICKNESS): ProfileEdge[] {
  const pts = slabLoop(width, thickness);
  return loopEdges(pts, [c.asphalt, c.concrete, c.underside, c.underside, c.underside, c.concrete]);
}

/** Jersey barrier standing on the deck at lateral `l` (outer face flush with `l`). */
export function barrierEdges(l: number, side: 1 | -1, color: RGB): ProfileEdge[] {
  const o = l; // outer face
  const i0 = l - side * BARRIER.base;
  const i1 = l - side * (BARRIER.base - (BARRIER.base - BARRIER.top) * 0.85);
  const t = l - side * BARRIER.top;
  // Clockwise loop in (l, y) for side = +1: inner foot → top inner → top outer → outer foot.
  const pts: P[] =
    side === 1
      ? [
          [i0, 0],
          [i1, 0.3],
          [t, BARRIER.h],
          [o, BARRIER.h],
          [o, -0.05],
          [i0, -0.05],
        ]
      : [
          [o, -0.05],
          [o, BARRIER.h],
          [t, BARRIER.h],
          [i1, 0.3],
          [i0, 0],
          [i0, -0.05],
        ];
  // Drop the bottom edge (hidden in the slab).
  return loopEdges(
    pts,
    pts.map(() => color),
  ).filter((e) => !(e.a[1] < 0 && e.b[1] < 0));
}

/** Central median barrier (symmetric jersey). */
export function medianEdges(color: RGB): ProfileEdge[] {
  const b = MEDIAN / 2;
  const t = BARRIER.top / 2;
  const pts: P[] = [
    [-b, 0],
    [-t * 1.6, 0.3],
    [-t, BARRIER.h],
    [t, BARRIER.h],
    [t * 1.6, 0.3],
    [b, 0],
  ];
  return pts.slice(0, -1).map((a, i) => ({ a, b: pts[i + 1] as P, color }));
}

/** Rectangle loop (clockwise) — sound walls, rails, glow bars. */
export function boxEdges(
  l0: number,
  l1: number,
  y0: number,
  y1: number,
  color: RGB,
): ProfileEdge[] {
  const pts: P[] = [
    [l0, y1],
    [l1, y1],
    [l1, y0],
    [l0, y0],
  ];
  return loopEdges(
    pts,
    pts.map(() => color),
  );
}

/** boxEdges without the bottom edge, for strips lying on a surface. */
export function openBoxEdges(
  l0: number,
  l1: number,
  y0: number,
  y1: number,
  color: RGB,
): ProfileEdge[] {
  return boxEdges(l0, l1, y0, y1, color).filter((_, i) => i !== 2);
}

/** Clockwise-ness check used by tests: signed area < 0 means clockwise in (l, y). */
export function signedArea(points: readonly P[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as P;
    const q = points[(i + 1) % points.length] as P;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
