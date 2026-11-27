// Usage: material.onBeforeCompile = (s) => applyEmissiveFog(s). ShaderMaterials put
// EMISSIVE_FOG_FRAGMENT where <fog_fragment> would go and spread FOG_UNIFORMS next to
// UniformsLib.fog (without them the chunk falls back to plain FogExp2).
export const EMISSIVE_FOG_DENSITY_SCALE = 0.55;
export const EMISSIVE_FOG_GLOW = 0.25;

export const HEIGHT_FOG = {
  heightTop: 260,
  top: 0.35,
  /**
   * Height (m) where the air along a camera ray is clear. Between heightTop and here the ray's
   * mean density keeps thinning from `top` to 0, so looking down from far above (topdown) sees
   * little haze. The fog at a point's own height still stops at `top`, so horizontal views of
   * tower tops keep their aerial perspective.
   */
  clearTop: 1040,
  water: 1.25,
  /** Below this height (m) a point counts as water or park; y = 0 ground stays clear of it. */
  waterBelow: -1,
} as const;

/**
 * ∫₀^y of the thinning (1 − density factor) along a vertical ray: (1 − top)·y/heightTop up to
 * heightTop, then rising linearly to 1 at clearTop, 1 above. Shared by the shader and the CPU mirror.
 */
export function heightFogThinIntegral(y: number): number {
  const { heightTop: H, top, clearTop: C } = HEIGHT_FOG;
  if (y <= 0) return 0;
  if (y < H) return ((1 - top) * y * y) / (2 * H);
  const atH = ((1 - top) * H) / 2;
  if (y < C) {
    const t = y - H;
    return atH + (1 - top) * t + (top * t * t) / (2 * (C - H));
  }
  return atH + (1 - top) * (C - H) + (top * (C - H)) / 2 + (y - C);
}

export const SUN_SCATTER_POWER = 8;

// Shared Float32Arrays updated in place by atmosphere: UniformsUtils.clone keeps typed arrays
// by reference, so every material sees the same values. All zeros means plain FogExp2.
export const FOG_UNIFORMS = {
  // heightTop, top factor, water factor, enabled (the CPU mirrors read it too).
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

export function heightFogScale(worldY: number, cameraY = worldY): number {
  if ((FOG_UNIFORMS.cityFogHeight.value[3] ?? 0) < 0.5) return 1;
  const H = HEIGHT_FOG.heightTop;
  const t = Math.min(1, Math.max(0, worldY / H));
  const s = t * t * (3 - 2 * t);
  let k = 1 + (HEIGHT_FOG.top - 1) * s;
  const lo = Math.max(Math.min(worldY, cameraY), 0);
  const hi = Math.max(Math.max(worldY, cameraY), 0);
  if (hi - lo > 1) {
    const F = heightFogThinIntegral;
    k = Math.min(k, 1 - (F(hi) - F(lo)) / (hi - lo));
  }
  return worldY < HEIGHT_FOG.waterBelow ? k * HEIGHT_FOG.water : k;
}

export function fogFactor(fogDensity: number, depth: number, worldY = 0, cameraY = worldY): number {
  const x = fogDensity * depth;
  return Math.min(1, (1 - Math.exp(-x * x)) * heightFogScale(worldY, cameraY));
}

export function emissiveFogFactor(
  fogDensity: number,
  depth: number,
  worldY = 0,
  cameraY = worldY,
): number {
  return fogFactor(fogDensity * EMISSIVE_FOG_DENSITY_SCALE, depth, worldY, cameraY);
}
