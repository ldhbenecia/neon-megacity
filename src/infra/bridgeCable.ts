// Cable-stayed bridge (올림픽대교: only the pylon count, position and height ratio are kept).
// Every river pier carries a pylon of two legs rising from outside the deck edges and meeting
// under a short mast, a horizontal cyan ring around the mast top and an orange band up each leg.
// Cables fan from the mast to both deck edges, white dots on every other cable.
import { bridgePoint, pushPiers, type BridgeBuilder } from './bridgeFrame';
import { add, norm, scale, sub, type V3 } from './mesh';
import { DECK_THICKNESS } from './profile';

/** Cables per pylon, per side and per direction. */
const CABLES = 8;
const RING_SEGMENTS = 16;
const RING_R = 4;
/** Default pylon height above the deck when the layout gives none (m). */
const PYLON_H = 60;

export const buildCableStayed: BridgeBuilder = (b, f, parts, c, obstacles) => {
  const H = b.structureH > 0 ? b.structureH : PYLON_H;
  const under = b.deckY - DECK_THICKNESS;
  const apex = b.deckY + H;
  const legL = b.width / 2 + 1.5;
  const placed = pushPiers(b, f, parts, under, b.width * 0.6, 6, obstacles);
  const ends = [-f.spanHalf, ...placed, f.spanHalf];
  for (const [i, s0] of placed.entries()) {
    const P = (l: number, y: number, ds = 0): V3 => bridgePoint(f, s0 + ds, l, y);
    parts.concrete.beam(P(-legL, under - 1), P(legL, under - 1), 2.2, 2, c.concrete, f.u);
    for (const sgn of [-1, 1] as const) {
      const foot = P(sgn * legL, under - 2);
      const head = P(sgn * 1.2, apex - 8);
      parts.concrete.beam(foot, head, 2.4, 3.2, c.concrete, f.u);
      // Orange band on the leg's outer face, from just above the deck to below the head.
      const along = sub(head, foot);
      const out = norm([
        f.v[0] * sgn * along[1],
        -(along[0] * f.v[0] + along[2] * f.v[2]) * sgn,
        f.v[2] * sgn * along[1],
      ]);
      const off = scale(out, 1.8);
      parts.glow.beam(
        add(add(foot, scale(along, 0.25)), off),
        add(add(foot, scale(along, 0.85)), off),
        0.7,
        0.5,
        c.pylonBand,
        f.u,
      );
    }
    parts.concrete.beam(P(0, apex - 10), P(0, apex + 4), 3, 3, c.concrete, f.u);
    for (let k = 0; k < RING_SEGMENTS; k++) {
      const a0 = (2 * Math.PI * k) / RING_SEGMENTS;
      const a1 = (2 * Math.PI * (k + 1)) / RING_SEGMENTS;
      parts.glow.beam(
        P(Math.cos(a0) * RING_R, apex + 1, Math.sin(a0) * RING_R),
        P(Math.cos(a1) * RING_R, apex + 1, Math.sin(a1) * RING_R),
        0.4,
        0.4,
        c.pylonRing,
      );
    }
    for (const dir of [-1, 1] as const) {
      const next = ends[i + 1 + (dir === 1 ? 1 : -1)] as number;
      const gap = Math.abs(next - s0);
      // Meet the neighbour pylon's fan halfway; reach close to an abutment.
      const neighbourIsPylon = next !== -f.spanHalf && next !== f.spanHalf;
      const reach = neighbourIsPylon ? gap / 2 - 3 : gap - 12;
      if (reach < 12) continue;
      for (let k = 0; k < CABLES; k++) {
        const d = 8 + ((reach - 8) * (k + 1)) / CABLES;
        const yTop = apex - 1.5 - (CABLES - 1 - k) * 1.3;
        for (const sgn of [-1, 1] as const) {
          const top = P(sgn * 0.7, yTop, dir * 0.9);
          const deck = P(sgn * (b.width / 2 - 0.6), b.deckY + 0.3, dir * d);
          parts.steel.beam(top, deck, 0.22, 0.22, c.archSteel);
          if (k % 2 === 0) continue;
          const span = sub(deck, top);
          const n = Math.floor(Math.hypot(span[0], span[1], span[2]) / 12);
          for (let j = 1; j < n; j++) {
            parts.points.push({
              p: add(top, scale(span, j / n)),
              size: [0.25, 0.25, 0.25],
              rotY: 0,
              color: c.railDot,
            });
          }
        }
      }
    }
  }
};
