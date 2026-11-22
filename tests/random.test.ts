import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/random';

const sample = (seed: number, n = 50): number[] => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe('createRng', () => {
  it('is deterministic for the same seed', () => {
    expect(sample(42)).toEqual(sample(42));
  });

  it('differs between seeds', () => {
    expect(sample(1)).not.toEqual(sample(2));
  });

  it('next() stays in [0, 1)', () => {
    for (const v of sample(7, 5000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() is inclusive and bounded', () => {
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(2, 5);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });

  it('range() and pick() stay in bounds', () => {
    const rng = createRng(9);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 1000; i++) {
      const r = rng.range(-3, 8);
      expect(r).toBeGreaterThanOrEqual(-3);
      expect(r).toBeLessThan(8);
      expect(items).toContain(rng.pick(items));
    }
    expect(() => rng.pick([])).toThrow();
  });
});
