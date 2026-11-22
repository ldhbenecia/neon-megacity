// Procedural noise for atmosphere shaders. Clouds sample a small tileable fbm texture baked once
// at init instead of evaluating fbm per pixel (much cheaper on integrated GPUs).
import { createRng } from '../core/random';

/**
 * Tileable value-noise fbm, `size`² bytes (0..255), wrapping seamlessly on both axes.
 * Pure and deterministic for a given seed.
 */
export function tileableFbm(size: number, seed: number, octaves = 5): Uint8Array {
  const rng = createRng(seed);
  const out = new Float32Array(size * size);
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = 4 << o; // lattice cells per tile on this octave
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
    const at = (x: number, y: number): number =>
      lattice[(((y % cells) + cells) % cells) * cells + (((x % cells) + cells) % cells)] ?? 0;
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const a = at(x0, y0);
        const b = at(x0 + 1, y0);
        const c = at(x0, y0 + 1);
        const d = at(x0 + 1, y0 + 1);
        const v = a + (b - a) * sx + (c - a + (a - b + d - c) * sx) * sy;
        const idx = y * size + x;
        out[idx] = (out[idx] ?? 0) + v * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  const bytes = new Uint8Array(size * size);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(((out[i] ?? 0) / total) * 255);
  return bytes;
}

/** Cheap GLSL hash used by rain, stars and the lens pass. */
export const HASH_GLSL = /* glsl */ `
float hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
`;
