// 흑린강 water surface (ART_DIRECTION 6.1 #4): a dark, glossy MeshStandardMaterial strip whose
// normals ripple with three octaves of scrolling procedural noise (no textures). The reflections
// come for free from lighting's PMREM environment (teal dome + neon panel band), the moon / sun
// specular, and later neon's reflection streak decals. One draw call, no render-to-texture.
import * as THREE from 'three';
import { CITY, RIVER, riverFrame } from '../city/layout';
import { MATERIAL } from '../core/palette';
import { OUTER_EXTENT, waterHalfWidth } from './shape';

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
  // Ripples elongated across the flow so reflections smear into vertical streaks.
  vec2 p = vWaterXZ * vec2(0.6, 1.0);
  float t = uTime;
  vec2 g = wGrad(p * 0.045 + vec2(t * 0.020, t * 0.006))
         + wGrad(p * 0.13 - vec2(t * 0.031, -t * 0.012)) * 0.55
         + wGrad(p * 0.41 + vec2(t * 0.050, t * 0.035)) * 0.3;
  float dist = length(vWaterXZ - cameraPosition.xz);
  float strength = 0.22 / (1.0 + dist / 450.0);
  vec3 nW = normalize(vec3(-g.x * strength, 1.0, -g.y * strength));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}
`;

export interface Water {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  update(elapsed: number): void;
  dispose(): void;
}

export function createWater(): Water {
  const hw = waterHalfWidth();
  const pos: number[] = [];
  const idx: number[] = [];
  let n = 0;
  for (let x = -OUTER_EXTENT; x <= OUTER_EXTENT;) {
    const f = riverFrame(x);
    for (const s of [-1, 1]) {
      pos.push(f.p.x + f.south.x * hw * s, RIVER.waterY, f.p.z + f.south.z * hw * s);
    }
    if (n > 0) {
      const a = (n - 1) * 2;
      // a = north, a+1 = south of the previous slice.
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    n++;
    x += Math.abs(x) < CITY.half + 40 ? 16 : 40;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const uTime: THREE.IUniform<number> = { value: 0 };
  const material = new THREE.MeshStandardMaterial({
    name: 'RiverWater',
    color: new THREE.Color().setHex(MATERIAL.deckUnderside),
    roughness: 0.08,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
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
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'river-water';
  mesh.receiveShadow = true;
  return {
    mesh,
    update(elapsed) {
      uTime.value = elapsed;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
