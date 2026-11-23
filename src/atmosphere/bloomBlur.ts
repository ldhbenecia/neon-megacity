// UnrealBloomPass builds one separable-blur ShaderMaterial per mip, each with its own
// KERNEL_PAIRS define, i.e. 5 programs. These replacements share one program: the taps are padded
// to the largest kernel and the loop stops at a per-mip `pairs` uniform (same taps as before).
import { ShaderMaterial, type IUniform } from 'three';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const BLUR_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BLUR_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D colorTexture;
uniform vec2 invSize;
uniform vec2 direction;
uniform float centerWeight;
uniform int pairs;
uniform float gaussianOffsets[MAX_PAIRS];
uniform float gaussianWeights[MAX_PAIRS];
void main() {
  vec3 sum = texture2D(colorTexture, vUv).rgb * centerWeight;
  for (int i = 0; i < MAX_PAIRS; i++) {
    if (i >= pairs) break;
    vec2 uvOffset = direction * invSize * gaussianOffsets[i];
    sum += (texture2D(colorTexture, vUv + uvOffset).rgb + texture2D(colorTexture, vUv - uvOffset).rgb) * gaussianWeights[i];
  }
  gl_FragColor = vec4(sum, 1.0);
}
`;

function numbers(u: IUniform | undefined): number[] {
  return Array.isArray(u?.value) ? (u.value as number[]) : [];
}

/**
 * Replaces `bloom.separableBlurMaterials` in place; the pass keeps driving their uniforms. If the
 * pass's uniforms ever stop matching (a three upgrade), the original materials are kept: correct
 * bloom with 5 programs beats a silently broken one.
 */
export function shareBlurProgram(bloom: UnrealBloomPass): boolean {
  const mats = bloom.separableBlurMaterials;
  const taps = mats.map((m) => ({
    offsets: numbers(m.uniforms.gaussianOffsets),
    weights: numbers(m.uniforms.gaussianWeights),
  }));
  const usable =
    mats.length > 0 &&
    mats.every((m) => m.uniforms.invSize && m.uniforms.direction && m.uniforms.centerWeight) &&
    taps.every((t) => t.offsets.length > 0 && t.offsets.length === t.weights.length);
  if (!usable) return false;
  const max = Math.max(...taps.map((t) => t.offsets.length));
  const pad = (a: number[]): number[] => [...a, ...new Array<number>(max - a.length).fill(0)];
  for (let i = 0; i < mats.length; i++) {
    const old = mats[i];
    const t = taps[i];
    if (!old || !t) continue;
    const mat = new ShaderMaterial({
      defines: { MAX_PAIRS: max },
      uniforms: {
        colorTexture: { value: null },
        invSize: { value: old.uniforms.invSize?.value as unknown },
        direction: { value: old.uniforms.direction?.value as unknown },
        centerWeight: { value: old.uniforms.centerWeight?.value as unknown },
        pairs: { value: t.offsets.length },
        gaussianOffsets: { value: pad(t.offsets) },
        gaussianWeights: { value: pad(t.weights) },
      },
      vertexShader: BLUR_VERTEX,
      fragmentShader: BLUR_FRAGMENT,
    });
    mat.blending = old.blending;
    mat.transparent = old.transparent;
    mat.depthTest = old.depthTest;
    mat.depthWrite = old.depthWrite;
    mats[i] = mat;
    old.dispose();
  }
  return true;
}
