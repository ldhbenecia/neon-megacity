// Terrain module (ART_DIRECTION 2.3, 2.4, 13.1): ground heightfield with the 별계단동 slopes,
// the 흑린강 channel (bank strip, embankments, 둔치 parks, water) and the 삼첩령 far ridges with
// their aviation lights. Reads the layout's pure queries only (terrainHeight, riverFrame,
// riverSignedDistance, ridgeHeight, ridgePoint) and env colors written by lighting.
// Draw calls: ground 1, channel 1, water 1, ridge rings 1, beacons 1 (budget 8).
import * as THREE from 'three';
import { paletteAt } from '../core/palette';
import type { Ctx, CityModuleInstance } from '../core/types';
import { buildChannel, buildGround } from './ground';
import { createRidges, type RidgeEnv } from './ridges';
import { createWater } from './water';

export function init(ctx: Ctx): CityModuleInstance {
  const { scene, renderer, env, LAYOUT } = ctx;
  const group = new THREE.Group();
  group.name = 'terrain';

  // Ground: pushed back in depth so roads, sidewalks and plazas laid at the same height win.
  const groundGeo = buildGround();
  const groundMat = new THREE.MeshStandardMaterial({
    name: 'TerrainGround',
    vertexColors: true,
    roughness: 0.93,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
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
  });
  const channel = new THREE.Mesh(channelGeo, channelMat);
  channel.name = 'river-channel';
  channel.receiveShadow = true;
  channel.matrixAutoUpdate = false;
  group.add(channel);

  const water = createWater();
  water.mesh.matrixAutoUpdate = false;
  group.add(water.mesh);

  const ridges = createRidges(LAYOUT.ridges);
  group.add(ridges.group);

  scene.add(group);

  // Ridge colors follow lighting's horizon; the anti-sun horizon comes from the same palette.
  const ridgeEnv: RidgeEnv = {
    horizon: env.horizonColor,
    horizonAnti: new THREE.Color(),
    sunDirection: env.sunDirection,
    dayFactor: env.dayFactor,
  };
  let antiTime = Number.NaN;

  return {
    update(_dt, elapsed) {
      if (env.timeOfDay !== antiTime) {
        antiTime = env.timeOfDay;
        const a = paletteAt(antiTime).horizonAntiSun;
        ridgeEnv.horizonAnti.setRGB(a[0], a[1], a[2], THREE.SRGBColorSpace);
      }
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
