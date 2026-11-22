// Deterministic seeded PRNG (mulberry32) so every module sees the same city.
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Uniformly chosen element. `arr` must be non-empty. */
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
}

export function createRng(seed = 1): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    pick: <T>(arr: readonly T[]): T => {
      if (arr.length === 0) throw new Error('pick() on empty array');
      return arr[Math.floor(next() * arr.length)] as T;
    },
    chance: (p) => next() < p,
  };
}
