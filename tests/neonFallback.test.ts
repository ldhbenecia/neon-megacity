import { describe, expect, it } from 'vitest';
import { LAYOUT, buildingFaces, type DistrictKind } from '../src/city/layout';
import { buildCatalog } from '../src/neon/catalog';
import { districtSigns, placeSigns } from '../src/neon/placement';

describe('neon district fallback', () => {
  it('maps v3 districts onto the shared base kinds', () => {
    expect(districtSigns('megacore')).toEqual(districtSigns('core'));
    // Teheran-ro keeps the core rules and adds its media screens.
    expect({ ...districtSigns('corridor'), media: undefined }).toEqual({
      ...districtSigns('core'),
      media: undefined,
    });
    expect(districtSigns('corridor').media).toBe(true);
    expect(districtSigns('showroom')).toEqual(districtSigns('sangga'));
    // Same base rules, different mood: quiet old Jongno, dense Hongdae.
    const sangga = districtSigns('sangga');
    expect(districtSigns('oldtown').shopScale).toBeLessThan(sangga.shopScale);
    expect(districtSigns('nightlife').shopScale).toBeGreaterThan(sangga.shopScale);
    expect(districtSigns('oldtown').zone).toEqual(sangga.zone);
    // Seongsu brick keeps signs small and flat.
    expect(districtSigns('brick').shopScale).toBeLessThan(sangga.shopScale);
    expect(districtSigns('brick').bladeScale).toBeLessThan(1);
  });

  it('keeps unbuilt districts dark', () => {
    for (const d of ['palace', 'park'] as const) {
      const s = districtSigns(d);
      expect(s.street || s.tubes || s.vtext || s.holos).toBe(false);
    }
  });

  it('falls back to midtown for kinds newer than the shared table', () => {
    for (const d of ['future-zone', 'constructor', '__proto__']) {
      expect(districtSigns(d as DistrictKind)).toEqual(districtSigns('midtown'));
    }
  });

  it('places no sign of any kind on unbuilt buildings', () => {
    for (const district of ['palace', 'park'] as const) {
      const L = { ...LAYOUT, buildings: LAYOUT.buildings.map((b) => ({ ...b, district })) };
      const cat = buildCatalog(L);
      const P = placeSigns(
        L,
        L.buildings.map((b) => buildingFaces(b)),
        cat,
      );
      // Banners hang over roads, not on buildings, so only building-mounted signs must vanish.
      expect(P.flats.filter((f) => f.building >= 0)).toHaveLength(0);
      expect(P.tubes).toHaveLength(0);
      expect(P.crosses).toHaveLength(0);
      expect(P.screens).toHaveLength(0);
      expect(P.rings).toHaveLength(0);
      // Only the river koi remain; they float over water, not over a building.
      for (const h of P.holos) expect(cat.cells[h.cell]?.kind).toBe('koi');
    }
  });

  it('respects faces buildings marks unusable, and skips unmarked landmarks', () => {
    const tall = LAYOUT.buildings.filter((b) => b.h >= 160).map((b) => b.id);
    const marked = new Set(tall);
    const faces = LAYOUT.buildings.map((b) =>
      buildingFaces(b).map((f) => (marked.has(b.id) ? { ...f, usable: false } : f)),
    );
    const cat = buildCatalog(LAYOUT);
    const P = placeSigns(LAYOUT, faces, cat);
    for (const s of [...P.flats, ...P.screens, ...P.tubes])
      expect(marked.has(s.building)).toBe(false);
    const landmarks = new Set(LAYOUT.buildings.filter((b) => b.tags.landmark).map((b) => b.id));
    const plain = placeSigns(
      LAYOUT,
      LAYOUT.buildings.map((b) => buildingFaces(b)),
      cat,
    );
    for (const s of [...plain.flats, ...plain.screens, ...plain.tubes, ...plain.rings]) {
      expect(landmarks.has(s.building)).toBe(false);
    }
  });
});
