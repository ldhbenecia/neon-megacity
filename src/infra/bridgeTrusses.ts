// Through trusses. The style follows the bridge's motif:
// - default (layout v2): continuous Warren, orange top chord line, white rail dots;
// - railTruss (한강철교): one Pratt truss per span and per track bay, planes between the tracks,
//   white points on the top nodes;
// - subwayDeck (동호대교): one Warren truss per span with a curved top chord and a cyan line on it;
// - orangeChord (성수대교): continuous red lattice (crossed diagonals), orange points where the
//   diagonals cross, white rail dots.
// Spans over a stop island carry no truss.
import type { Bridge } from '../city/layout';
import {
  bridgePoint,
  deckYAt,
  pushPiers,
  spanList,
  type BridgeBuilder,
  type BridgeFrame,
  type BridgeParts,
  bridgeS,
} from './bridgeFrame';
import type { InfraColors } from './colors';
import { framesAlong, type MeshData, type RGB, type V3 } from './mesh';
import { DECK_THICKNESS, boxEdges } from './profile';

type Web = 'warren' | 'pratt' | 'lattice';

interface TrussStyle {
  web: Web;
  /** Target panel length (m). */
  panel: number;
  /** One truss over all spans (true) or one per span. */
  continuous: boolean;
  /** Top chord rises toward mid-span (camelback). */
  curved: boolean;
  color: (c: InfraColors) => RGB;
  /** Glow line along each plane's top chord. */
  line?: (c: InfraColors) => RGB;
  /** Dots on every other top node of the outer planes. */
  nodeDots?: boolean;
  /** Diamond points where the lattice diagonals cross. */
  crossDots?: boolean;
  /** White dots on the deck rail, approaches included. */
  railDots: boolean;
}

const steel = (c: InfraColors): RGB => c.archSteel;

const DEFAULT_STYLE: TrussStyle = {
  web: 'warren',
  panel: 10,
  continuous: true,
  curved: false,
  color: steel,
  line: (c) => c.trussLine,
  railDots: true,
};

const STYLES: Record<string, TrussStyle> = {
  railTruss: {
    web: 'pratt',
    panel: 12,
    continuous: false,
    curved: false,
    color: steel,
    nodeDots: true,
    railDots: false,
  },
  subwayDeck: {
    web: 'warren',
    panel: 11,
    continuous: false,
    curved: true,
    color: steel,
    line: (c) => c.chordCyan,
    railDots: false,
  },
  orangeChord: {
    web: 'lattice',
    panel: 10,
    continuous: true,
    curved: false,
    color: (c) => c.trussRed,
    crossDots: true,
    railDots: true,
  },
};

export function trussStyle(b: Bridge): TrussStyle {
  return (Object.hasOwn(STYLES, b.motif) ? STYLES[b.motif] : undefined) ?? DEFAULT_STYLE;
}

/** Lateral positions of the truss planes: the deck edges, plus one between tracks of a rail bridge. */
export function trussPlanes(b: Bridge): number[] {
  const lt = b.width / 2 + 0.5;
  if (b.motif !== 'railTruss') return [-lt, lt];
  const bays = Math.max(1, Math.round(b.lanes));
  return Array.from({ length: bays + 1 }, (_, k) => -lt + (2 * lt * k) / bays);
}

interface Plane {
  /** Top chord nodes (world). */
  top: V3[];
  /** Where the diagonals cross (lattice only). */
  crossings: V3[];
}

/** Members of one truss plane at lateral `l` between s0 and s1. */
function buildPlane(
  steel: MeshData,
  f: BridgeFrame,
  l: number,
  s0: number,
  s1: number,
  yb: number,
  yt: (s: number) => number,
  style: TrussStyle,
  color: RGB,
): Plane {
  const n = Math.max(2, Math.round((s1 - s0) / style.panel));
  const p = (s1 - s0) / n;
  const P = (s: number, y: number): V3 => bridgePoint(f, s, l, y);
  const beam = (a: V3, e: V3, w: number): void => steel.beam(a, e, w, w, color, f.v);
  steel.beam(P(s0, yb), P(s1, yb), 0.9, 1.0, color, f.v);
  const node = (i: number): number => s0 + i * p;
  const topS =
    style.web === 'warren'
      ? Array.from({ length: n }, (_, i) => node(i) + p / 2)
      : Array.from({ length: n + 1 }, (_, i) => node(i));
  const top = topS.map((s) => P(s, yt(s)));
  for (let i = 0; i < top.length - 1; i++) beam(top[i] as V3, top[i + 1] as V3, 0.9);
  const crossings: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = node(i);
    const e = node(i + 1);
    if (style.web === 'warren') {
      const t = top[i] as V3;
      beam(P(a, yb), t, 0.7);
      beam(t, P(e, yb), 0.7);
      continue;
    }
    if (style.web === 'pratt') {
      // Diagonals lean toward mid-span; verticals at every node.
      const toMid = a + p / 2 < (s0 + s1) / 2;
      beam(toMid ? P(a, yt(a)) : P(a, yb), toMid ? P(e, yb) : P(e, yt(e)), 0.6);
      if (i > 0) beam(P(a, yb), P(a, yt(a)), 0.55);
      continue;
    }
    beam(P(a, yb), P(e, yt(e)), 0.55);
    beam(P(a, yt(a)), P(e, yb), 0.55);
    crossings.push(P((a + e) / 2, (yb + (yt(a) + yt(e)) / 2) / 2));
  }
  if (style.web !== 'warren') {
    beam(P(s0, yb), P(s0, yt(s0)), 0.8);
    beam(P(s1, yb), P(s1, yt(s1)), 0.8);
  }
  return { top, crossings };
}

const point = (parts: BridgeParts, p: V3, size: number, color: RGB): void => {
  parts.points.push({ p, size: [size, size, size], rotY: 0, color });
};

export const buildTruss: BridgeBuilder = (b, f, parts, c, obstacles) => {
  const style = trussStyle(b);
  const color = style.color(c);
  const yb = b.deckY - 0.4;
  const H = b.structureH > 0 ? b.structureH : 10;
  const placed = pushPiers(b, f, parts, b.deckY - DECK_THICKNESS - 0.4, b.width - 2, 4, obstacles);
  const runs = style.continuous
    ? [{ s0: -f.spanHalf, s1: f.spanHalf }]
    : spanList(b, f, placed).filter((sp) => !sp.island);
  const planes = trussPlanes(b);
  for (const run of runs) {
    const mid = (run.s0 + run.s1) / 2;
    const half = (run.s1 - run.s0) / 2;
    const yt = (s: number): number => {
      if (!style.curved) return b.deckY + H;
      const k = (s - mid) / half;
      return b.deckY + H * (0.6 + 0.4 * (1 - k * k));
    };
    let first: Plane | undefined;
    for (const [k, l] of planes.entries()) {
      const plane = buildPlane(parts.steel, f, l, run.s0, run.s1, yb, yt, style, color);
      first ??= plane;
      // Outer planes only, every other node: a dot on every node of every plane reads as a grid.
      const outer = k === 0 || k === planes.length - 1;
      if (style.nodeDots && outer) {
        plane.top.forEach((t, i) => {
          if (i % 2 === 0) point(parts, [t[0], t[1] + 0.7, t[2]], 0.35, c.railDot);
        });
      }
      if (style.crossDots) for (const x of plane.crossings) point(parts, x, 0.45, c.diamondPoint);
      const lineColor = style.line?.(c);
      if (lineColor) {
        const line = plane.top.map((t): V3 => [t[0], t[1] + 0.5, t[2]]);
        parts.glow.sweep(framesAlong(line), boxEdges(-0.15, 0.15, -0.06, 0.06, lineColor));
      }
    }
    const lo = planes[0] as number;
    const hi = planes[planes.length - 1] as number;
    for (const t of first?.top ?? []) {
      const s = bridgeS(f, t[0], t[2]);
      parts.detail.steel.beam(
        bridgePoint(f, s, lo, t[1]),
        bridgePoint(f, s, hi, t[1]),
        0.5,
        0.6,
        color,
      );
    }
  }
  if (style.railDots) {
    for (const sgn of [-1, 1] as const) {
      for (let s = f.landA + 2; s <= f.landB - 2; s += 4) {
        point(
          parts,
          bridgePoint(f, s, sgn * (b.width / 2 - 0.2), deckYAt(b, f, s) + 1.3),
          0.2,
          c.railDot,
        );
      }
    }
  }
};
