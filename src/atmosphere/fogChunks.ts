// Fog ShaderChunk replacement (ART_DIRECTION 7.1). Installed by atmosphere init, before any
// material compiles (compilation happens on the first render / compileAsync, after every init).
//
// Adds to three's FogExp2:
//   - height fog: full density at the ground, ×0.35 above 260 m, ×1.25 under y = 0 (river haze)
//   - sun scattering: fog turns toward the sun color on the sun side (sunset), teal elsewhere
//   - RAMHA_FOG helpers that the emissive chunk (src/core/shaders/emissiveFog.ts) reuses
//
// World-space data comes from the view-space position the standard fog_vertex already needs
// (mvPosition), rotated back with the transposed view matrix: no extra attributes, works for
// instanced and batched meshes, points and sprites alike.
import { ShaderChunk, ShaderLib, type IUniform } from 'three';
import { FOG_UNIFORMS, SUN_SCATTER_POWER } from '../core/shaders/emissiveFog';

const FOG_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif
`;

const FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // camera -> vertex in world space (transpose of the view rotation).
  vFogWorld = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif
`;

const FOG_PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  #define RAMHA_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  uniform vec4 ramhaFogHeight;
  uniform vec4 ramhaFogSun;
  uniform vec3 ramhaFogSunColor;

  float ramhaFogAmount( const in float densityScale ) {
    #ifdef FOG_EXP2
      float fd = fogDensity * densityScale * vFogDepth;
      float fogF = 1.0 - exp( - fd * fd );
    #else
      float fogF = smoothstep( fogNear, fogFar, vFogDepth ) * densityScale;
    #endif
    if ( ramhaFogHeight.w > 0.5 ) {
      float fy = cameraPosition.y + vFogWorld.y;
      float fh = mix( 1.0, ramhaFogHeight.y, smoothstep( 0.0, ramhaFogHeight.x, fy ) );
      fh *= fy < 0.0 ? ramhaFogHeight.z : 1.0;
      fogF = min( fogF * fh, 1.0 );
    }
    return fogF;
  }

  vec3 ramhaFogTint() {
    vec3 fv = normalize( vFogWorld + vec3( 0.0, 1e-4, 0.0 ) );
    float fs = pow( max( dot( fv, ramhaFogSun.xyz ), 0.0 ), ${SUN_SCATTER_POWER.toFixed(1)} ) * ramhaFogSun.w;
    return mix( fogColor, ramhaFogSunColor, fs );
  }
#endif
`;

const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = mix( gl_FragColor.rgb, ramhaFogTint(), ramhaFogAmount( 1.0 ) );
#endif
`;

type FogChunkName = 'fog_pars_vertex' | 'fog_vertex' | 'fog_pars_fragment' | 'fog_fragment';

const REPLACEMENTS: Record<FogChunkName, string> = {
  fog_pars_vertex: FOG_PARS_VERTEX,
  fog_vertex: FOG_VERTEX,
  fog_pars_fragment: FOG_PARS_FRAGMENT,
  fog_fragment: FOG_FRAGMENT,
};

const UNIFORM_NAMES = Object.keys(FOG_UNIFORMS) as (keyof typeof FOG_UNIFORMS)[];

/**
 * Swap three's fog chunks and give every built-in shader that uses fog the shared atmosphere
 * fog uniforms. Returns an uninstall function that restores the originals.
 */
export function installFogChunks(): () => void {
  const original = {} as Record<FogChunkName, string>;
  for (const name of Object.keys(REPLACEMENTS) as FogChunkName[]) {
    original[name] = ShaderChunk[name];
    ShaderChunk[name] = REPLACEMENTS[name];
  }
  const patched: Record<string, IUniform>[] = [];
  for (const lib of Object.values(ShaderLib)) {
    if (!('fogDensity' in lib.uniforms)) continue;
    for (const u of UNIFORM_NAMES) lib.uniforms[u] = FOG_UNIFORMS[u];
    patched.push(lib.uniforms);
  }
  return () => {
    for (const name of Object.keys(original) as FogChunkName[]) ShaderChunk[name] = original[name];
    for (const uniforms of patched)
      for (const u of UNIFORM_NAMES) Reflect.deleteProperty(uniforms, u);
  };
}
