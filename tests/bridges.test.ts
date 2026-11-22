// Vertical clearance where roads and highways cross bridge approaches (every seed).
import { describe, expect, it } from 'vitest';
import {
  MAX_DECK_THICKNESS,
  MIN_ROAD_CLEARANCE,
  bridgeDeckY,
  deckHeightAt,
  generateLayout,
  highwaySamples,
  riverFrame,
  type Bridge,
  type Vec2,
} from '../src/city/layout';

const SEEDS = [1, 42, 2077, 9999];
const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z) < 1;

describe.each(SEEDS)('seed %i', (seed) => {
  const L = generateLayout(seed);

  it('keeps ≥ 5 m under bridge approaches for every road crossing below', () => {
    for (const br of L.bridges) {
      for (const r of L.roads) {
        // The bridge's own approach avenues start at the landings; they continue the deck.
        if ([br.landA, br.landB].some((l) => near(l, r.a) || near(l, r.b))) continue;
        const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z);
        for (let s = 0; s <= len; s += 1) {
          const t = s / len;
          const x = r.a.x + (r.b.x - r.a.x) * t;
          const z = r.a.z + (r.b.z - r.a.z) * t;
          const deck = bridgeDeckY(br, x, z, r.width / 2);
          if (deck === null) continue;
          expect(deck - MAX_DECK_THICKNESS, `road ${r.id} under ${br.id}`).toBeGreaterThanOrEqual(
            MIN_ROAD_CLEARANCE,
          );
        }
      }
    }
  });

  it('keeps ≥ 5 m between highways and bridge approaches where they cross', () => {
    const crossings = new Set<string>();
    for (const br of L.bridges) {
      for (const hw of L.highways) {
        for (const p of highwaySamples(hw, 2)) {
          const deck = bridgeDeckY(br, p.x, p.z, hw.width / 2);
          if (deck === null) continue;
          crossings.add(`${hw.id}/${br.id}`);
          const gap =
            p.y > deck ? p.y - MAX_DECK_THICKNESS - deck : deck - MAX_DECK_THICKNESS - p.y;
          expect(gap, `${hw.id} at ${br.id}`).toBeGreaterThanOrEqual(MIN_ROAD_CLEARANCE);
        }
      }
    }
    // Both riverside highways cross all three bridges.
    for (const br of L.bridges) {
      expect(crossings.has(`hw-south/${br.id}`)).toBe(true);
      expect(crossings.has(`hw-river-north/${br.id}`)).toBe(true);
    }
  });
});

describe('bridge deck profile', () => {
  const L = generateLayout(2077);
  const at = (br: Bridge, k: number) => {
    const f = riverFrame((br.a.x + br.b.x) / 2);
    const mid = { x: (br.a.x + br.b.x) / 2, z: (br.a.z + br.b.z) / 2 };
    return { x: mid.x + f.south.x * k, z: mid.z + f.south.z * k };
  };

  it('is flat over the span and reaches 0 at both landings', () => {
    for (const br of L.bridges) {
      const c = at(br, 0);
      expect(bridgeDeckY(br, c.x, c.z)).toBe(br.deckY);
      expect(bridgeDeckY(br, br.landA.x, br.landA.z)).toBeCloseTo(0, 6);
      expect(bridgeDeckY(br, br.landB.x, br.landB.z)).toBeCloseTo(0, 6);
      expect(deckHeightAt(L, c.x, c.z)).toBeGreaterThanOrEqual(br.deckY);
    }
  });
});
