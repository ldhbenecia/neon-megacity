import { describe, expect, it } from 'vitest';
import { districtSigns } from '../src/neon/placement';

describe('neon district fallback', () => {
  it('maps v3 districts onto the closest v2 rules', () => {
    expect(districtSigns('megacore')).toEqual(districtSigns('core'));
    for (const d of ['nightlife', 'brick', 'oldtown']) {
      expect(districtSigns(d)).toEqual(districtSigns('sangga'));
    }
    expect(districtSigns('corridor')).toEqual(districtSigns('midtown'));
  });

  it('keeps palace and park street levels dark', () => {
    for (const d of ['palace', 'park']) {
      const s = districtSigns(d);
      expect(s.street || s.tubes || s.vtext || s.holos).toBe(false);
    }
  });

  it('falls back to midtown for unknown districts, prototype keys included', () => {
    for (const d of ['future-zone', 'constructor', '__proto__']) {
      expect(districtSigns(d)).toEqual(districtSigns('midtown'));
    }
  });
});
