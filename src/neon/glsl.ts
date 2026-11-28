import * as THREE from 'three';
import { EMISSIVE_FOG_FRAGMENT, FOG_UNIFORMS } from '../core/shaders/emissiveFog';

export interface NeonUniforms {
  uTime: THREE.IUniform<number>;
  uGain: THREE.IUniform<number>;
  uScreenGain: THREE.IUniform<number>;
  uPower: THREE.IUniform<number>;
  uMotion: THREE.IUniform<number>;
  uScroll: THREE.IUniform<number>;
  uWet: THREE.IUniform<number>;
  uNight: THREE.IUniform<number>;
  /** env.skyFill (linear day sky fill for shade, 0 at dusk and night); screens read it. */
  uSkyFill: THREE.IUniform<THREE.Color>;
}

/** Albedo of dark sign boards and LED panels under the day sky fill (env.skyFill). */
export const PANEL_ALBEDO = 0.06;

// Every neon material holds these uniform objects by reference: one write per frame updates all.
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
    uSkyFill: { value: new THREE.Color(0, 0, 0) },
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
// NaN guards: bloom spreads a single NaN pixel into a black block, so never normalize a zero
// vector, never pow a negative base (GLSL leaves it undefined).
vec3 safeNormalize(vec3 v, vec3 fallback) {
  float l2 = dot(v, v);
  return l2 > 1e-12 ? v * inversesqrt(l2) : fallback;
}
float nHash(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
float nHash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float powerOn(float zone, float seed) {
  float t = (uPower - zone) / 0.05;
  if (t <= 0.0) return 0.0;
  if (t >= 1.0) return 1.0;
  float blink = step(0.45, fract(t * 2.0 + seed * 0.13));
  return mix(blink, 1.0, smoothstep(0.75, 1.0, t));
}
float flicker(float seed) {
  float period = mix(8.0, 40.0, nHash(seed));
  float ph = mod(uTime + seed * 37.0, period);
  if (ph > 0.3 || uMotion < 0.5) return 1.0;
  float n = floor(mix(2.0, 5.99, nHash(seed + 1.0)));
  return mix(0.08, 1.0, step(0.5, fract(ph / 0.3 * n)));
}
`;

// Vehicle frame from the packed path texture (traffic lights and bodies).
export const PATH_PARS = /* glsl */ `
uniform sampler2D uPath;
attribute vec4 iPath;
attribute vec4 iMotion;
attribute vec2 iExtra;
vec3 pathAt(float row, float u) {
  int r = int(row + 0.5);
  float n = texelFetch(uPath, ivec2(0, r), 0).w;
  float f = clamp(u, 0.0, 1.0) * (n - 1.0);
  float i = min(floor(f), n - 2.0);
  vec3 a = texelFetch(uPath, ivec2(int(i), r), 0).xyz;
  vec3 b = texelFetch(uPath, ivec2(int(i) + 1, r), 0).xyz;
  return mix(a, b, f - i);
}
float wrapU(float u, float closed) { return closed > 0.5 ? fract(u) : clamp(u, 0.0, 1.0); }
void vehicleFrame(out vec3 P, out vec3 F, out vec3 R, out float fade) {
  float u = fract(iMotion.x + iMotion.y * uTime);
  float ff = iPath.z;
  fade = iPath.y > 0.5 ? 1.0 : smoothstep(0.0, ff, u) * smoothstep(1.0, 1.0 - ff, u);
  float uu = iMotion.z > 0.0 ? u : 1.0 - u;
  float n = texelFetch(uPath, ivec2(0, int(iPath.x + 0.5)), 0).w;
  float du = 1.0 / max(n - 1.0, 1.0);
  vec3 p0 = pathAt(iPath.x, wrapU(uu - du, iPath.y));
  vec3 p1 = pathAt(iPath.x, wrapU(uu + du, iPath.y));
  vec3 d = (p1 - p0) * iMotion.z;
  F = length(d) > 1e-4 ? normalize(d) : vec3(1.0, 0.0, 0.0);
  // A vertical tangent has no horizontal right vector; fall back instead of normalizing zero.
  vec3 r = vec3(-F.z, 0.0, F.x);
  R = dot(r, r) > 1e-12 ? normalize(r) : vec3(0.0, 0.0, 1.0);
  P = pathAt(iPath.x, uu) + R * iMotion.w + vec3(0.0, iExtra.x, 0.0);
  if (iPath.w > 0.5) P.y += sin(uTime * 0.8 + iExtra.y) * 1.2;
}
`;

export const EMISSIVE_TAIL = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${EMISSIVE_FOG_FRAGMENT}
`;

export const ADDITIVE_TAIL = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogD = fogDensity * 0.55 * vFogDepth;
      float fogA = 1.0 - exp( - fogD * fogD );
    #else
      float fogA = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb *= 1.0 - fogA * 0.85;
  #endif
`;

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
      ...THREE.UniformsUtils.clone(FOG_UNIFORMS),
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
  // Transparent DoubleSide meshes are drawn in two passes (back, then front). Additive blending
  // is order independent, so one pass gives the same image at half the draw and fill cost.
  m.forceSinglePass = additive;
  return m;
}
