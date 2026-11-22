// Emissive fog attenuation chunk (ART_DIRECTION 5.5) and the shared atmosphere fog uniforms.
// Owned by atmosphere.
//
// Emissive materials (signs, screens, neon tubes, lit windows) must not fade to the near-black
// fog color like ordinary surfaces. They fog with a thinner density and toward a glow tinted
// by their own color, so distant neon reads as a halo instead of a black rectangle.
//
// Usage (built-in material):
//   material.onBeforeCompile = (shader) => applyEmissiveFog(shader);
// Usage (ShaderMaterial with `fog: true`): include <fog_pars_vertex>/<fog_vertex> and
//   <fog_pars_fragment> as usual, then put EMISSIVE_FOG_FRAGMENT where <fog_fragment> would go.
//   Spread `FOG_UNIFORMS` next to `UniformsLib.fog` so the height fog and sun scattering of the
//   atmosphere chunks apply too (without them the chunk falls back to plain FogExp2).
// The chunk reads three's standard fog uniforms (fogColor, fogDensity / fogNear, fogFar) and
// vFogDepth, so it follows scene.fog automatically.
//
// The atmosphere module replaces three's fog chunks at init (src/atmosphere/fogChunks.ts):
// those define RAMHA_FOG plus the helpers `ramhaFogAmount(scale)` / `ramhaFogTint()` used below.

/** Emissive fog density relative to ordinary materials. */
export const EMISSIVE_FOG_DENSITY_SCALE = 0.55;
/** How much of the emissive color bleeds into the fog it fades toward. */
export const EMISSIVE_FOG_GLOW = 0.25;

/** Height fog (ART_DIRECTION 7.1): full density at y = 0, `top` factor above `heightTop`. */
export const HEIGHT_FOG = {
  /** World y (m) where the height falloff reaches its floor. */
  heightTop: 260,
  /** Fog multiplier at and above `heightTop`. */
  top: 0.35,
  /** Fog multiplier below y = 0 (river surface haze). */
  water: 1.25,
} as const;

/** Exponent of the sun-side fog scattering lobe, pow(dot(view, sun), n). */
export const SUN_SCATTER_POWER = 8;

/**
 * Uniforms read by the atmosphere fog chunks. Values are shared Float32Arrays that atmosphere
 * updates in place every frame, so every material that holds these uniform objects (built-in
 * materials get them injected through ShaderLib; ShaderMaterials spread them) sees the same
 * values. `UniformsUtils.clone` keeps typed arrays by reference, so cloning preserves sharing.
 * All zeros (a material without these uniforms) means "plain FogExp2".
 */
export const FOG_UNIFORMS = {
  /** x = heightTop (m), y = factor at the top, z = factor under water, w = 1 enables. */
  ramhaFogHeight: {
    value: new Float32Array([HEIGHT_FOG.heightTop, HEIGHT_FOG.top, HEIGHT_FOG.water, 0]),
  },
  /** xyz = unit vector toward the sun, w = scattering strength 0..1. */
  ramhaFogSun: { value: new Float32Array([0, 1, 0, 0]) },
  /** Linear RGB of the sun-side fog color. */
  ramhaFogSunColor: { value: new Float32Array([0, 0, 0]) },
};

const f = (n: number): string => n.toFixed(4);

/** GLSL replacement for `#include <fog_fragment>` in emissive materials. */
export const EMISSIVE_FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  #ifdef RAMHA_FOG
    float fogE = ramhaFogAmount( ${f(EMISSIVE_FOG_DENSITY_SCALE)} );
    vec3 glowFog = ramhaFogTint() + gl_FragColor.rgb * ${f(EMISSIVE_FOG_GLOW)};
  #else
    #ifdef FOG_EXP2
      float fogE = 1.0 - exp( - pow( fogDensity * ${f(EMISSIVE_FOG_DENSITY_SCALE)} * vFogDepth, 2.0 ) );
    #else
      float fogE = smoothstep( fogNear, fogFar, vFogDepth ) * ${f(EMISSIVE_FOG_DENSITY_SCALE)};
    #endif
    vec3 glowFog = fogColor + gl_FragColor.rgb * ${f(EMISSIVE_FOG_GLOW)};
  #endif
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

/**
 * CPU mirror of the height falloff in the fog chunk: 1 at the ground, HEIGHT_FOG.top up high.
 * With `cameraY`, the mean density along the camera ray (linear ramp) is used when it is lower,
 * as the shader does, so looking down from high up is not fogged like looking along the ground.
 */
export function heightFogScale(worldY: number, cameraY = worldY): number {
  const H = HEIGHT_FOG.heightTop;
  const t = Math.min(1, Math.max(0, worldY / H));
  const s = t * t * (3 - 2 * t);
  let k = 1 + (HEIGHT_FOG.top - 1) * s;
  const lo = Math.max(Math.min(worldY, cameraY), 0);
  const hi = Math.max(Math.max(worldY, cameraY), 0);
  if (hi - lo > 1) {
    const F = (y: number): number => (y < H ? (y * y) / (2 * H) : y - H / 2);
    k = Math.min(k, 1 - ((1 - HEIGHT_FOG.top) * (F(hi) - F(lo))) / (hi - lo));
  }
  return worldY < 0 ? k * HEIGHT_FOG.water : k;
}

/** CPU mirror of the ordinary FogExp2 factor with height fog, as the atmosphere chunk computes it. */
export function fogFactor(fogDensity: number, depth: number, worldY = 0, cameraY = worldY): number {
  const x = fogDensity * depth;
  return Math.min(1, (1 - Math.exp(-x * x)) * heightFogScale(worldY, cameraY));
}

/**
 * CPU mirror of the emissive FogExp2 factor (for tests, halo sprites and LOD decisions).
 * `worldY` / `cameraY` apply the height fog like the shader; omit them for ground level.
 */
export function emissiveFogFactor(
  fogDensity: number,
  depth: number,
  worldY = 0,
  cameraY = worldY,
): number {
  return fogFactor(fogDensity * EMISSIVE_FOG_DENSITY_SCALE, depth, worldY, cameraY);
}
