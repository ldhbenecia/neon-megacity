// Shared GLSL snippets and the uniform set every neon material reads.
// All motion is driven by `uTime` plus per-instance seeds (5.4): no per-frame CPU updates.
import * as THREE from 'three';
import { EMISSIVE_FOG_FRAGMENT } from '../core/shaders/emissiveFog';

/** Uniforms shared by reference across all neon materials (one write per frame updates all). */
export interface NeonUniforms {
  uTime: THREE.IUniform<number>;
  /** env.neonGain. */
  uGain: THREE.IUniform<number>;
  /** max(env.neonGain, SCREEN_MIN_GAIN) for the giant screens. */
  uScreenGain: THREE.IUniform<number>;
  /** env.powerOn (boot fade-in, per-zone sequence). */
  uPower: THREE.IUniform<number>;
  /** 1 = normal, 0 = prefers-reduced-motion (no flicker / glitch). */
  uMotion: THREE.IUniform<number>;
  /** Scroll speed factor (1, or 0.3 with reduced motion). */
  uScroll: THREE.IUniform<number>;
  /** env.wetness. */
  uWet: THREE.IUniform<number>;
  /** Night factor 0..1 (light pools and decals fade out by day). */
  uNight: THREE.IUniform<number>;
}

export function createNeonUniforms(): NeonUniforms {
  return {
    uTime: { value: 0 },
    uGain: { value: 1 },
    uScreenGain: { value: 1 },
    uPower: { value: 1 },
    uMotion: { value: 1 },
    uScroll: { value: 1 },
    uWet: { value: 0.55 },
    uNight: { value: 1 },
  };
}

export const COMMON_PARS = /* glsl */ `
uniform float uTime;
uniform float uGain;
uniform float uScreenGain;
uniform float uPower;
uniform float uMotion;
uniform float uScroll;
uniform float uWet;
uniform float uNight;
float nHash(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
float nHash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Boot power-on (9.3 step 4): each zone lights at its delay with two blinks.
float powerOn(float zone, float seed) {
  float t = (uPower - zone) / 0.05;
  if (t <= 0.0) return 0.0;
  if (t >= 1.0) return 1.0;
  float blink = step(0.45, fract(t * 2.0 + seed * 0.13));
  return mix(blink, 1.0, smoothstep(0.75, 1.0, t));
}
// 5.4 flicker: 2–5 drop-outs inside 300 ms, every 8–40 s.
float flicker(float seed) {
  float period = mix(8.0, 40.0, nHash(seed));
  float ph = mod(uTime + seed * 37.0, period);
  if (ph > 0.3 || uMotion < 0.5) return 1.0;
  float n = floor(mix(2.0, 5.99, nHash(seed + 1.0)));
  return mix(0.08, 1.0, step(0.5, fract(ph / 0.3 * n)));
}
`;

/** Vertex helpers: fog depth needs `mvPosition` in scope before `#include <fog_vertex>`. */
export const FOG_VERTEX = /* glsl */ `#include <fog_vertex>`;

/** Fragment tail: tone mapping, color space, then the emissive fog chunk (5.5). */
export const EMISSIVE_TAIL = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${EMISSIVE_FOG_FRAGMENT}
`;

/** Fragment tail for additive glows: fades with (emissive-thinned) fog instead of turning grey. */
export const ADDITIVE_TAIL = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogA = 1.0 - exp( - pow( fogDensity * 0.55 * vFogDepth, 2.0 ) );
    #else
      float fogA = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb *= 1.0 - fogA * 0.85;
  #endif
`;

/** Material factory for instanced neon shaders (fog uniforms + shared neon uniforms). */
export function neonMaterial(
  shared: NeonUniforms,
  opts: {
    vertexShader: string;
    fragmentShader: string;
    uniforms?: Record<string, THREE.IUniform>;
    additive?: boolean;
    side?: THREE.Side;
    defines?: Record<string, string | number>;
    depthWrite?: boolean;
    transparent?: boolean;
  },
): THREE.ShaderMaterial {
  const additive = opts.additive ?? false;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...shared,
      ...(opts.uniforms ?? {}),
    },
    vertexShader: opts.vertexShader,
    fragmentShader: opts.fragmentShader,
    defines: opts.defines ?? {},
    fog: true,
    transparent: opts.transparent ?? additive,
    depthWrite: opts.depthWrite ?? !additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: opts.side ?? THREE.FrontSide,
  });
  return m;
}
