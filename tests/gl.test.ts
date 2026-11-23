import { describe, expect, it } from 'vitest';
import type { WebGLRenderer } from 'three';
import { halfFloatTargets, postEnabled } from '../src/core/gl';

const renderer = (exts: string[]): WebGLRenderer =>
  ({ extensions: { has: (n: string) => exts.includes(n) } }) as unknown as WebGLRenderer;

describe('postEnabled', () => {
  it('needs a half-float color buffer extension', () => {
    expect(halfFloatTargets(renderer(['EXT_color_buffer_float']))).toBe(true);
    expect(halfFloatTargets(renderer(['EXT_color_buffer_half_float']))).toBe(true);
    expect(halfFloatTargets(renderer([]))).toBe(false);
  });

  it('is off in the low tier and without half-float targets', () => {
    expect(postEnabled('high', renderer(['EXT_color_buffer_float']))).toBe(true);
    expect(postEnabled('low', renderer(['EXT_color_buffer_float']))).toBe(false);
    expect(postEnabled('high', renderer([]))).toBe(false);
  });
});
