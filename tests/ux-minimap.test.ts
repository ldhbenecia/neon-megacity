import { describe, expect, it } from 'vitest';
import { mapTransform } from '../src/ux/minimap';

describe('minimap transform', () => {
  const t = mapTransform(2000, 1300, 400, 260);

  it('puts the map corners on the canvas corners, north up', () => {
    expect(t.toMap(-2000, -1300)).toEqual({ px: 0, py: 0 });
    expect(t.toMap(2000, 1300)).toEqual({ px: 400, py: 260 });
    expect(t.toMap(0, 0)).toEqual({ px: 200, py: 130 });
  });

  it('maps a canvas point back to the same world point', () => {
    for (const [x, z] of [
      [-1234, 567],
      [1800, -1200],
      [0, 0],
    ] as const) {
      const p = t.toMap(x, z);
      const w = t.toWorld(p.px, p.py);
      expect(w.x).toBeCloseTo(x, 6);
      expect(w.z).toBeCloseTo(z, 6);
    }
  });
});
