import * as THREE from 'three';
import type { Ridge } from '../city/layout';
import { RIDGE_COLORS } from '../core/palette';
import { HORIZON_SIDE_GLSL } from '../lighting/horizonGlsl';
import type { RidgeEnv } from './ridges';

/** Width (m) of the band before the near ridge over which ground and water take its base color. */
export const RIM_BAND = 1800;

/**
 * Fog the near ridge's bottom carries (ridges.ts: its `fog` plus the 0.22 mist at the base), so
 * ground and water end in the very color the wall starts with.
 */
export function rimWallFog(ridge: Pick<Ridge, 'fog'>): number {
  return ridge.fog + (1 - ridge.fog) * 0.22;
}

/** 0 inside, 1 at the near ridge: smoothstep over the last RIM_BAND metres. */
export function rimWeight(r: number, radius: number): number {
  const t = Math.min(1, Math.max(0, (r - (radius - RIM_BAND)) / RIM_BAND));
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
  float rimFog = 1.0 - ( 1.0 - ${f(rimWallFog(ridge))} ) * ( 1.0 - 0.75 * uRimRain );
  vec3 rimWall = mix( rimBase, mix( rimHz, uRimFogColor, uRimRain ), rimFog );
  float rimT = smoothstep( ${f(ridge.radius - RIM_BAND)}, ${f(ridge.radius)}, length( vRimWorld.xz ) );
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
      material.customProgramCacheKey = () => 'terrain-rim';
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
