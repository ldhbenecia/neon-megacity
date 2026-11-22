// 삼첩령 far ridges (ART_DIRECTION 2.4, 7.5): three silhouette rings merged into one draw call,
// plus the red aviation obstruction lights on the highest near peaks (one more draw call).
// The ridge shader ignores the scene FogExp2 (it would erase them) and instead mixes each ring
// toward the horizon color by its fixed fog ratio (35 / 60 / 80 %), with extra valley mist at the
// base, so the layers get lighter with distance and melt into the sky.
import * as THREE from 'three';
import type { Ridge } from '../city/layout';
import { NEON, RIDGE_COLORS } from '../core/palette';
import { createRng } from '../core/random';
import { ridgePeaks, ridgeProfile } from './shape';

const RIDGE_VERTEX = /* glsl */ `
attribute float aFog;
attribute float aTop;
varying vec3 vColor;
varying vec3 vWorld;
varying float vFog;
varying float vTop;
void main() {
  vColor = color;
  vFog = aFog;
  vTop = aTop;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const RIDGE_FRAGMENT = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uHorizonAnti;
uniform vec3 uSunDir;
uniform float uDay;
varying vec3 vColor;
varying vec3 vWorld;
varying float vFog;
varying float vTop;
void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  vec2 sxz = uSunDir.xz;
  float sl = length(sxz);
  float side = sl > 1e-4 ? dot(normalize(dir.xz + 1e-6), sxz / sl) * 0.5 + 0.5 : 0.5;
  vec3 horizon = mix(uHorizonAnti, uHorizon, pow(side, 2.2));
  // Night: the tabulated dark teal silhouettes. Day: hazy darker copies of the horizon.
  vec3 base = mix(vColor, horizon * 0.28, uDay);
  // Valley mist (嵐): the lower half of every ring fades further into the haze.
  float mist = (1.0 - smoothstep(0.0, 0.7, vTop)) * 0.22;
  float fog = clamp(vFog + (1.0 - vFog) * mist, 0.0, 1.0);
  gl_FragColor = vec4(mix(base, horizon, fog), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const BEACON_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uSize;
attribute float aPhase;
attribute float aFog;
varying float vBlink;
varying float vFog;
void main() {
  float f = fract(uTime + aPhase);
  // 1 Hz flash: ~0.4 s on with soft edges.
  vBlink = smoothstep(0.0, 0.06, f) * (1.0 - smoothstep(0.34, 0.46, f));
  vFog = aFog;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize;
}
`;

const BEACON_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uGain;
varying float vBlink;
varying float vFog;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.35, d);
  float halo = pow(max(1.0 - d, 0.0), 2.5) * 0.35;
  float a = (core + halo) * vBlink * uGain * (1.0 - vFog * 0.55);
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Number of obstruction lights (doc: 5–7). */
export const BEACON_COUNT = 6;
/** Beacon HDR multiplier (doc 2.4: ×4). */
const BEACON_HDR = 4;
/** Beacon sprite size in CSS px (scaled by the renderer pixel ratio). */
const BEACON_PX = 9;

export interface Ridges {
  group: THREE.Group;
  update(elapsed: number, env: RidgeEnv, pixelRatio: number): void;
  dispose(): void;
}

export interface RidgeEnv {
  horizon: THREE.Color;
  horizonAnti: THREE.Color;
  sunDirection: THREE.Vector3;
  dayFactor: number;
}

function ringGeometry(ridges: readonly Ridge[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const fog: number[] = [];
  const top: number[] = [];
  const idx: number[] = [];
  const tmp = new THREE.Color();
  let base = 0;
  for (const r of ridges) {
    tmp.setHex(RIDGE_COLORS[r.id]);
    const n = r.segments;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * r.radius;
      const z = Math.sin(a) * r.radius;
      pos.push(x, ridgeProfile(r, a), z, x, r.baseY, z);
      col.push(tmp.r, tmp.g, tmp.b, tmp.r, tmp.g, tmp.b);
      fog.push(r.fog, r.fog);
      top.push(1, 0);
      if (i > 0) {
        const t0 = base + (i - 1) * 2;
        // Faces inward (toward the city).
        idx.push(t0, t0 + 1, t0 + 2, t0 + 1, t0 + 3, t0 + 2);
      }
    }
    base += (n + 1) * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aFog', new THREE.Float32BufferAttribute(fog, 1));
  g.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function beaconGeometry(ridges: readonly Ridge[]): THREE.BufferGeometry {
  // Mostly on the near ring (most visible), the rest on the mid ring.
  const near = ridges.find((r) => r.id === 'ridge-near');
  const mid = ridges.find((r) => r.id === 'ridge-mid');
  const rng = createRng(2471);
  const pos: number[] = [];
  const phase: number[] = [];
  const fog: number[] = [];
  const place = (r: Ridge | undefined, count: number): void => {
    if (!r) return;
    for (const a of ridgePeaks(r, count)) {
      const y = ridgeProfile(r, a) + 4;
      pos.push(Math.cos(a) * r.radius * 0.995, y, Math.sin(a) * r.radius * 0.995);
      phase.push(rng.next());
      fog.push(r.fog);
    }
  };
  place(near, BEACON_COUNT - 2);
  place(mid, 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
  g.setAttribute('aFog', new THREE.Float32BufferAttribute(fog, 1));
  g.computeBoundingSphere();
  return g;
}

export function createRidges(ridges: readonly Ridge[]): Ridges {
  const group = new THREE.Group();
  group.name = 'ridges';

  const ringGeo = ringGeometry(ridges);
  const ringU = {
    uHorizon: { value: new THREE.Color() },
    uHorizonAnti: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uDay: { value: 0 },
  };
  const ringMat = new THREE.ShaderMaterial({
    name: 'RidgeSilhouette',
    uniforms: ringU,
    vertexShader: RIDGE_VERTEX,
    fragmentShader: RIDGE_FRAGMENT,
    vertexColors: true,
    fog: false,
  });
  const rings = new THREE.Mesh(ringGeo, ringMat);
  rings.name = 'ridge-rings';
  rings.frustumCulled = false;
  group.add(rings);

  const beaconGeo = beaconGeometry(ridges);
  const beaconU = {
    uTime: { value: 0 },
    uSize: { value: BEACON_PX },
    uGain: { value: 1 },
    uColor: {
      value: new THREE.Color().setHex(NEON.neonRed.hex).multiplyScalar(BEACON_HDR),
    },
  };
  const beaconMat = new THREE.ShaderMaterial({
    name: 'RidgeBeacons',
    uniforms: beaconU,
    vertexShader: BEACON_VERTEX,
    fragmentShader: BEACON_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const beacons = new THREE.Points(beaconGeo, beaconMat);
  beacons.name = 'ridge-beacons';
  beacons.frustumCulled = false;
  group.add(beacons);

  return {
    group,
    update(elapsed, env, pixelRatio) {
      ringU.uHorizon.value.copy(env.horizon);
      ringU.uHorizonAnti.value.copy(env.horizonAnti);
      ringU.uSunDir.value.copy(env.sunDirection);
      ringU.uDay.value = env.dayFactor;
      beaconU.uTime.value = elapsed;
      // Red obstruction lights read at night; by day they are a faint blink.
      beaconU.uGain.value = 1 - 0.75 * env.dayFactor;
      beaconU.uSize.value = BEACON_PX * pixelRatio;
    },
    dispose() {
      ringGeo.dispose();
      ringMat.dispose();
      beaconGeo.dispose();
      beaconMat.dispose();
    },
  };
}
