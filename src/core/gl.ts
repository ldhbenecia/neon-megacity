import type { WebGLRenderer } from 'three';
import type { Quality } from './types';

/** Half-float color render targets (atmosphere's HDR scene target needs them). */
export function halfFloatTargets(renderer: WebGLRenderer): boolean {
  const ext = renderer.extensions;
  return ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
}

/**
 * Whether atmosphere runs its post chain. main uses the same answer to drop canvas MSAA, so any new
 * condition for post goes here, not into atmosphere alone.
 */
export function postEnabled(quality: Quality, renderer: WebGLRenderer): boolean {
  return quality !== 'ci' && halfFloatTargets(renderer);
}
