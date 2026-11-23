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

/** Replaces `bloom.separableBlurMaterials` in place; the pass keeps driving their uniforms. */
export function shareBlurProgram(bloom: UnrealBloomPass): void {
  const mats = bloom.separableBlurMaterials;
  const max = Math.max(...mats.map((m) => numbers(m.uniforms.gaussianOffsets).length));
  for (let i = 0; i < mats.length; i++) {
    const old = mats[i];
    if (!old) continue;
    const offsets = numbers(old.uniforms.gaussianOffsets);
    const pad = (a: number[]): number[] => [...a, ...new Array<number>(max - a.length).fill(0)];
    mats[i] = new ShaderMaterial({
      defines: { MAX_PAIRS: max },
      uniforms: {
        colorTexture: { value: null },
        invSize: { value: old.uniforms.invSize?.value as unknown },
        direction: { value: old.uniforms.direction?.value as unknown },
        centerWeight: { value: old.uniforms.centerWeight?.value as unknown },
        pairs: { value: offsets.length },
        gaussianOffsets: { value: pad(offsets) },
        gaussianWeights: { value: pad(numbers(old.uniforms.gaussianWeights)) },
      },
      vertexShader: BLUR_VERTEX,
      fragmentShader: BLUR_FRAGMENT,
    });
    old.dispose();
  }
}
