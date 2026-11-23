import { describe, expect, it } from 'vitest';
import type { DistrictKind } from '../src/city/layout';
import { districtSigns } from '../src/neon/placement';

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
});
