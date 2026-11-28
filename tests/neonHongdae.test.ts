import { describe, expect, it } from 'vitest';
import { LAYOUT, buildingContaining, buildingFaces } from '../src/city/layout';
import { buildCatalog } from '../src/neon/catalog';
import {
  ALLEY_BLADE_STEP,
  coprimeStride,
  placeSigns,
  signBudget,
  signCount,
} from '../src/neon/placement';
import { planStreet } from '../src/neon/streetPlan';
import { BULB_SPACING, STRING_BANNER_CLEAR, bulbPositions, bulbStrings } from '../src/neon/strings';

const faces = LAYOUT.buildings.map((b) => buildingFaces(b));
const cat = buildCatalog(LAYOUT);
const street = planStreet(LAYOUT, cat, 0.15);
const P = placeSigns(LAYOUT, faces, cat, { reserved: street.flats.length });
const banners = P.flats.filter((s) => s.building < 0);
const hongdae = LAYOUT.buildings.some((b) => b.district === 'nightlife');

describe('Hongdae alley density', () => {
  it('keeps the city-wide sign cap with the extra alley blades', () => {
    expect(signCount(P) + street.flats.length).toBeLessThanOrEqual(signBudget(LAYOUT));
  });

  it('lines nightlife shop faces with blades whose neighbours never share a height band', () => {
    if (!hongdae) return;
    const blades = P.flats.filter(
      (s) => s.kind === 'blade' && LAYOUT.buildings[s.building]?.district === 'nightlife',
    );
    expect(blades.length).toBeGreaterThan(250);
    const byFace = new Map<string, typeof blades>();
    for (const s of blades) {
      const k = `${s.building}:${s.face}`;
      byFace.set(k, [...(byFace.get(k) ?? []), s]);
    }
    for (const list of byFace.values()) {
      const sorted = [...list].sort((a, z) => a.u0 - z.u0);
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1]!;
        const b = sorted[i]!;
        if (b.u0 - a.u0 > ALLEY_BLADE_STEP[1] + 0.01) continue;
        expect(a.y1 <= b.y0 || b.y1 <= a.y0).toBe(true);
      }
    }
  });

  it('walks every blade cell before repeating one', () => {
    for (const n of [2, 5, 7, 14, 23, 26, 28, 35]) {
      const k = coprimeStride(n);
      expect(new Set(Array.from({ length: n }, (_, i) => (i * k) % n)).size).toBe(n);
    }
  });
});

describe('bulb strings', () => {
  const strings = bulbStrings(LAYOUT, banners);

  it('hang wall to wall across nightlife alleys, clear of banners', () => {
    if (!hongdae) return;
    expect(strings.length).toBeGreaterThan(30);
    for (const s of strings) {
      for (const p of [s.a, s.b]) expect(buildingContaining(LAYOUT, p.x, p.y, p.z)).toBeNull();
      const mx = (s.a.x + s.b.x) / 2;
      const mz = (s.a.z + s.b.z) / 2;
      const span = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
      expect(span).toBeGreaterThan(2);
      expect(s.sag).toBeGreaterThan(0);
      const ax = (s.b.x - s.a.x) / span;
      const az = (s.b.z - s.a.z) / span;
      for (const b of banners) {
        // Distance along the street (perpendicular to the string), for banners on the same street.
        const along = Math.abs((b.x - mx) * -az + (b.z - mz) * ax);
        const across = Math.abs((b.x - mx) * ax + (b.z - mz) * az);
        if (across < span / 2) expect(along).toBeGreaterThanOrEqual(STRING_BANNER_CLEAR - 0.5);
      }
    }
  });

  it('spaces bulbs evenly between the ends, below the anchors', () => {
    const s = strings[0];
    if (!s) return;
    const bulbs = bulbPositions(s);
    const span = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
    expect(bulbs.length).toBe(Math.max(2, Math.round(span / BULB_SPACING)) - 1);
    for (const p of bulbs) expect(p.y).toBeLessThanOrEqual(Math.max(s.a.y, s.b.y) + 1e-9);
  });
});
