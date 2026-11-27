import * as THREE from 'three';
import { RIVER } from '../city/layout';
import { TERRAIN_COLORS } from '../core/palette';
import { bankReach, channelRows, channelSlices, waterEdgeD } from './shape';

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
reflectedLight.indirectSpecular *= 2.4;
`;

export interface Water {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  update(elapsed: number): void;
  dispose(): void;
}

/** `ripples: false` (low quality tier) keeps the flat glossy surface without the noise normals. */
export function createWater(ripples = true): Water {
  const c = channelSlices();
  const depths = [c.xs.map(bankReach), c.xs.map(waterEdgeD)];
  const north = channelRows(c, depths, -1)[1] ?? [];
  const south = channelRows(c, depths, 1)[1] ?? [];
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < c.xs.length; i++) {
    const n = north[i];
    const s = south[i];
    if (!n || !s) throw new Error('terrain: water row out of range');
    pos.push(n.x, RIVER.waterY, n.z, s.x, RIVER.waterY, s.z);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

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
