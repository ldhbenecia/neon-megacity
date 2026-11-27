// Must run before any material compiles: three resolves #include chunks at compile time.
import { ShaderChunk, ShaderLib, type IUniform } from 'three';
import { FOG_UNIFORMS, HEIGHT_FOG, SUN_SCATTER_POWER } from '../core/shaders/emissiveFog';

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
  #define CITY_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  uniform vec4 cityFogHeight;
  uniform vec4 cityFogSun;
  uniform vec3 cityFogSunColor;

  // heightFogThinIntegral (emissiveFog.ts): thinning integrated up a vertical ray.
  float cityFogThin( float y, float h ) {
    float top = cityFogHeight.y;
    float c = ${HEIGHT_FOG.clearTop.toFixed(1)};
    if ( y < h ) return ( 1.0 - top ) * y * y / ( 2.0 * h );
    float atH = ( 1.0 - top ) * h * 0.5;
    if ( y < c ) {
      float t = y - h;
      return atH + ( 1.0 - top ) * t + top * t * t / ( 2.0 * ( c - h ) );
    }
    return atH + ( 1.0 - top ) * ( c - h ) + top * ( c - h ) * 0.5 + ( y - c );
  }

  float cityFogAmount( const in float densityScale ) {
    #ifdef FOG_EXP2
      float fd = fogDensity * densityScale * vFogDepth;
      float fogF = 1.0 - exp( - fd * fd );
    #else
      float fogF = smoothstep( fogNear, fogFar, vFogDepth ) * densityScale;
    #endif
    if ( cityFogHeight.w > 0.5 ) {
      float fy = cameraPosition.y + vFogWorld.y;
      float fh = mix( 1.0, cityFogHeight.y, smoothstep( 0.0, cityFogHeight.x, fy ) );
      // Seen from above, the lower mean density along the ray keeps topdown readable.
      float fH = cityFogHeight.x;
      float fLo = max( min( fy, cameraPosition.y ), 0.0 );
      float fHi = max( max( fy, cameraPosition.y ), 0.0 );
      if ( fHi - fLo > 1.0 ) {
        fh = min( fh, 1.0 - ( cityFogThin( fHi, fH ) - cityFogThin( fLo, fH ) ) / ( fHi - fLo ) );
      }
      // fy is rebuilt from the camera height; from far above it rounds around 0 on y = 0
      // ground, so the water boost starts a little below it (water and park sit at y <= -2).
      fh *= fy < ${HEIGHT_FOG.waterBelow.toFixed(1)} ? cityFogHeight.z : 1.0;
      fogF = min( fogF * fh, 1.0 );
    }
    return fogF;
  }

  vec3 cityFogTint() {
    vec3 fv = normalize( vFogWorld + vec3( 0.0, 1e-4, 0.0 ) );
    float fs = pow( max( dot( fv, cityFogSun.xyz ), 0.0 ), ${SUN_SCATTER_POWER.toFixed(1)} ) * cityFogSun.w;
    return mix( fogColor, cityFogSunColor, fs );
  }
#endif
`;

const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = mix( gl_FragColor.rgb, cityFogTint(), cityFogAmount( 1.0 ) );
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
