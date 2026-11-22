// Emissive fog attenuation chunk (ART_DIRECTION 5.5). Created in PR0 with a minimal,
// interface-stable implementation; owned and tuned by atmosphere afterwards.
//
// Emissive materials (signs, screens, neon tubes, lit windows) must not fade to the near-black
// fog color like ordinary surfaces. They fog with a thinner density and toward a glow tinted
// by their own color, so distant neon reads as a halo instead of a black rectangle.
//
// Usage (built-in material):
//   material.onBeforeCompile = (shader) => applyEmissiveFog(shader);
// Usage (ShaderMaterial with `fog: true`): include <fog_pars_vertex>/<fog_vertex> and
//   <fog_pars_fragment> as usual, then put EMISSIVE_FOG_FRAGMENT where <fog_fragment> would go.
// The chunk reads three's standard fog uniforms (fogColor, fogDensity / fogNear, fogFar) and
// vFogDepth, so it follows scene.fog automatically.

/** Emissive fog density relative to ordinary materials. */
export const EMISSIVE_FOG_DENSITY_SCALE = 0.55;
/** How much of the emissive color bleeds into the fog it fades toward. */
export const EMISSIVE_FOG_GLOW = 0.25;

const f = (n: number): string => n.toFixed(4);

/** GLSL replacement for `#include <fog_fragment>` in emissive materials. */
export const EMISSIVE_FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogE = 1.0 - exp( - pow( fogDensity * ${f(EMISSIVE_FOG_DENSITY_SCALE)} * vFogDepth, 2.0 ) );
  #else
    float fogE = smoothstep( fogNear, fogFar, vFogDepth ) * ${f(EMISSIVE_FOG_DENSITY_SCALE)};
  #endif
  vec3 glowFog = fogColor + gl_FragColor.rgb * ${f(EMISSIVE_FOG_GLOW)};
  gl_FragColor.rgb = mix( gl_FragColor.rgb, glowFog, fogE );
#endif
`;

/** Shader object shape passed to `onBeforeCompile` (only the field we touch). */
export interface ShaderSource {
  fragmentShader: string;
}

/** Swap the standard fog chunk for the emissive one. Returns true when the chunk was found. */
export function applyEmissiveFog(shader: ShaderSource): boolean {
  const chunk = '#include <fog_fragment>';
  if (!shader.fragmentShader.includes(chunk)) return false;
  shader.fragmentShader = shader.fragmentShader.replace(chunk, EMISSIVE_FOG_FRAGMENT);
  return true;
}

/** CPU mirror of the FogExp2 branch (for tests, halo sprites and LOD decisions). */
export function emissiveFogFactor(fogDensity: number, depth: number): number {
  const x = fogDensity * EMISSIVE_FOG_DENSITY_SCALE * depth;
  return 1 - Math.exp(-x * x);
}
