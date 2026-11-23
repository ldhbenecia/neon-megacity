import { describe, expect, it } from 'vitest';
import { LAYOUT, baseKind, isUnbuilt, type DistrictKind } from '../src/city/layout';

const V2: DistrictKind[] = [
  'core',
  'midtown',
  'sangga',
  'hillside',
  'apartment',
  'industrial',
  'riverside',
];

describe('baseKind', () => {
  it('keeps every v2 kind as itself, so the v2 city renders unchanged', () => {
    for (const k of V2) expect(baseKind(k)).toBe(k);
    // Every building's kind maps onto a kind with renderer rules.
    const ruled = new Set<string>([...V2, 'palace', 'park']);
    for (const b of LAYOUT.buildings) expect(ruled.has(baseKind(b.district))).toBe(true);
  });

  it('maps the v3 kinds to the manager-chosen v2 kinds', () => {
    expect(baseKind('megacore')).toBe('core');
    expect(baseKind('corridor')).toBe('core');
    for (const k of ['nightlife', 'brick', 'oldtown', 'showroom'] as const) {
      expect(baseKind(k)).toBe('sangga');
    }
    expect(baseKind('palace')).toBe('palace');
    expect(baseKind('park')).toBe('park');
  });

  it('marks only the park and palace grounds as unbuilt', () => {
    expect(isUnbuilt('park')).toBe(true);
    expect(isUnbuilt('palace')).toBe(true);
    for (const k of [...V2, 'megacore', 'corridor', 'nightlife'] as DistrictKind[]) {
      expect(isUnbuilt(k)).toBe(false);
    }
  });
});
