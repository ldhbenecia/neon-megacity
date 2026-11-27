import { describe, expect, it } from 'vitest';
import { noise2, ridged2 } from '../src/city/noise';

describe('noise2 / ridged2', () => {
  const pts = Array.from({ length: 400 }, (_, i) => [i * 0.37 - 50, i * 0.71 - 90] as const);

  it('stays in [0, 1)', () => {
    for (const [x, z] of pts) {
      const n = noise2(x, z, 11);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
      const r = ridged2(x, z, 11);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic per seed and differs between seeds', () => {
    const a = pts.map(([x, z]) => noise2(x, z, 3));
    expect(pts.map(([x, z]) => noise2(x, z, 3))).toEqual(a);
    expect(pts.map(([x, z]) => noise2(x, z, 4))).not.toEqual(a);
  });

  it('repeats every 256 units on both axes', () => {
    for (const [x, z] of pts.slice(0, 50)) {
      expect(noise2(x + 256, z, 5)).toBeCloseTo(noise2(x, z, 5), 12);
      expect(noise2(x, z + 256, 5)).toBeCloseTo(noise2(x, z, 5), 12);
    }
  });

  it('is continuous (no jumps across lattice lines)', () => {
    for (let x = -3; x < 3; x += 0.001) {
      expect(Math.abs(noise2(x + 0.001, 0.5, 7) - noise2(x, 0.5, 7))).toBeLessThan(0.01);
    }
  });
});
