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
  if (period > LATTICE || !Number.isInteger(period)) {
    throw new RangeError(`noise1 period must be an integer ≤ ${LATTICE}, got ${period}`);
  }
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

/**
 * Fractal sum of `octaves` noise layers, normalized to [0, 1).
 * With `period` > 0, `period * 2^(octaves - 1)` must stay ≤ 256 (noise1 throws otherwise).
 */
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

const perms = new Map<number, Uint8Array>();
function perm(seed: number): Uint8Array {
  let p = perms.get(seed);
  if (!p) {
    const rng = createRng(seed ^ 0x5bd1e995);
    p = new Uint8Array(LATTICE);
    for (let i = 0; i < LATTICE; i++) p[i] = i;
    for (let i = LATTICE - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const tmp = p[i] as number;
      p[i] = p[j] as number;
      p[j] = tmp;
    }
    perms.set(seed, p);
  }
  return p;
}

/** Smooth 2D value noise in [0, 1) (repeats every 256 units on both axes). */
export function noise2(x: number, z: number, seed: number): number {
  const t = table(seed);
  const p = perm(seed);
  const i0 = Math.floor(x);
  const j0 = Math.floor(z);
  const f = x - i0;
  const g = z - j0;
  const v = (i: number, j: number): number => t[(i + (p[j & 255] as number)) & 255] as number;
  const a = v(i0, j0);
  const b = v(i0 + 1, j0);
  const c = v(i0, j0 + 1);
  const d = v(i0 + 1, j0 + 1);
  const sf = f * f * (3 - 2 * f);
  const sg = g * g * (3 - 2 * g);
  return a + (b - a) * sf + (c - a) * sg + (a - b - c + d) * sf * sg;
}

/**
 * Ridged 2D fbm in [0, 1]: each octave folds the noise around 0.5 so creases become sharp
 * crests (spurs) with rounded valleys between them.
 */
export function ridged2(x: number, z: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    const r = 1 - Math.abs(2 * noise2(x * freq, z * freq, seed + o * 131) - 1);
    sum += amp * r * r;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
