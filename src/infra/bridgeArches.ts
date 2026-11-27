// Arch bridges: the layout v2 two-span arch, the deck arch (faceted half-moon ribs under the deck,
// 성산대교) and the tied arch (ribs over the deck tied by edge girders: low arches on every span,
// or one tall landmark arch over the middle span, 양화·서강·한강대교).
import { RIVER } from '../city/layout';
import {
  archY,
  bridgePoint,
  buildPierWashes,
  islandWashColor,
  pushPiers,
  resample,
  spanList,
  type BridgeBuilder,
  type BridgeFrame,
  type Span,
} from './bridgeFrame';
import { framesAlong, type RGB, type V3 } from './mesh';
import { DECK_THICKNESS, boxEdges, openBoxEdges } from './profile';

/** n + 1 rib points from s0 to s1 at lateral l, heights from y(s). */
function ribPoints(
  f: BridgeFrame,
  s0: number,
  s1: number,
  l: number,
  n: number,
  y: (s: number) => number,
): V3[] {
  return Array.from({ length: n + 1 }, (_, k) => {
    const s = s0 + ((s1 - s0) * k) / n;
    return bridgePoint(f, s, l, y(s));
  });
}

/** v2: two parabolic arch spans over a center pier, white ribs, cyan points, white hangers. */
export const buildArch: BridgeBuilder = (b, f, parts, c, obstacles) => {
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
      const pts = ribPoints(f, s0, s1, l, 32, (s) => archY(s, s0, s1, springY, crownY));
      parts.steel.sweep(framesAlong(pts), boxEdges(-0.8, 0.8, -1.1, 1.1, c.archSteel));
      for (const p of resample(pts, 6)) {
        parts.points.push({
          p: [p[0], p[1] + 1.25, p[2]],
          size: [0.7, 0.7, 0.7],
          rotY: 0,
          color: c.archPoint,
        });
      }
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
      parts.detail.steel.beam(
        bridgePoint(f, s, -ribL, ry),
        bridgePoint(f, s, ribL, ry),
        0.9,
        0.9,
        c.archSteel,
      );
    }
  }
  // Rib springings rest on wide pier / abutment heads.
  pushPiers(b, f, parts, b.deckY - DECK_THICKNESS, b.width + 5, 6, obstacles);
};

/** Straight chords per deck-arch rib: the faceted look. */
const FACETS = 8;
const DECK_ARCH_RISE = 12;
const DECK_ARCH_PIER_D = 5;

/**
 * Deck arch: two faceted ribs per span under the deck, springing from the piers just above the
 * water and meeting the deck underside at the crown, with cyan points along their undersides
 * (five half moons on the water). Spandrel posts and rib bracing are detail.
 */
export const buildDeckArch: BridgeBuilder = (b, f, parts, c, obstacles) => {
  const ribW = 1.4;
  const ribH = 1.8;
  const under = b.deckY - DECK_THICKNESS;
  const crown = under - 0.3 - ribH / 2;
  const rise = b.structureH > 0 ? b.structureH : DECK_ARCH_RISE;
  const spring = Math.max(RIVER.waterY + 1 + ribH / 2, crown - rise);
  const ribL = Math.max(1, b.width / 2 - 3);
  const placed = pushPiers(b, f, parts, under, b.width * 0.7, DECK_ARCH_PIER_D, obstacles);
  const spans = spanList(b, f, placed);
  for (const [i, sp] of spans.entries()) {
    // Ribs start at the pier faces; the abutment blocks hide the outer ends.
    const s0 = sp.s0 + (i === 0 ? 0 : DECK_ARCH_PIER_D / 2);
    const s1 = sp.s1 - (i === spans.length - 1 ? 0 : DECK_ARCH_PIER_D / 2);
    if (crown - spring < 1 || s1 - s0 < 8) continue;
    const y = (s: number): number => archY(s, s0, s1, spring, crown);
    for (const sgn of [-1, 1] as const) {
      const l = sgn * ribL;
      const pts = ribPoints(f, s0, s1, l, FACETS, y);
      for (let k = 0; k < FACETS; k++) {
        parts.steel.beam(pts[k] as V3, pts[k + 1] as V3, ribW, ribH, c.archSteel, f.v);
      }
      for (const p of resample(pts, 6)) {
        parts.points.push({
          p: [p[0], p[1] - ribH / 2 - 0.25, p[2]],
          size: [0.5, 0.35, 0.5],
          rotY: 0,
          color: c.archPoint,
        });
      }
      for (let s = s0 + 6; s < s1 - 4; s += 8) {
        const top = y(s) + ribH / 2;
        if (under - top < 1) continue;
        parts.detail.steel.beam(
          bridgePoint(f, s, l, top),
          bridgePoint(f, s, l, under),
          0.6,
          0.6,
          c.archSteel,
        );
      }
    }
    for (let s = s0 + 8; s < s1 - 4; s += 16) {
      parts.detail.steel.beam(
        bridgePoint(f, s, -ribL, y(s)),
        bridgePoint(f, s, ribL, y(s)),
        0.6,
        0.8,
        c.archSteel,
      );
    }
  }
};

/**
 * A tied arch steeper than this (rise / span) is a landmark arch: one over the middle span only,
 * the side spans are plain girders.
 */
const LANDMARK_RISE = 0.25;

/** Spans that get an arch: every water span, or the landmark span. */
export function archSpans(spans: readonly Span[], rise: number): Span[] {
  const water = spans.filter((sp) => !sp.island);
  const longest = Math.max(0, ...water.map((sp) => sp.s1 - sp.s0));
  if (longest <= 0 || rise / longest <= LANDMARK_RISE) return water;
  // Closest to the middle among the longest spans.
  const mid = (sp: Span): number => Math.abs(sp.s0 + sp.s1);
  const best = water
    .filter((sp) => sp.s1 - sp.s0 >= longest - 1)
    .sort((p, q) => mid(p) - mid(q))[0];
  return best ? [best] : [];
}

const TIED_RISE = 14;
const TIED_SEGMENTS = 16;
/** Clearance over the deck below which the ribs carry no bracing (m). */
const BRACE_CLEAR = 7;

/**
 * Tied arch: two vertical ribs per arched span just outside the deck edges, tied by steel edge
 * girders, with hangers every 6 m and a glow line along the rib crest. Spans over a stop island
 * have no arch; their deck edges get orange lights instead.
 */
export const buildTiedArch: BridgeBuilder = (b, f, parts, c, obstacles) => {
  const rise = b.structureH > 0 ? b.structureH : TIED_RISE;
  const ribL = b.width / 2 + 1;
  const springY = b.deckY + 0.2;
  const pierW = b.width * 0.6;
  const pierD = 4;
  const top = b.deckY - DECK_THICKNESS;
  const placed = pushPiers(b, f, parts, top, pierW, pierD, obstacles);
  const spans = spanList(b, f, placed);
  const arched = archSpans(spans, rise);
  const landmark = arched.length === 1 && spans.length > 1;
  const line: RGB = b.motif === 'redArch' ? c.archRed : c.archWhite;
  const ribHalf = landmark ? 1.2 : 0.7;
  const crownY = b.deckY + rise;
  const ribTop = ribHalf * 1.3;
  for (const sp of arched) {
    const y = (s: number): number => archY(s, sp.s0, sp.s1, springY, crownY);
    for (const sgn of [-1, 1] as const) {
      const l = sgn * ribL;
      const pts = ribPoints(f, sp.s0, sp.s1, l, TIED_SEGMENTS, y);
      const frames = framesAlong(pts);
      parts.steel.sweep(frames, boxEdges(-ribHalf, ribHalf, -ribTop, ribTop, c.archSteel));
      // Landmark arch: the whole crest glows; low arches: a thin line.
      const lw = landmark ? ribHalf : 0.22;
      parts.glow.sweep(
        frames,
        // Glow is single-sided: keep the sides so the line still shows from below.
        openBoxEdges(-lw, lw, ribTop - 0.02, ribTop + 0.12, line),
      );
      parts.steel.beam(
        bridgePoint(f, sp.s0, l, b.deckY - 0.3),
        bridgePoint(f, sp.s1, l, b.deckY - 0.3),
        1,
        1.6,
        c.archSteel,
        f.v,
      );
      for (let s = sp.s0 + 6; s < sp.s1 - 3; s += 6) {
        const ry = y(s) - ribTop;
        if (ry - b.deckY < 1.5) continue;
        parts.steel.beam(
          bridgePoint(f, s, l, b.deckY + 0.5),
          bridgePoint(f, s, l, ry),
          0.16,
          0.16,
          c.archSteel,
        );
      }
    }
    for (let s = sp.s0 + 10; s < sp.s1 - 5; s += 10) {
      const ry = y(s);
      if (ry - b.deckY < BRACE_CLEAR) continue;
      // A landmark arch's bracing is part of its silhouette.
      (landmark ? parts.steel : parts.detail.steel).beam(
        bridgePoint(f, s, -ribL, ry),
        bridgePoint(f, s, ribL, ry),
        0.6,
        0.6,
        c.archSteel,
      );
    }
  }
  for (const sp of spans.filter((q) => q.island)) {
    for (let s = sp.s0; s <= sp.s1; s += 6) {
      for (const sgn of [-1, 1] as const) {
        parts.points.push({
          p: bridgePoint(f, s, sgn * (b.width / 2 - 0.2), b.deckY + 1.4),
          size: [0.3, 0.3, 0.3],
          rotY: 0,
          color: c.islandPoint,
        });
      }
    }
  }
  buildPierWashes(f, parts, c, placed, pierW, pierD, top - 0.2, islandWashColor(b, f, c));
};
