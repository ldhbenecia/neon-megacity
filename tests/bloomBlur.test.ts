import { describe, expect, it } from 'vitest';
import { Vector2, type ShaderMaterial } from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { shareBlurProgram } from '../src/atmosphere/bloomBlur';

const nums = (m: ShaderMaterial, name: string): number[] => m.uniforms[name]?.value as number[];

describe('shareBlurProgram', () => {
  it('keeps every mip blur identical while sharing one shader', () => {
    const bloom = new UnrealBloomPass(new Vector2(256, 256), 0.7, 0.4, 0.85);
    const before = bloom.separableBlurMaterials.map((m) => ({
      pairs: Number(m.defines.KERNEL_PAIRS),
      offsets: [...nums(m, 'gaussianOffsets')],
      weights: [...nums(m, 'gaussianWeights')],
      center: m.uniforms.centerWeight?.value as number,
      invSize: m.uniforms.invSize?.value as Vector2,
      blending: m.blending,
      depthTest: m.depthTest,
    }));
    expect(shareBlurProgram(bloom)).toBe(true);
    const after = bloom.separableBlurMaterials;
    expect(after).toHaveLength(before.length);
    after.forEach((m, i) => {
      const b = before[i]!;
      expect(m.fragmentShader).toBe(after[0]!.fragmentShader);
      expect(m.defines).toEqual(after[0]!.defines);
      expect(m.uniforms.pairs?.value).toBe(b.pairs);
      expect(nums(m, 'gaussianOffsets').slice(0, b.pairs)).toEqual(b.offsets);
      expect(nums(m, 'gaussianWeights').slice(0, b.pairs)).toEqual(b.weights);
      expect(
        nums(m, 'gaussianWeights')
          .slice(b.pairs)
          .every((w) => w === 0),
      ).toBe(true);
      expect(m.uniforms.centerWeight?.value).toBe(b.center);
      expect(m.uniforms.invSize?.value).toBe(b.invSize);
      expect(m.blending).toBe(b.blending);
      expect(m.depthTest).toBe(b.depthTest);
    });
    bloom.dispose();
  });

  it('leaves the pass alone when its uniforms do not match', () => {
    const bloom = new UnrealBloomPass(new Vector2(64, 64), 1, 0.4, 0.85);
    const first = bloom.separableBlurMaterials[0]!;
    delete first.uniforms.gaussianWeights;
    const mats = [...bloom.separableBlurMaterials];
    expect(shareBlurProgram(bloom)).toBe(false);
    expect(bloom.separableBlurMaterials).toEqual(mats);
    bloom.dispose();
  });
});
