import * as THREE from 'three';
import type { Ctx, CityModuleInstance } from '../core/types';
import { buildChannel, buildGround } from './ground';
import { createRidges, type RidgeEnv } from './ridges';
import { createWater } from './water';

export function init(ctx: Ctx): CityModuleInstance {
  const { scene, renderer, env, LAYOUT } = ctx;
  const group = new THREE.Group();
  group.name = 'terrain';

  // Roads, sidewalks and plazas laid at the same height must win over the ground. Units only:
  // a slope factor grows to tens of metres at grazing angles and lets buried geometry show through.
  const groundGeo = buildGround();
  const groundMat = new THREE.MeshStandardMaterial({
    name: 'TerrainGround',
    vertexColors: true,
    roughness: 0.93,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 4,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.name = 'ground';
  ground.receiveShadow = true;
  ground.matrixAutoUpdate = false;
  group.add(ground);

  const channelGeo = buildChannel();
  const channelMat = new THREE.MeshStandardMaterial({
    name: 'RiverChannel',
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
    // Ahead of the ground it overlaps (units 4), behind roads and sidewalks at y = 0 (0).
    polygonOffset: true,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 2,
  });
  const channel = new THREE.Mesh(channelGeo, channelMat);
  channel.name = 'river-channel';
  channel.receiveShadow = true;
  channel.matrixAutoUpdate = false;
  group.add(channel);

  const water = createWater(env.quality !== 'ci');
  water.mesh.matrixAutoUpdate = false;
  group.add(water.mesh);

  const ridges = createRidges(LAYOUT.ridges);
  group.add(ridges.group);

  scene.add(group);

  const ridgeEnv: RidgeEnv = {
    horizon: env.horizonColor,
    horizonAnti: env.horizonAntiColor ?? env.horizonColor,
    sunDirection: env.sunDirection,
    dayFactor: env.dayFactor,
  };

  return {
    update(_dt, elapsed) {
      ridgeEnv.dayFactor = env.dayFactor;
      water.update(elapsed);
      ridges.update(elapsed, ridgeEnv, renderer.getPixelRatio());
    },
    dispose() {
      scene.remove(group);
      groundGeo.dispose();
      groundMat.dispose();
      channelGeo.dispose();
      channelMat.dispose();
      water.dispose();
      ridges.dispose();
    },
  };
}
