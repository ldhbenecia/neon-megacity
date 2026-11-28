import { describe, expect, it } from 'vitest';
import { ShaderLib } from 'three';
import { FAR_EMISSIVE, PALETTE_KEYS } from '../src/core/palette';
import {
  EMISSIVE_FOG_FRAGMENT,
  FAR_EMISSIVE_GLSL,
  applyEmissiveFog,
  farEmissiveScale,
  emissiveFogFactor,
} from '../src/core/shaders/emissiveFog';

describe('emissive fog chunk', () => {
  it('replaces the standard fog chunk of a built-in material', () => {
    const shader = { fragmentShader: ShaderLib.basic.fragmentShader };
    expect(applyEmissiveFog(shader)).toBe(true);
    expect(shader.fragmentShader).not.toContain('#include <fog_fragment>');
    expect(shader.fragmentShader).toContain(EMISSIVE_FOG_FRAGMENT);
    expect(applyEmissiveFog({ fragmentShader: 'void main() {}' })).toBe(false);
  });

  it('fogs emissives less than ordinary FogExp2 surfaces', () => {
    const density = 0.00105;
    for (const depth of [200, 800, 1500, 3000]) {
      const normal = 1 - Math.exp(-((density * depth) ** 2));
      expect(emissiveFogFactor(density, depth)).toBeLessThan(normal);
    }
    expect(emissiveFogFactor(density, 0)).toBe(0);
    expect(emissiveFogFactor(density, 1e6)).toBeCloseTo(1, 9);
  });
});

describe('far point emitters (farEmissive)', () => {
  it('leaves near emitters alone', () => {
    expect(farEmissiveScale(20, 0)).toBe(1);
    expect(farEmissiveScale(20, FAR_EMISSIVE.near)).toBe(1);
  });

  it('brings a bright far lamp just under every bloom threshold, never to black', () => {
    const lowest = Math.min(...PALETTE_KEYS.map((k) => k.key.bloomThreshold));
    for (const lum of [1, 6, 40]) {
      const out = lum * farEmissiveScale(lum, FAR_EMISSIVE.far + 500);
      expect(out).toBeCloseTo(FAR_EMISSIVE.peak, 6);
      expect(out).toBeLessThan(lowest);
    }
    expect(FAR_EMISSIVE.peak).toBeGreaterThan(0.5);
  });

  it('keeps dim emitters as they are at any distance', () => {
    expect(farEmissiveScale(0.3, 5000)).toBe(1);
  });

  it('fades in between near and far', () => {
    const mid = farEmissiveScale(10, (FAR_EMISSIVE.near + FAR_EMISSIVE.far) / 2);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(FAR_EMISSIVE.peak / 10);
  });

  it('GLSL carries the same constants', () => {
    expect(FAR_EMISSIVE_GLSL).toContain(
      `smoothstep( ${FAR_EMISSIVE.near.toFixed(3)}, ${FAR_EMISSIVE.far.toFixed(3)}, dist )`,
    );
    expect(FAR_EMISSIVE_GLSL).toContain(`${FAR_EMISSIVE.peak.toFixed(3)} / max( lum, 1e-4 )`);
  });
});
