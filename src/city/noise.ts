// Deterministic 1D value noise / fbm. Lattice values come from createRng so every
// module (and every test) sees the same terrain and ridge profiles.
import { createRng } from '../core/random';

const LATTICE = 256;

function lattice(seed: number): Float64Array {
  const rng = createRng(seed);
  const t = new Float64Array(LATTICE);
  for (let i = 0; i < LATTICE; i++) t[i] = rng.next();
  return t;
}

const cache = new Map<number, Float64Array>();
function table(seed: number): Float64Array {
  let t = cache.get(seed);
  if (!t) {
    t = lattice(seed);
    cache.set(seed, t);
  }
  return t;
}

/**
 * Smooth 1D value noise in [0, 1). With `period` > 0 the noise repeats every `period` units
 * (period must be an integer ≤ 256), which keeps ring profiles seamless.
 */
export function noise1(x: number, seed: number, period = 0): number {
  const t = table(seed);
  const i0 = Math.floor(x);
  const f = x - i0;
  const wrap = (i: number): number => {
    const m = period > 0 ? period : LATTICE;
    return ((i % m) + m) % m;
  };
  const a = t[wrap(i0)] ?? 0;
  const b = t[wrap(i0 + 1)] ?? 0;
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}

/** Fractal sum of `octaves` noise layers, normalized to [0, 1). */
export function fbm1(x: number, seed: number, octaves = 4, period = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise1(x * freq, seed + o * 101, period > 0 ? period * freq : 0);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
