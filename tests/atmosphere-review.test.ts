import { describe, expect, it } from 'vitest';
import { LAYOUT, allTiers, buildingContaining, buildingTop } from '../src/city/layout';
import {
  CLOUD_LAYERS,
  RAIN,
  TIME_WRAP,
  searchlightMounts,
  wrapTime,
} from '../src/atmosphere/logic';
import {
  FOG_UNIFORMS,
  HEIGHT_FOG,
  fogFactor,
  heightFogScale,
} from '../src/core/shaders/emissiveFog';

describe('searchlight mounts', () => {
  it('stand on the highest tier (setback / twin aware) of the tallest buildings', () => {
    const tallest = [...LAYOUT.buildings].sort((a, b) => buildingTop(b) - buildingTop(a));
    const mounts = searchlightMounts(LAYOUT.buildings, 2);
    expect(mounts).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const b = tallest[i]!;
      const m = mounts[i]!;
      const tiers = allTiers(b);
      const top = Math.max(...tiers.map((t) => t.y1));
      expect(m.y).toBeCloseTo(top + 4, 6);
      const host = tiers.find((t) => t.y1 === top)!;
      expect(Math.hypot(m.x - host.x, m.z - host.z)).toBeLessThan(1e-6);
      // Just under the roof, the lamp position is inside that building.
      expect(buildingContaining(LAYOUT, m.x, top - 1, m.z)).toBe(b.id);
    }
    expect(searchlightMounts([], 2)).toEqual([]);
  });
});

describe('shader time and altitude', () => {
  it('wraps shader time into a bounded range', () => {
    expect(wrapTime(1234.5, TIME_WRAP.rain)).toBeCloseTo(234.5, 9);
    expect(wrapTime(3 * TIME_WRAP.clouds + 7, TIME_WRAP.clouds)).toBeCloseTo(7, 6);
    expect(wrapTime(5, 1000)).toBe(5);
  });

  it('rain fades around the cloud deck height', () => {
    expect(RAIN.fadeAltitude[0]).toBeLessThan(CLOUD_LAYERS.lowY);
    expect(RAIN.fadeAltitude[1]).toBeGreaterThan(CLOUD_LAYERS.lowY);
  });
});

describe('height fog toggle', () => {
  it('CPU fog mirrors follow ramhaFogHeight.w like the shader', () => {
    const h = FOG_UNIFORMS.ramhaFogHeight.value;
    h[3] = 0;
    expect(heightFogScale(400)).toBe(1);
    expect(fogFactor(0.001, 1000, 400)).toBeCloseTo(1 - Math.exp(-1), 9);
    h[3] = 1;
    expect(heightFogScale(400)).toBeCloseTo(HEIGHT_FOG.top, 9);
  });
});
