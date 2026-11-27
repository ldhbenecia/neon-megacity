import { describe, expect, it } from 'vitest';
import { LAYOUT, buildingFaces, type DistrictKind } from '../src/city/layout';
import { buildCatalog } from '../src/neon/catalog';
import { districtSigns, placeSigns } from '../src/neon/placement';

describe('neon district fallback', () => {
  it('maps v3 districts onto the shared base kinds', () => {
    for (const d of ['megacore', 'corridor'] as const) {
      expect(districtSigns(d)).toEqual(districtSigns('core'));
    }
    for (const d of ['nightlife', 'brick', 'oldtown', 'showroom'] as const) {
      expect(districtSigns(d)).toEqual(districtSigns('sangga'));
    }
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
      expect(P.flats).toHaveLength(0);
      expect(P.tubes).toHaveLength(0);
      expect(P.crosses).toHaveLength(0);
      expect(P.screens).toHaveLength(0);
      expect(P.rings).toHaveLength(0);
      // Only the river koi remain; they float over water, not over a building.
      for (const h of P.holos) expect(cat.cells[h.cell]?.kind).toBe('koi');
    }
  });
});
