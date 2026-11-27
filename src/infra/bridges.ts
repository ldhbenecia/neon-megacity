// Bridges (SEOUL.md 3.3): one builder per structural kind, plus a plain girder for any kind this
// module does not know yet, with their static lights. Each follows only the real bridge's
// structural type and position; proportions and decoration are original. Pure: reads a Bridge
// from the layout and writes InfraParts.
import { RIVER, type Bridge, type Road } from '../city/layout';
import { buildArch, buildDeckArch, buildTiedArch } from './bridgeArches';
import { buildCableStayed } from './bridgeCable';
import {
  ABUT,
  bridgeFrame,
  bridgePoint,
  bridgeShape,
  buildPierWashes,
  islandWashColor,
  deckYAt,
  lowerDeckY,
  pushPiers,
  type BridgeBuilder,
  type BridgeFrame,
  type BridgeParts,
  type BridgeShape,
} from './bridgeFrame';
import { buildTruss } from './bridgeTrusses';
import type { InfraColors } from './colors';
import type { HwPath } from './highways';
import { DiscardMeshData, MeshData, framesAlong, type Frame, type RGB, type V3 } from './mesh';
import type { InfraParts } from './parts';
import {
  DECK_THICKNESS,
  boxEdges,
  markingLines,
  openBoxEdges,
  slabEdges,
  slabLoop,
} from './profile';

export * from './bridgeFrame';

/** Rail-only bridge (한강철교): tracks across the whole deck, no road. */
export const railOnly = (b: Bridge): boolean => b.motif === 'railTruss';

/** Track bed width of the subway in the middle of a road bridge (two tracks). */
export const TRACK_BED = 8;
/** Rail gauge center to center (m). */
const GAUGE = 1.5;

function deckPath(f: BridgeFrame, from: number, to: number, y: (s: number) => number): V3[] {
  // Break points (ends, abutments where the ramp slope starts) win over 6 m stations near them:
  // a station a few centimetres from a slope break makes a sliver ring whose sides flip.
  const r = (s: number): number => Math.round(s * 1000) / 1000;
  const breaks = [from, to, ...[-f.spanHalf, f.spanHalf].filter((k) => k > from && k < to)];
  const stations = new Set<number>(breaks.map(r));
  for (let s = Math.ceil(from / 6) * 6; s < to; s += 6) {
    if (breaks.every((k) => Math.abs(s - k) >= 1 || r(s) === r(k))) stations.add(r(s));
  }
  return [...stations].sort((p, q) => p - q).map((s) => bridgePoint(f, s, 0, y(s)));
}

/** What runs on a deck: road lanes, a subway down the middle, or tracks only. */
interface DeckUse {
  width: number;
  lanes: number;
  /** Tracks, evenly spread over the deck ('all') or two in a center bed ('center'). */
  tracks: 'none' | 'center' | 'all';
}

/** Slab, curbs, rails, posts, lane paint and tracks of one deck level. */
function buildDeck(
  f: BridgeFrame,
  parts: BridgeParts,
  c: InfraColors,
  from: number,
  to: number,
  y: (s: number) => number,
  railColor: RGB,
  use: DeckUse,
): void {
  const pts = deckPath(f, from, to, y);
  const frames = framesAlong(pts);
  const half = use.width / 2;
  parts.concrete.sweep(frames, slabEdges(use.width, c));
  const loop = slabLoop(use.width);
  parts.concrete.cap(frames[0] as Frame, loop, c.concrete, -1);
  parts.concrete.cap(frames[frames.length - 1] as Frame, loop, c.concrete, 1);
  for (const sgn of [-1, 1] as const) {
    const lo = sgn === 1 ? half - 0.45 : -half;
    parts.concrete.sweep(frames, boxEdges(lo, lo + 0.45, -0.02, 0.5, c.concrete));
    const rl = sgn * (half - 0.2);
    parts.detail.steel.sweep(frames, boxEdges(rl - 0.08, rl + 0.08, 1.05, 1.2, railColor));
  }
  // Rail posts every 6 m.
  for (let s = Math.ceil(from / 6) * 6; s <= to; s += 6) {
    for (const sgn of [-1, 1] as const) {
      const l = sgn * (half - 0.2);
      const yy = y(s);
      parts.detail.steel.beam(
        bridgePoint(f, s, l, yy + 0.5),
        bridgePoint(f, s, l, yy + 1.06),
        0.1,
        0.1,
        railColor,
      );
    }
  }
  const tracks = trackCenters(use);
  if (use.tracks === 'center') {
    const b = TRACK_BED / 2;
    parts.concrete.sweep(frames, openBoxEdges(-b, b, -0.02, 0.3, c.underside));
  }
  for (const t of tracks) {
    if (use.tracks === 'all') {
      parts.concrete.sweep(frames, openBoxEdges(t - 1.6, t + 1.6, -0.02, 0.25, c.underside));
    }
    const top = use.tracks === 'all' ? 0.25 : 0.3;
    for (const g of [-GAUGE / 2, GAUGE / 2]) {
      parts.detail.steel.sweep(
        frames,
        openBoxEdges(t + g - 0.06, t + g + 0.06, top, top + 0.16, c.steel),
      );
    }
  }
  if (use.tracks === 'all') return;
  // Lane paint (bridges: no median barrier, double yellow center line). A center subway bed
  // splits the road into two one-way halves.
  const roads =
    use.tracks === 'center'
      ? [-1, 1].map((sgn) => {
          const w = (use.width - TRACK_BED) / 2;
          return {
            off: sgn * (TRACK_BED / 2 + w / 2),
            w,
            lanes: Math.max(1, Math.floor(use.lanes / 2)),
          };
        })
      : [{ off: 0, w: use.width, lanes: use.lanes }];
  for (const road of roads) {
    const kind = use.tracks === 'center' ? 'ramp' : 'elevated';
    for (const line of markingLines({ lanes: road.lanes, kind, width: road.w })) {
      const color = line.yellow ? c.paintYellow : c.paintWhite;
      const l = road.off + line.l;
      const edge = [{ a: [l - 0.075, 0.02] as const, b: [l + 0.075, 0.02] as const, color }];
      if (!line.dashed) {
        parts.detail.markings.sweep(frames, edge);
        continue;
      }
      for (let s = from + 4; s + 6 < to; s += 15) {
        parts.detail.markings.sweep(
          framesAlong([s, s + 3, s + 6].map((k) => bridgePoint(f, k, 0, y(k)))),
          edge,
        );
      }
    }
  }
}

/** Lateral track centers of a deck. */
export function trackCenters(use: Pick<DeckUse, 'width' | 'lanes' | 'tracks'>): number[] {
  if (use.tracks === 'center') return [-TRACK_BED / 4, TRACK_BED / 4];
  if (use.tracks === 'none') return [];
  const n = Math.max(1, Math.round(use.lanes));
  return Array.from({ length: n }, (_, i) => -use.width / 2 + (use.width * (i + 0.5)) / n);
}

function upperUse(b: Bridge): DeckUse {
  if (railOnly(b)) return { width: b.width, lanes: b.lanes, tracks: 'all' };
  // A rail double-deck bridge carries its trains on the lower deck.
  const center = b.rail && bridgeShape(b) !== 'doubleDeck' && b.width >= TRACK_BED + 12;
  return { width: b.width, lanes: b.lanes, tracks: center ? 'center' : 'none' };
}

/** Lower deck use: a two-track subway deck for rail bridges, otherwise a road up to 18 m wide. */
export function lowerUse(b: Bridge): DeckUse {
  if (b.rail) return { width: Math.min(b.width, 12), lanes: 2, tracks: 'all' };
  const width = Math.min(b.width, 18);
  return { width, lanes: Math.max(2, Math.min(b.lanes, 4)), tracks: 'none' };
}

/** Concrete abutment blocks at both banks (top just under the deck). */
function buildAbutments(
  b: Bridge,
  f: BridgeFrame,
  parts: BridgeParts,
  c: InfraColors,
  portal?: { y: number; width: number },
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
    if (portal !== undefined) {
      // Dark portal where the lower deck runs into the abutment.
      const s = s0 - sgn * 0.05;
      const w = portal.width / 2 - 1;
      const p = (l: number, yy: number): V3 => bridgePoint(f, s, l, yy);
      const y0 = portal.y;
      const y1 = Math.min(top - 0.6, portal.y + 4.6);
      if (y1 - y0 < 0.5) continue;
      if (sgn === -1) parts.concrete.quad(p(w, y0), p(-w, y0), p(-w, y1), p(w, y1), c.underside);
      else parts.concrete.quad(p(-w, y0), p(w, y0), p(w, y1), p(-w, y1), c.underside);
    }
  }
}

/** Lower decks this close above the water rise in the middle to let boats under (m). */
const LOW_WATER_GAP = 6;
const LOWER_HUMP = 4;
/** Headroom kept under the upper deck over the lower deck's rails (m). */
const LOWER_HEADROOM = 5;

/**
 * Lower deck surface at s. A deck near the water (잠수교) rises by up to LOWER_HUMP over the
 * middle third of the span; everywhere else it is flat at `lowY`.
 */
export function lowerDeckAt(b: Bridge, f: BridgeFrame, lowY: number, s: number): number {
  if (lowY - RIVER.waterY >= LOW_WATER_GAP) return lowY;
  const room = b.deckY - DECK_THICKNESS - LOWER_HEADROOM - 1.2 - lowY;
  const hump = Math.max(0, Math.min(LOWER_HUMP, room));
  const k = Math.abs(s) / (f.spanHalf * 0.36);
  if (k >= 1) return lowY;
  if (k <= 0.5) return lowY + hump;
  return lowY + hump * (0.5 + 0.5 * Math.cos((Math.PI * (k - 0.5)) / 0.5));
}

/** Lower deck between the abutments, posts up to the upper deck, fascia lights by motif. */
function buildLowerDeck(
  b: Bridge,
  f: BridgeFrame,
  parts: BridgeParts,
  c: InfraColors,
  lowY: number,
): void {
  const h = f.spanHalf;
  const use = lowerUse(b);
  const half = use.width / 2;
  const y = (s: number): number => lowerDeckAt(b, f, lowY, s);
  buildDeck(f, parts, c, -h - ABUT / 2, h + ABUT / 2, y, c.steel, use);
  const under = b.deckY - DECK_THICKNESS;
  for (let s = -h + 5; s < h; s += 10) {
    for (const sgn of [-1, 1] as const) {
      const l = sgn * (half - 0.7);
      const y0 = y(s) + 1.2;
      if (under - y0 < 0.5) continue;
      parts.steel.beam(bridgePoint(f, s, l, y0), bridgePoint(f, s, l, under), 0.8, 0.8, c.steel);
    }
  }
  if (b.motif === 'fountain') {
    for (let s = -h; s <= h; s += 8) {
      parts.points.push({
        p: bridgePoint(f, s, 0, y(s) + 0.12),
        size: [0.35, 0.12, 0.35],
        rotY: 0,
        color: c.laneLamp,
      });
    }
    return;
  }
  if (b.motif === 'subwayDeck') {
    // White band along both upper fascias; the lower deck's train windows are neon's.
    const upper = framesAlong([-h, 0, h].map((s) => bridgePoint(f, s, 0, b.deckY)));
    for (const sgn of [-1, 1] as const) {
      const l0 = sgn === 1 ? b.width / 2 : -b.width / 2 - 0.06;
      parts.glow.sweep(upper, boxEdges(l0, l0 + 0.06, -0.55, -0.3, c.deckBand));
    }
    return;
  }
  const lowFrames = framesAlong(deckPath(f, -h, h, y));
  for (const sgn of [-1, 1] as const) {
    const l0 = sgn === 1 ? half : -half - 0.06;
    parts.glow.sweep(lowFrames, boxEdges(l0, l0 + 0.06, -0.62, -0.32, c.lowerDeckBand));
  }
}

/** Deepest box girder under the slab, over a support (m). */
const HAUNCH = 3.8;
const GIRDER_DEPTH = 1.6;
/** Haunch length on each side of a support (m). */
const HAUNCH_LEN = 28;

/**
 * Haunched box girder under the slab between the abutments: GIRDER_DEPTH at mid-span, deepening
 * to HAUNCH over piers and abutments, never closer than 1 m to the water.
 */
function buildBoxGirder(
  b: Bridge,
  f: BridgeFrame,
  parts: BridgeParts,
  c: InfraColors,
  supports: readonly number[],
): void {
  const h = f.spanHalf;
  const top = b.deckY - DECK_THICKNESS + 0.05;
  const most = top - (RIVER.waterY + 1);
  if (most < 0.5) return;
  const depth = (s: number): number => {
    let k = 0;
    for (const p of [-h, ...supports, h]) k = Math.max(k, 1 - Math.abs(s - p) / HAUNCH_LEN);
    return Math.min(most, GIRDER_DEPTH + (HAUNCH - GIRDER_DEPTH) * k * k);
  };
  const w = b.width * 0.27;
  const stations = new Set<number>([-h, h, ...supports]);
  for (let s = -h; s < h; s += 6) stations.add(s);
  for (const p of supports) for (const d of [-HAUNCH_LEN, HAUNCH_LEN]) stations.add(p + d);
  const list = [...stations].filter((s) => s >= -h && s <= h).sort((p, q) => p - q);
  for (let i = 0; i < list.length - 1; i++) {
    const s0 = list[i] as number;
    const s1 = list[i + 1] as number;
    if (s1 - s0 < 0.2) continue;
    const P = (s: number, l: number, yy: number): V3 => bridgePoint(f, s, l, yy);
    const b0 = top - depth(s0);
    const b1 = top - depth(s1);
    // Two sides and the bottom (the top is hidden under the slab).
    parts.concrete.quad(P(s0, w, top), P(s0, w, b0), P(s1, w, b1), P(s1, w, top), c.underside);
    parts.concrete.quad(P(s0, -w, top), P(s1, -w, top), P(s1, -w, b1), P(s0, -w, b0), c.underside);
    parts.concrete.quad(P(s0, -w, b0), P(s1, -w, b1), P(s1, w, b1), P(s0, w, b0), c.underside);
  }
}

/** Piers under the lowest deck with uplights; a box girder under a single deck. */
const buildGirder: BridgeBuilder = (b, f, parts, c, obstacles) => {
  const pierW = Math.max(4, Math.min(b.width - 4, lowerUse(b).width + 4));
  const pierD = 3.5;
  const low = lowerDeckY(b);
  const top = (s: number): number =>
    (low === undefined ? b.deckY : lowerDeckAt(b, f, low, s)) - DECK_THICKNESS;
  const stations = pushPiers(b, f, parts, top, pierW, pierD, obstacles);
  if (low === undefined) buildBoxGirder(b, f, parts, c, stations);
  // The fountain (neon) is the hero of a 'fountain' bridge: no pier uplights competing with it.
  if (b.motif === 'fountain') return;
  buildPierWashes(
    f,
    parts,
    c,
    stations,
    pierW,
    pierD,
    (s) => top(s) - 0.2,
    islandWashColor(b, f, c),
  );
};

/** Rail top above the deck surface: 'all' tracks sit on a 0.25 m bed, a center bed is 0.3 m. */
const RAIL_TOP = { all: 0.25 + 0.16, center: 0.3 + 0.16 } as const;

/**
 * Rail top polylines of every track on a bridge (InfraApi.railTracks): upper deck tracks over
 * the whole deck and its ramps, lower deck tracks abutment to abutment.
 */
export function railTracks(b: Bridge): V3[][] {
  const f = bridgeFrame(b);
  const out: V3[][] = [];
  const add = (use: DeckUse, from: number, to: number, y: (s: number) => number): void => {
    if (use.tracks === 'none') return;
    const path = deckPath(f, from, to, y);
    const top = RAIL_TOP[use.tracks];
    for (const t of trackCenters(use)) {
      out.push(
        path.map((p): V3 => {
          const s = (p[0] - f.mid[0]) * f.u[0] + (p[2] - f.mid[2]) * f.u[2];
          return bridgePoint(f, s, t, p[1] + top);
        }),
      );
    }
  };
  add(upperUse(b), f.landA, f.landB, (s) => deckYAt(b, f, s));
  const low = lowerDeckY(b);
  if (low !== undefined) {
    const h = f.spanHalf + ABUT / 2;
    add(lowerUse(b), -h, h, (s) => lowerDeckAt(b, f, low, s));
  }
  return out;
}

/** Nozzle line depth under the deck surface on the outer fascia (m). */
const NOZZLE_DROP = 0.3;

/** Fountain nozzle lines along both upper deck edges (InfraApi.fountainNozzles). */
export function fountainNozzles(b: Bridge): { a: V3; b: V3; outward: V3 }[] {
  if (b.motif !== 'fountain') return [];
  const f = bridgeFrame(b);
  const h = f.spanHalf;
  return ([-1, 1] as const).map((sgn) => {
    const l = sgn * (b.width / 2 + 0.05);
    return {
      a: bridgePoint(f, -h, l, b.deckY - NOZZLE_DROP),
      b: bridgePoint(f, h, l, b.deckY - NOZZLE_DROP),
      outward: [f.v[0] * sgn, 0, f.v[2] * sgn],
    };
  });
}

const BUILDERS: Record<BridgeShape, BridgeBuilder> = {
  arch: buildArch,
  truss: buildTruss,
  doubleDeck: buildGirder,
  girder: buildGirder,
  deckArch: buildDeckArch,
  tiedArch: buildTiedArch,
  cableStayed: buildCableStayed,
};

/**
 * `roads` (the layout's ground roads) and `highways`: what river and approach piers keep clear of.
 * `withDetail` false skips the fine parts entirely (quality 'ci').
 */
export function buildBridge(
  b: Bridge,
  out: InfraParts,
  c: InfraColors,
  roads: readonly Road[] = [],
  highways: readonly HwPath[] = [],
  withDetail = true,
): BridgeFrame {
  const f = bridgeFrame(b);
  const sink = (): MeshData => (withDetail ? new MeshData() : new DiscardMeshData());
  const detail = { steel: sink(), glow: sink(), markings: sink() };
  if (withDetail)
    out.bridgeDetail.push({ id: b.id, center: [f.mid[0], b.deckY, f.mid[2]], ...detail });
  const parts: BridgeParts = { ...out, detail };
  const shape = bridgeShape(b);
  const lowY = lowerDeckY(b);
  const deckY = (s: number): number => deckYAt(b, f, s);
  const rail = shape === 'arch' || shape === 'tiedArch' ? c.archSteel : c.steel;
  buildDeck(f, parts, c, f.landA, f.landB, deckY, rail, upperUse(b));
  buildAbutments(
    b,
    f,
    parts,
    c,
    lowY === undefined ? undefined : { y: lowY, width: lowerUse(b).width },
  );
  if (lowY !== undefined) buildLowerDeck(b, f, parts, c, lowY);
  BUILDERS[shape](b, f, parts, c, { roads, highways });
  return f;
}
