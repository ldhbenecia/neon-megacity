import { describe, expect, it } from 'vitest';
import { ShaderLib } from 'three';
import {
  EMISSIVE_FOG_FRAGMENT,
  applyEmissiveFog,
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
