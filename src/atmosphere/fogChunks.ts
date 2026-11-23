// Must run before any material compiles: three resolves #include chunks at compile time.
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
  // v * M multiplies by the transpose: view-space offset back to world space.
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
      // Seen from above, the lower mean density along the ray keeps topdown readable.
      float fH = ramhaFogHeight.x;
      float fLo = max( min( fy, cameraPosition.y ), 0.0 );
      float fHi = max( max( fy, cameraPosition.y ), 0.0 );
      if ( fHi - fLo > 1.0 ) {
        float fA = fLo < fH ? fLo * fLo / ( 2.0 * fH ) : fLo - 0.5 * fH;
        float fB = fHi < fH ? fHi * fHi / ( 2.0 * fH ) : fHi - 0.5 * fH;
        fh = min( fh, 1.0 - ( 1.0 - ramhaFogHeight.y ) * ( fB - fA ) / ( fHi - fLo ) );
      }
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
