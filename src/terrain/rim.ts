import * as THREE from 'three';
import type { Ridge } from '../city/layout';
import { RIDGE_COLORS } from '../core/palette';
import { HORIZON_SIDE_GLSL } from '../lighting/horizonGlsl';
import { MAP_HALF_X, MAP_HALF_Z } from './shape';
import type { RidgeEnv } from './ridges';

/** Widest band (m) before the near ridge over which ground and water take its base color. */
export const RIM_BAND = 1800;
/** Clearance (m) between the map's corners and the start of the band. */
const RIM_CLEAR = 100;

/**
 * Fog the near ridge's bottom carries (ridges.ts: its `fog` plus the 0.22 mist at the base), so
 * ground and water end in the very color the wall starts with.
 */
export function rimWallFog(ridge: Pick<Ridge, 'fog'>): number {
  return ridge.fog + (1 - ridge.fog) * 0.22;
}

/**
 * Radii (m) where the band starts and ends: it ends at the near ridge and starts outside the
 * map's corners, so ground and river under the city's roads and buildings never darken.
 */
export function rimBand(ridge: Pick<Ridge, 'radius'>): { start: number; end: number } {
  const corner = Math.hypot(MAP_HALF_X, MAP_HALF_Z) + RIM_CLEAR;
  return { start: Math.max(ridge.radius - RIM_BAND, corner), end: ridge.radius };
}

/** 0 inside, 1 at the near ridge: smoothstep over rimBand, as the shader does. */
export function rimWeight(r: number, band: { start: number; end: number }): number {
  const t = Math.min(1, Math.max(0, (r - band.start) / (band.end - band.start)));
  return t * t * (3 - 2 * t);
}

export interface Rim {
  /** Patches a built-in material's shader (fog chunk present); also sets its program cache key. */
  patch(material: THREE.Material): void;
  /** Patches an onBeforeCompile shader that already exists (the water). */
  patchShader(shader: THREE.WebGLProgramParametersWithUniforms): void;
  update(env: RidgeEnv): void;
}

/**
 * Ground, river channel and water fade into the near ridge's base color toward the map edge, as
 * the ridge shader colors it (horizon side, day tint, rain fog), so the disc's rim never shows.
 */
export function createRim(ridge: Ridge): Rim {
  const u = {
    uRimHorizon: { value: new THREE.Color() },
    uRimHorizonAnti: { value: new THREE.Color() },
    uRimSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uRimDay: { value: 0 },
    uRimRain: { value: 0 },
    uRimFogColor: { value: new THREE.Color() },
    uRimBase: { value: new THREE.Color().setHex(RIDGE_COLORS[ridge.id]) },
  };
  const f = (v: number): string => v.toFixed(3);
  const band = rimBand(ridge);
  const fog = rimWallFog(ridge);
  const pars = /* glsl */ `
uniform vec3 uRimHorizon;
uniform vec3 uRimHorizonAnti;
uniform vec3 uRimSunDir;
uniform float uRimDay;
uniform float uRimRain;
uniform vec3 uRimFogColor;
uniform vec3 uRimBase;
varying vec3 vRimWorld;
${HORIZON_SIDE_GLSL}
`;
  const tail = /* glsl */ `
{
  vec3 rimDir = normalize( vRimWorld - cameraPosition );
  vec3 rimHz = mix( uRimHorizonAnti, uRimHorizon, pow( horizonSide( rimDir, uRimSunDir ), 2.2 ) );
  vec3 rimBase = mix( uRimBase, rimHz * 0.28, uRimDay );
  float rimFog = 1.0 - ( 1.0 - ${f(fog)} ) * ( 1.0 - 0.75 * uRimRain );
  vec3 rimWall = mix( rimBase, mix( rimHz, uRimFogColor, uRimRain ), rimFog );
  // Mixed after fog_fragment, i.e. after tone mapping and output encoding: without post (canvas
  // output) the wall color goes through both, as the ridge shader's own color does.
  #ifdef TONE_MAPPING
    rimWall = toneMapping( rimWall );
  #endif
  rimWall = linearToOutputTexel( vec4( rimWall, 1.0 ) ).rgb;
  float rimT = smoothstep( ${f(band.start)}, ${f(band.end)}, length( vRimWorld.xz ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, rimWall, rimT );
}
`;
  const patchShader = (shader: THREE.WebGLProgramParametersWithUniforms): void => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRimWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvRimWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${pars}`)
      .replace('#include <fog_fragment>', `#include <fog_fragment>\n${tail}`);
  };
  return {
    patch(material) {
      material.onBeforeCompile = patchShader;
      material.customProgramCacheKey = () =>
        `terrain-rim:${f(band.start)}:${f(band.end)}:${f(fog)}`;
    },
    patchShader,
    update(env) {
      u.uRimHorizon.value.copy(env.horizon);
      u.uRimHorizonAnti.value.copy(env.horizonAnti);
      u.uRimSunDir.value.copy(env.sunDirection);
      u.uRimDay.value = env.dayFactor;
      u.uRimRain.value = env.rain;
      u.uRimFogColor.value.copy(env.fogColor);
    },
  };
}
