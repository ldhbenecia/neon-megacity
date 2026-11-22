import { describe, expect, it } from 'vitest';
import {
  DAY,
  NIGHT,
  PALETTE_KEYS,
  SUNSET,
  hexToRgb,
  paletteAt,
  type PaletteSample,
} from '../src/core/palette';

const close = (a: readonly number[], b: readonly number[]) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));

describe('paletteAt', () => {
  it('returns the table values on the plateaus', () => {
    for (const [t, key] of [
      [0, NIGHT],
      [0.1, NIGHT],
      [0.95, NIGHT],
      [0.5, DAY],
      [0.45, DAY],
      [0.78, SUNSET],
    ] as const) {
      const p = paletteAt(t);
      close(p.skyColor, hexToRgb(key.skyColor));
      close(p.fogColor, hexToRgb(key.fogColor));
      expect(p.fogDensity).toBeCloseTo(key.fogDensity, 12);
      expect(p.toneMappingExposure).toBeCloseTo(key.toneMappingExposure, 12);
      expect(p.neonGain).toBeCloseTo(key.neonGain, 12);
    }
  });

  it('matches the documented exposure, neon gain and bloom targets', () => {
    expect([NIGHT, SUNSET, DAY].map((k) => k.toneMappingExposure)).toEqual([1.0, 0.92, 0.78]);
    expect([NIGHT, SUNSET, DAY].map((k) => k.neonGain)).toEqual([1.0, 0.7, 0.3]);
    expect([NIGHT, SUNSET, DAY].map((k) => k.bloomThreshold)).toEqual([0.85, 0.9, 1.0]);
    expect(NIGHT.windowLitRatio).toBeGreaterThanOrEqual(0.25);
    expect(NIGHT.windowLitRatio).toBeLessThanOrEqual(0.4);
  });

  it('wraps around midnight', () => {
    expect(paletteAt(1)).toEqual(paletteAt(0));
    expect(paletteAt(1.5)).toEqual(paletteAt(0.5));
    expect(paletteAt(-0.25)).toEqual(paletteAt(0.75));
  });

  it('is continuous', () => {
    const fields = Object.keys(paletteAt(0)) as (keyof PaletteSample)[];
    const flat = (p: PaletteSample) =>
      fields.flatMap((f) => {
        const v = p[f];
        return typeof v === 'number' ? [v] : [...v];
      });
    let prev = flat(paletteAt(0));
    for (let i = 1; i <= 2000; i++) {
      const cur = flat(paletteAt(i / 2000));
      cur.forEach((v, k) => {
        expect(Math.abs(v - prev[k]!)).toBeLessThan(0.05 + Math.abs(prev[k]!) * 0.05);
      });
      prev = cur;
    }
  });

  it('has sorted keyframes from 0 to 1', () => {
    expect(PALETTE_KEYS[0]!.t).toBe(0);
    expect(PALETTE_KEYS.at(-1)!.t).toBe(1);
    for (let i = 1; i < PALETTE_KEYS.length; i++) {
      expect(PALETTE_KEYS[i]!.t).toBeGreaterThan(PALETTE_KEYS[i - 1]!.t);
    }
  });
});
