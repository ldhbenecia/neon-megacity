import * as THREE from 'three';
import { RIVER } from '../city/layout';
import { TERRAIN_COLORS } from '../core/palette';
import type { Vec2 } from '../city/layout';
import {
  SIDE_STRIPS,
  SIDE_REACH,
  SIDE_WATER_UNDER,
  MOAT_WATER_UNDER,
  grow,
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
  // Back from the stretched noise space to world slopes.
  g *= vec2(0.6, 1.0);
  vec2 toCam = vWaterXZ - cameraPosition.xz;
  float dist = length(toCam);
  // Tilts toward the viewer stretch reflected lights into long vertical streaks. Under the camera
  // the direction to it spins around the nadir point, so the stretch fades out there and when the
  // camera looks almost straight down (no horizontal view direction to stretch along).
  vec2 fwd = toCam / max(dist, 1e-3);
  vec2 across = vec2(-fwd.y, fwd.x);
  vec2 look = -vec2(viewMatrix[0][2], viewMatrix[2][2]);
  float aniso = smoothstep(20.0, 120.0, dist) * smoothstep(0.15, 0.45, length(look));
  g = mix(g, fwd * dot(g, fwd) * 1.6 + across * dot(g, across) * 0.3, aniso);
  float strength = 0.22 / (1.0 + dist / 450.0);
  vec3 nW = normalize(vec3(-g.x * strength, 1.0, -g.y * strength));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}
`;

// At night the moon's highlight broke into white glints on the ripples; the brightest thing on the
// water must be the colored city light in the environment map. Both changes fade in with uNight,
// and the cap scales the highlight by its brightest channel so its hue stays.
const WATER_LIGHT = /* glsl */ `
#include <lights_fragment_end>
{
  vec3 ds = reflectedLight.directSpecular * mix(1.0, 0.2, uNight);
  float peak = max(max(ds.r, ds.g), max(ds.b, 1e-4));
  reflectedLight.directSpecular = ds * mix(1.0, min(1.0, 0.03 / peak), uNight);
  reflectedLight.indirectSpecular *= mix(1.0, 2.0, uNight);
  #ifdef ENVMAP_TYPE_PMREM
  {
    // Night city light seen from above: the mirror ray, laid down to the panels' elevation.
    vec3 rv = transformDirectionByInverseViewMatrix(reflect(-geometryViewDir, geometryNormal), viewMatrix);
    vec3 look = transformDirectionByInverseViewMatrix(-geometryViewDir, viewMatrix);
    // Elevation pinned at most 0.22 rad (sin) and the heading rebuilt, so a ray straight up works.
    float h = clamp(rv.y, 0.0, 0.22);
    float lh = length(rv.xz);
    vec2 d = lh > 1e-4 ? rv.xz / lh : vec2(1.0, 0.0);
    vec3 flatRay = vec3(d.x * sqrt(1.0 - h * h), h, d.y * sqrt(1.0 - h * h));
    // Blurred: ripples scatter the ray, a sharp sample mostly hits sky between panels.
    vec3 city = textureLod(envMap, envMapRotation * flatRay, roughnessToMip(0.3)).rgb * envMapIntensity;
    // Only for cameras looking steeply down from well above the water.
    float steep = smoothstep(0.3, 0.85, -look.y) * smoothstep(60.0, 250.0, cameraPosition.y);
    // Faded with horizontal distance, where calm far ripples would lock the ray onto one panel.
    float near = 1.0 - smoothstep(1400.0, 2600.0, length(look.xz) * length(vViewPosition));
    // Schlick Fresnel for water (F0 0.02), lifted so the streaks read from above.
    float fres = 0.02 + 0.98 * pow(1.0 - clamp(-look.y, 0.0, 1.0), 5.0);
    reflectedLight.indirectSpecular += city * steep * near * uNight * (0.6 + 8.0 * fres);
  }
  #endif
}
`;

export interface Water {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  /** `night`: env.nightFactor. */
  update(elapsed: number, night: number): void;
  dispose(): void;
}

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
      s.slices.map(() => SIDE_REACH),
      s.slices.map(() => SIDE_WATER_UNDER),
      (x, z) => sideStripDistance(i, x, z),
    );
  });
  for (const m of islandMoats()) appendFan(pos, idx, grow(m, MOAT_WATER_UNDER));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** `ripples: false` (ci quality tier) keeps the flat glossy surface without the noise normals. */
export function createWater(ripples = true): Water {
  const geometry = buildWaterGeometry();

  const uTime: THREE.IUniform<number> = { value: 0 };
  const uNight: THREE.IUniform<number> = { value: 1 };
  const material = new THREE.MeshStandardMaterial({
    name: 'RiverWater',
    color: new THREE.Color().setHex(TERRAIN_COLORS.water),
    roughness: 0.08,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uNight;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nuniform float uNight;',
    );
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
    update(elapsed, night) {
      uNight.value = night;
      if (ripples) uTime.value = elapsed;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
