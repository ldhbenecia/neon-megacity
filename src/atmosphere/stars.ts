import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
} from 'three';
import { NEON } from '../core/palette';
import { createRng } from '../core/random';
import type { Ctx } from '../core/types';
import { TIME_WRAP, wrapTime } from './logic';

export const STARS = {
  count: 1500,
  minElevationDeg: 25,
  // Must stay inside camera.far.
  radius: 4800,
} as const;

const VERTEX = /* glsl */ `
attribute vec2 aStar;
uniform float uPixelRatio;
uniform float uTime;
varying float vTwinkle;
void main() {
  vec3 world = cameraPosition + position * ${STARS.radius.toFixed(1)};
  gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
  gl_PointSize = aStar.x * uPixelRatio;
  // Rates snapped to whole cycles per wrap period (< 0.0004 rad/s off), so the wrap is seamless.
  float rate = 0.7 + fract( aStar.y ) * 1.6;
  rate = floor( rate * ${TIME_WRAP.stars.toFixed(1)} / 6.2831853 + 0.5 ) * 6.2831853 / ${TIME_WRAP.stars.toFixed(1)};
  vTwinkle = 0.75 + 0.25 * sin( uTime * rate + aStar.y );
  vTwinkle *= smoothstep( 0.42, 0.75, position.y ) * 0.6 + 0.4;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uVisibility;
varying float vTwinkle;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float a = 1.0 - smoothstep( 0.2, 0.5, length( p ) );
  gl_FragColor = vec4( uColor * a * vTwinkle * uVisibility, 1.0 );
}
`;

export interface Stars {
  update(elapsed: number, visibility: number): void;
  dispose(): void;
}

export function createStars(ctx: Ctx): Stars {
  const { scene, renderer } = ctx;
  const rng = createRng(1500);
  const minY = Math.sin((STARS.minElevationDeg * Math.PI) / 180);
  const pos: number[] = [];
  const star: number[] = [];
  for (let i = 0; i < STARS.count; i++) {
    const y = minY + (1 - minY) * rng.next();
    const r = Math.sqrt(1 - y * y);
    const a = rng.next() * Math.PI * 2;
    pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
    star.push(rng.chance(0.08) ? 2 : 1 + rng.next() * 0.6, rng.next() * 100);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geometry.setAttribute('aStar', new Float32BufferAttribute(star, 2));

  const uniforms = {
    uPixelRatio: { value: renderer.getPixelRatio() },
    uTime: { value: 0 },
    uColor: { value: new Color(NEON.neonWhite.hex).multiplyScalar(0.5) },
    uVisibility: { value: 0 },
  };
  const material = new ShaderMaterial({
    name: 'atmosphere.stars',
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
  });
  const points = new Points(geometry, material);
  points.name = 'atmosphere.stars';
  points.frustumCulled = false;
  points.renderOrder = 10;
  scene.add(points);

  const uVis = uniforms.uVisibility;
  const uTime = uniforms.uTime;
  const uPr = uniforms.uPixelRatio;

  return {
    update(elapsed, visibility) {
      points.visible = visibility > 0.01;
      uVis.value = visibility;
      uTime.value = wrapTime(elapsed, TIME_WRAP.stars);
      uPr.value = renderer.getPixelRatio();
    },
    dispose() {
      scene.remove(points);
      geometry.dispose();
      material.dispose();
    },
  };
}
