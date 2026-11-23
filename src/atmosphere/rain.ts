import {
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { NEON } from '../core/palette';
import { createRng } from '../core/random';
import type { Ctx } from '../core/types';
import {
  RAIN,
  rainAlpha,
  rainDropCount,
  rainPoolFor,
  rainSlantRadians,
  TIME_WRAP,
  wrapTime,
} from './logic';

const RAIN_HUE_LIFT = 0.16;

const VERTEX = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uBox;
uniform vec2 uWind;
uniform vec2 uResolution;
uniform float uWidthPx;
varying float vAlpha;
varying float vAcross;
varying float vEnd;
varying float vTint;

void main() {
  float speed = mix( ${RAIN.speedMin.toFixed(1)}, ${RAIN.speedMax.toFixed(1)}, aSeed.w );
  float len = mix( ${RAIN.lengthMin.toFixed(2)}, ${RAIN.lengthMax.toFixed(2)}, fract( aSeed.w * 13.71 ) );
  vec3 dir = normalize( vec3( uWind.x, -1.0, uWind.y ) );
  vec3 p = aSeed.xyz * uBox + dir * speed * uTime;
  vec3 rel = mod( p - cameraPosition, uBox ) - 0.5 * uBox;
  vec3 head = cameraPosition + rel;
  vec3 tail = head - dir * len;

  vec4 ch = projectionMatrix * viewMatrix * vec4( head, 1.0 );
  vec4 ct = projectionMatrix * viewMatrix * vec4( tail, 1.0 );
  vEnd = position.y;
  vAcross = position.x * 2.0;
  vTint = fract( aSeed.w * 71.13 + aSeed.x * 3.7 );
  if ( ch.w < 0.5 || ct.w < 0.5 ) {
    vAlpha = 0.0;
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    return;
  }
  vec2 sh = ch.xy / ch.w;
  vec2 st = ct.xy / ct.w;
  vec2 sd = ( sh - st ) * uResolution;
  float sl = length( sd );
  sd = sl > 1e-4 ? sd / sl : vec2( 0.0, 1.0 );
  vec4 c = position.y > 0.5 ? ch : ct;
  c.xy += vec2( -sd.y, sd.x ) * position.x * uWidthPx * 2.0 / uResolution * c.w;

  float d = length( rel );
  vec3 n = abs( rel ) / ( 0.5 * uBox );
  float edge = 1.0 - smoothstep( 0.75, 1.0, max( max( n.x, n.y ), n.z ) );
  float nearFade = smoothstep( 1.5, 4.0, d );
  float farFade = 1.0 - smoothstep( 25.0, 55.0, d );
  vAlpha = edge * nearFade * farFade;
  gl_Position = c;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uNeon[3];
uniform float uOpacity;
varying float vAlpha;
varying float vAcross;
varying float vEnd;
varying float vTint;

void main() {
  float across = 1.0 - vAcross * vAcross;
  float a = vAlpha * uOpacity * across * mix( 0.25, 1.0, vEnd );
  if ( a < 0.002 ) discard;
  vec3 col = uColor;
  if ( vTint < ${RAIN.neonShare.toFixed(3)} ) {
    float k = vTint / ${RAIN.neonShare.toFixed(3)};
    col = k < 0.34 ? uNeon[0] : ( k < 0.67 ? uNeon[1] : uNeon[2] );
  }
  gl_FragColor = vec4( col, a );
}
`;

export interface Rain {
  update(elapsed: number, rain: number, fogColor: Color, altitudeFade: number): void;
  setTier(tier: number): void;
  dispose(): void;
}

export function createRain(ctx: Ctx): Rain {
  const { scene, renderer } = ctx;
  const rng = createRng(7207);
  const max = RAIN.maxDrops;
  const seeds = new Float32Array(max * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rng.next();

  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = 0;

  const neon = [NEON.neonCyan.hex, NEON.neonOrange.hex, NEON.neonRed.hex].map((h) =>
    new Color(h).multiplyScalar(0.9),
  );
  const uniforms = {
    uTime: { value: 0 },
    uBox: { value: RAIN.box },
    uWind: { value: new Vector2() },
    uResolution: { value: new Vector2(1, 1) },
    uWidthPx: { value: 1.2 },
    uColor: { value: new Color() },
    uNeon: { value: neon },
    uOpacity: { value: 0 },
  };
  const material = new ShaderMaterial({
    name: 'atmosphere.rain',
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    // Quad winding flips with the streak direction on screen: culling drops streaks.
    side: DoubleSide,
    fog: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'atmosphere.rain';
  mesh.frustumCulled = false;
  mesh.renderOrder = 40;
  scene.add(mesh);

  const size = new Vector2();
  const windDir = new Vector3(0.8, 0, 0.6).normalize();
  let pool = rainPoolFor(0);
  const uTime = uniforms.uTime;
  const uWind = uniforms.uWind;
  const uRes = uniforms.uResolution;
  const uWidth = uniforms.uWidthPx;
  const uColor = uniforms.uColor;
  const uOpacity = uniforms.uOpacity;

  return {
    update(elapsed, rain, fogColor, altitudeFade) {
      const count = altitudeFade > 0.01 ? rainDropCount(rain, pool) : 0;
      geometry.instanceCount = count;
      mesh.visible = count > 0;
      if (!mesh.visible) return;
      renderer.getDrawingBufferSize(size);
      uRes.value.copy(size);
      uWidth.value = 1.4 * renderer.getPixelRatio();
      uTime.value = wrapTime(elapsed, TIME_WRAP.rain);
      const slant = Math.tan(rainSlantRadians(rain));
      uWind.value.set(windDir.x * slant, windDir.z * slant);
      const peak = Math.max(fogColor.r, fogColor.g, fogColor.b, 1e-4);
      uColor.value.copy(fogColor).multiplyScalar(2.5 + RAIN_HUE_LIFT / peak);
      uOpacity.value = rainAlpha(rain) * altitudeFade;
    },
    setTier(tier) {
      pool = rainPoolFor(tier);
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
