import {
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  RedFormat,
  RepeatWrapping,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Vector4,
} from 'three';
import { CITY, SKYLINE_PEAK } from '../city/layout';
import { MATERIAL } from '../core/palette';
import type { Ctx } from '../core/types';
import { CLOUD_LAYERS, TIME_WRAP, wrapTime } from './logic';
import { tileableFbm } from './noise';

export const CLOUDS = {
  lowY: CLOUD_LAYERS.lowY,
  highY: CLOUD_LAYERS.highY,
  size: 16000,
  /** City light under the low deck: half the map's longer side (v2: 1200 m). */
  glowRadius: Math.max(CITY.extentX, CITY.extentZ) / 2,
  noiseSize: 256,
} as const;

const VERTEX = /* glsl */ `
attribute float aLayer;
varying vec3 vWorld;
varying float vLayer;
void main() {
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vWorld = w.xyz;
  vLayer = aLayer;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D tNoise;
uniform float uTime;
uniform vec2 uCityCenter;
uniform float uRain;
uniform float uNight;
uniform vec3 uLow;
uniform vec3 uLowLit;
uniform vec3 uDayLow;
uniform vec3 uDayHigh;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunset;
uniform float uFogK;
uniform vec4 uSpot[3];
uniform vec3 uSpotColor[3];
varying vec3 vWorld;
varying float vLayer;

void main() {
  vec2 p = vWorld.xz;
  vec3 toFrag = vWorld - cameraPosition;
  float dist = length( toFrag );
  vec3 view = toFrag / max( dist, 1e-3 );
  bool high = vLayer > 0.5;
  float density;
  if ( high ) {
    vec2 q = vec2( p.x * 0.8 + p.y * 0.6, -p.x * 0.6 + p.y * 0.8 );
    float n = texture2D( tNoise, q * vec2( 1.0 / 5200.0, 1.0 / 1300.0 ) + uTime * vec2( 0.0012, 0.0 ) ).r;
    n = n * 0.7 + texture2D( tNoise, q * vec2( 1.0 / 1600.0, 1.0 / 500.0 ) - uTime * vec2( 0.002, 0.0 ) ).r * 0.3;
    density = smoothstep( 0.5, 0.78, n ) * 0.45;
  } else {
    vec2 drift = uTime * vec2( 0.0015, 0.0006 );
    float n = texture2D( tNoise, p / 2600.0 + drift ).r * 0.62;
    n += texture2D( tNoise, p / 900.0 - drift * 1.7 + 0.37 ).r * 0.28;
    n += texture2D( tNoise, p / 310.0 + drift * 2.3 + 0.71 ).r * 0.10;
    float cov = mix( 0.56, 0.42, uRain );
    density = smoothstep( cov, cov + 0.22, n );
  }

  float glow = exp( - length( p - uCityCenter ) / ${CLOUDS.glowRadius.toFixed(1)} );
  vec3 night = high
    ? uLow * 0.35
    : mix( uLow, uLowLit, glow ) * ( 0.55 + 0.75 * glow ) * ( 0.75 + 0.35 * density );
  vec3 day = high ? uDayHigh : mix( uDayLow, uDayLow * 0.72, density );
  float sunLobe = pow( max( dot( view, uSunDir ), 0.0 ), high ? 3.0 : 6.0 );
  day += uSunColor * sunLobe * uSunset * ( high ? 1.0 : 0.5 );
  vec3 col = mix( day, night, uNight );

  float alpha = density * ( high ? 0.8 : 0.92 );
  if ( !high ) {
    for ( int i = 0; i < 3; i++ ) {
      vec4 s = uSpot[ i ];
      if ( s.w <= 0.0 ) continue;
      vec2 d = p - s.xz;
      float spot = exp( - dot( d, d ) / ( 90.0 * 90.0 ) ) * s.w;
      col += uSpotColor[ i ] * spot * 0.6 * ( 0.35 + density );
      alpha = max( alpha, spot * 0.35 );
    }
  }

  float fa = dist * uFogK;
  col = mix( col, uHorizon, 1.0 - exp( - fa * fa ) );
  alpha *= 1.0 - smoothstep( 3500.0, 7500.0, dist );

  float layerY = high ? ${CLOUDS.highY.toFixed(1)} : ${CLOUDS.lowY.toFixed(1)};
  float dy = cameraPosition.y - layerY;
  alpha *= smoothstep( 20.0, 120.0, abs( dy ) );
  if ( dy > 0.0 ) alpha *= 0.12;
  if ( alpha < 0.004 ) discard;
  gl_FragColor = vec4( col, alpha );
}
`;

export interface CloudInputs {
  rain: number;
  night: number;
  horizon: Color;
  sunDir: Vector3;
  sunColor: Color;
  sunset: number;
  dayLow: Color;
  dayHigh: Color;
  fogK: number;
}

export interface Clouds {
  update(elapsed: number, inputs: CloudInputs): void;
  setVisible(v: boolean): void;
  dispose(): void;
}

function layerQuad(y: number, layer: number, half: number): { pos: number[]; layer: number[] } {
  return {
    pos: [-half, y, -half, half, y, -half, half, y, half, -half, y, half],
    layer: [layer, layer, layer, layer],
  };
}

export function createClouds(
  ctx: Ctx,
  spots: readonly Vector4[],
  spotColors: readonly Color[],
): Clouds {
  const { scene, camera } = ctx;
  const half = CLOUDS.size / 2;

  // High layer first: transparent quads in one draw are blended in index order.
  const hi = layerQuad(CLOUDS.highY, 1, half);
  const lo = layerQuad(CLOUDS.lowY, 0, half);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([...hi.pos, ...lo.pos], 3));
  geometry.setAttribute('aLayer', new Float32BufferAttribute([...hi.layer, ...lo.layer], 1));
  geometry.setIndex([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6]);

  const noise = new DataTexture(
    tileableFbm(CLOUDS.noiseSize, 650),
    CLOUDS.noiseSize,
    CLOUDS.noiseSize,
    RedFormat,
  );
  noise.wrapS = RepeatWrapping;
  noise.wrapT = RepeatWrapping;
  noise.magFilter = LinearFilter;
  noise.minFilter = LinearMipmapLinearFilter;
  noise.generateMipmaps = true;
  noise.name = 'atmosphere.cloudNoise';
  noise.needsUpdate = true;

  const uniforms = {
    tNoise: { value: noise },
    uTime: { value: 0 },
    uCityCenter: { value: new Vector2(SKYLINE_PEAK.x, SKYLINE_PEAK.z) },
    uRain: { value: 0 },
    uNight: { value: 1 },
    uLow: { value: new Color(MATERIAL.cloudLow) },
    uLowLit: { value: new Color(MATERIAL.cloudLowLit) },
    uDayLow: { value: new Color() },
    uDayHigh: { value: new Color() },
    uHorizon: { value: new Color() },
    uSunDir: { value: new Vector3(0, 1, 0) },
    uSunColor: { value: new Color() },
    uSunset: { value: 0 },
    uFogK: { value: 0 },
    uSpot: { value: spots },
    uSpotColor: { value: spotColors },
  };
  const material = new ShaderMaterial({
    name: 'atmosphere.clouds',
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'atmosphere.clouds';
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  scene.add(mesh);
  const uTime = uniforms.uTime;
  const uRain = uniforms.uRain;
  const uNight = uniforms.uNight;
  const uDayLow = uniforms.uDayLow;
  const uDayHigh = uniforms.uDayHigh;
  const uHorizon = uniforms.uHorizon;
  const uSunDir = uniforms.uSunDir;
  const uSunColor = uniforms.uSunColor;
  const uSunset = uniforms.uSunset;
  const uFogK = uniforms.uFogK;

  return {
    update(elapsed, i) {
      mesh.position.set(camera.position.x, 0, camera.position.z);
      uTime.value = wrapTime(elapsed, TIME_WRAP.clouds);
      uRain.value = i.rain;
      uNight.value = i.night;
      uDayLow.value.copy(i.dayLow);
      uDayHigh.value.copy(i.dayHigh);
      uHorizon.value.copy(i.horizon);
      uSunDir.value.copy(i.sunDir);
      uSunColor.value.copy(i.sunColor);
      uSunset.value = i.sunset;
      uFogK.value = i.fogK;
    },
    setVisible(vis) {
      mesh.visible = vis;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
      noise.dispose();
    },
  };
}
