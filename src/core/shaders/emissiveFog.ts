// Usage: material.onBeforeCompile = (s) => applyEmissiveFog(s). ShaderMaterials put
// EMISSIVE_FOG_FRAGMENT where <fog_fragment> would go and spread FOG_UNIFORMS next to
// UniformsLib.fog (without them the chunk falls back to plain FogExp2).
import { FAR_EMISSIVE } from '../palette';

export const EMISSIVE_FOG_DENSITY_SCALE = 0.55;
export const EMISSIVE_FOG_GLOW = 0.25;

export const HEIGHT_FOG = {
  heightTop: 260,
  top: 0.35,
  /**
   * Height (m) where the air along a steep camera ray is clear. Between heightTop and here the
   * mean density of a near-vertical ray keeps thinning from `top` to 0, so looking down from far
   * above (topdown) sees little haze. Near-horizontal rays keep the `top` floor, so distant tower
   * tops keep their aerial perspective.
   */
  clearTop: 1040,
  /** Ray steepness (|Δy| / distance) over which the clear-air thinning fades in. */
  clearSteep: [0.6, 0.95],
  water: 1.25,
  /** Heights (m) over which the water boost ramps in; y = 0 ground stays clear of it. */
  waterRamp: [-0.5, -2],
} as const;

const ramp = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** ∫₀^y of the thinning (1 − density factor) with the `top` floor: (1 − top)·min(y / heightTop, 1). */
export function heightFogFloorIntegral(y: number): number {
  const { heightTop: H, top } = HEIGHT_FOG;
  if (y <= 0) return 0;
  return (1 - top) * (y < H ? (y * y) / (2 * H) : y - H / 2);
}

/**
 * ∫₀^y of the clear-air thinning: as the floor integral up to heightTop, then rising linearly to 1
 * at clearTop, 1 above. Shared by the shader (cityFogThin) and the CPU mirror.
 */
export function heightFogThinIntegral(y: number): number {
  const { heightTop: H, top } = HEIGHT_FOG;
  const C = Math.max(HEIGHT_FOG.clearTop, H + 1);
  if (y < H) return heightFogFloorIntegral(y);
  const atH = ((1 - top) * H) / 2;
  if (y < C) {
    const t = y - H;
    return atH + (1 - top) * t + (top * t * t) / (2 * (C - H));
  }
  return atH + (1 - top) * (C - H) + (top * (C - H)) / 2 + (y - C);
}

/** Share of the clear-air thinning a ray of this steepness (|Δy| / distance) gets. */
export function clearAirWeight(steep: number): number {
  return ramp(HEIGHT_FOG.clearSteep[0], HEIGHT_FOG.clearSteep[1], steep);
}

/** Water / park fog boost at height y: 1 on y >= -0.5, HEIGHT_FOG.water from -2 down. */
export function waterFogBoost(y: number): number {
  return 1 + (HEIGHT_FOG.water - 1) * ramp(HEIGHT_FOG.waterRamp[0], HEIGHT_FOG.waterRamp[1], y);
}

export const SUN_SCATTER_POWER = 8;

// Shared Float32Arrays updated in place by atmosphere: UniformsUtils.clone keeps typed arrays
// by reference, so every material sees the same values. All zeros means plain FogExp2.
export const FOG_UNIFORMS = {
  // heightTop, top factor, water factor, enabled (CPU callers pass heightFogEnabled()).
  cityFogHeight: {
    value: new Float32Array([HEIGHT_FOG.heightTop, HEIGHT_FOG.top, HEIGHT_FOG.water, 1]),
  },
  cityFogSun: { value: new Float32Array([0, 1, 0, 0]) },
  cityFogSunColor: { value: new Float32Array([0, 0, 0]) },
};

const f = (n: number): string => n.toFixed(4);

export const EMISSIVE_FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  #ifdef CITY_FOG
    float fogE = cityFogAmount( ${f(EMISSIVE_FOG_DENSITY_SCALE)} );
    vec3 glowFog = cityFogTint() + gl_FragColor.rgb * ${f(EMISSIVE_FOG_GLOW)};
  #else
    #ifdef FOG_EXP2
      float fogD = fogDensity * ${f(EMISSIVE_FOG_DENSITY_SCALE)} * vFogDepth;
      float fogE = 1.0 - exp( - fogD * fogD );
    #else
      float fogE = smoothstep( fogNear, fogFar, vFogDepth ) * ${f(EMISSIVE_FOG_DENSITY_SCALE)};
    #endif
    vec3 glowFog = fogColor + gl_FragColor.rgb * ${f(EMISSIVE_FOG_GLOW)};
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, glowFog, fogE );
#endif
`;

export interface ShaderSource {
  fragmentShader: string;
}

export function applyEmissiveFog(shader: ShaderSource): boolean {
  const chunk = '#include <fog_fragment>';
  if (!shader.fragmentShader.includes(chunk)) return false;
  shader.fragmentShader = shader.fragmentShader.replace(chunk, EMISSIVE_FOG_FRAGMENT);
  return true;
}

/** Whether the height fog is on, as the shaders read it (cityFogHeight.w). */
export function heightFogEnabled(): boolean {
  return (FOG_UNIFORMS.cityFogHeight.value[3] ?? 0) >= 0.5;
}

/**
 * CPU mirror of the shader height fog; pure: pass `enabled` (heightFogEnabled() at run time).
 * `distance`: camera to point (m); the default treats the ray as vertical.
 */
export function heightFogScale(
  worldY: number,
  cameraY = worldY,
  enabled = true,
  distance = Math.abs(worldY - cameraY),
): number {
  if (!enabled) return 1;
  const H = HEIGHT_FOG.heightTop;
  const t = Math.min(1, Math.max(0, worldY / H));
  const s = t * t * (3 - 2 * t);
  let k = 1 + (HEIGHT_FOG.top - 1) * s;
  const lo = Math.max(Math.min(worldY, cameraY), 0);
  const hi = Math.max(Math.max(worldY, cameraY), 0);
  if (hi - lo > 1) {
    const d = hi - lo;
    const floor = 1 - (heightFogFloorIntegral(hi) - heightFogFloorIntegral(lo)) / d;
    const clear = 1 - (heightFogThinIntegral(hi) - heightFogThinIntegral(lo)) / d;
    const w = clearAirWeight(Math.abs(worldY - cameraY) / Math.max(distance, 1e-3));
    k = Math.min(k, floor + (clear - floor) * w);
  }
  return k * waterFogBoost(worldY);
}

export function fogFactor(
  fogDensity: number,
  depth: number,
  worldY = 0,
  cameraY = worldY,
  heightFog = true,
): number {
  const x = fogDensity * depth;
  return Math.min(1, (1 - Math.exp(-x * x)) * heightFogScale(worldY, cameraY, heightFog, depth));
}

export function emissiveFogFactor(
  fogDensity: number,
  depth: number,
  worldY = 0,
  cameraY = worldY,
  heightFog = true,
): number {
  return fogFactor(fogDensity * EMISSIVE_FOG_DENSITY_SCALE, depth, worldY, cameraY, heightFog);
}

const f1 = (v: number): string => v.toFixed(3);

/**
 * GLSL `vec3 farEmissive(vec3 color, float dist)` for point-emitter meshes such as lamp heads, not
 * halos or vehicle sprites (glow.ts dims those its own way; both would darken the far city). Apply
 * it to the final emitted color, after every gain (neonGain, powerOn, intensity) and before fog: a
 * gain multiplied in later lifts it back over the bloom threshold. `dist` is the camera distance
 * in metres. A plain function: it adds no define or program variant.
 */
export const FAR_EMISSIVE_GLSL = /* glsl */ `
vec3 farEmissive( vec3 color, float dist ) {
  float t = smoothstep( ${f1(FAR_EMISSIVE.near)}, ${f1(FAR_EMISSIVE.far)}, dist );
  float lum = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  return color * mix( 1.0, min( 1.0, ${f1(FAR_EMISSIVE.peak)} / max( lum, 1e-4 ) ), t );
}
`;

/** CPU mirror of farEmissive(): the factor its color is multiplied by. */
export function farEmissiveScale(luminance: number, dist: number): number {
  const { near, far, peak } = FAR_EMISSIVE;
  const x = Math.min(1, Math.max(0, (dist - near) / (far - near)));
  const t = x * x * (3 - 2 * x);
  return 1 + (Math.min(1, peak / Math.max(luminance, 1e-4)) - 1) * t;
}
