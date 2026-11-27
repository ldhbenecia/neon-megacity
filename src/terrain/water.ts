import * as THREE from 'three';
import { RIVER } from '../city/layout';
import { TERRAIN_COLORS } from '../core/palette';
import type { Vec2 } from '../city/layout';
import {
  SIDE_STRIPS,
  SIDE_WATER_EDGE,
  bankReach,
  centroid,
  channelRows,
  channelSlices,
  islandMoats,
  sideSlices,
  sideStripDistance,
  waterEdgeD,
  type ChannelSlices,
} from './shape';

const WATER_PARS = /* glsl */ `
uniform float uTime;
varying vec2 vWaterXZ;
float wHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float wNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x),
             mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec2 wGrad(vec2 p) {
  float e = 0.15;
  float c = wNoise(p);
  return vec2(wNoise(p + vec2(e, 0.0)) - c, wNoise(p + vec2(0.0, e)) - c) / e;
}
`;

const WATER_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
{
  vec2 p = vWaterXZ * vec2(0.6, 1.0);
  float t = uTime;
  vec2 g = wGrad(p * 0.045 + vec2(t * 0.020, t * 0.006))
         + wGrad(p * 0.13 - vec2(t * 0.031, -t * 0.012)) * 0.55
         + wGrad(p * 0.41 + vec2(t * 0.050, t * 0.035)) * 0.3;
  vec2 toCam = vWaterXZ - cameraPosition.xz;
  float dist = length(toCam);
  // Tilts toward the viewer stretch reflected lights into long vertical streaks.
  vec2 fwd = toCam / max(dist, 1e-3);
  vec2 across = vec2(-fwd.y, fwd.x);
  g = fwd * dot(g, fwd) * 1.6 + across * dot(g, across) * 0.3;
  float strength = 0.22 / (1.0 + dist / 450.0);
  vec3 nW = normalize(vec3(-g.x * strength, 1.0, -g.y * strength));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}
`;

// Direct light (moon, sun) would break into white glints on the ripples; the brightest thing on the
// water must be the colored city light in the environment map.
const WATER_LIGHT = /* glsl */ `
#include <lights_fragment_end>
reflectedLight.directSpecular = min(reflectedLight.directSpecular * 0.2, vec3(0.03));
reflectedLight.indirectSpecular *= 2.0;
`;

export interface Water {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  update(elapsed: number): void;
  dispose(): void;
}

/** `ripples: false` (low quality tier) keeps the flat glossy surface without the noise normals. */
// Band between the two rows at bank distance `edge`, one quad per slice.
function appendBand(
  pos: number[],
  idx: number[],
  c: ChannelSlices,
  outer: readonly number[],
  edge: readonly number[],
  dist?: (x: number, z: number) => number,
): void {
  const depths = [outer, edge];
  const north = channelRows(c, depths, -1, dist)[1] ?? [];
  const south = channelRows(c, depths, 1, dist)[1] ?? [];
  const base = pos.length / 3;
  for (let i = 0; i < c.slices.length; i++) {
    const n = north[i];
    const s = south[i];
    if (!n || !s) throw new Error('terrain: water row out of range');
    pos.push(n.x, RIVER.waterY, n.z, s.x, RIVER.waterY, s.z);
    if (i > 0) {
      const a = base + (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
}

// Convex fan; wound so its face points up whichever way the polygon runs.
function appendFan(pos: number[], idx: number[], poly: readonly Vec2[]): void {
  const c = centroid(poly);
  const base = pos.length / 3;
  pos.push(c.x, RIVER.waterY, c.z);
  for (const p of poly) pos.push(p.x, RIVER.waterY, p.z);
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Vec2;
    const b = poly[(i + 1) % poly.length] as Vec2;
    area += a.x * b.z - b.x * a.z;
  }
  for (let i = 0; i < poly.length; i++) {
    const a = base + 1 + i;
    const b = base + 1 + ((i + 1) % poly.length);
    if (area > 0) idx.push(base, b, a);
    else idx.push(base, a, b);
  }
}

export function buildWaterGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const c = channelSlices();
  appendBand(pos, idx, c, c.xs.map(bankReach), c.xs.map(waterEdgeD));
  SIDE_STRIPS.forEach((_, i) => {
    const s = sideSlices(i);
    appendBand(
      pos,
      idx,
      s,
      s.slices.map(() => 20),
      s.slices.map(() => SIDE_WATER_EDGE),
      (x, z) => sideStripDistance(i, x, z),
    );
  });
  for (const m of islandMoats()) appendFan(pos, idx, m);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** `ripples: false` (low quality tier) keeps the flat glossy surface without the noise normals. */
export function createWater(ripples = true): Water {
  const geometry = buildWaterGeometry();

  const uTime: THREE.IUniform<number> = { value: 0 };
  const material = new THREE.MeshStandardMaterial({
    name: 'RiverWater',
    color: new THREE.Color().setHex(TERRAIN_COLORS.water),
    roughness: 0.08,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      WATER_LIGHT,
    );
    if (ripples) {
      shader.uniforms.uTime = uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWaterXZ;')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nvWaterXZ = (modelMatrix * vec4(transformed, 1.0)).xz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${WATER_PARS}`)
        .replace('#include <normal_fragment_maps>', WATER_NORMAL);
    }
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'river-water';
  mesh.receiveShadow = true;
  return {
    mesh,
    update(elapsed) {
      if (ripples) uTime.value = elapsed;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
