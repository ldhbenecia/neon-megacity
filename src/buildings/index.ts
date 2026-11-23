import * as THREE from 'three';
import { CITY, buildingFaces, buildingTop } from '../city/layout';
import { pointSegmentDistance } from '../city/math';
import { GridHash, segmentBounds } from '../city/spatial';
import type { BuildingsApi, CityModuleInstance, Ctx, Road } from '../core/types';
import { GeoBuilder } from './builder';
import { emitBuilding, industrialStacks, type Targets } from './archetypes';
import { createFacadeMaterial, createFacadeUniforms } from './facadeMaterial';
import {
  LOD_DISTANCES,
  LOD_HYSTERESIS,
  chunkCenter,
  chunkGrid,
  chunkIndex,
  type ChunkGrid,
} from './params';
import {
  ROAD_Y,
  SIDEWALK_H,
  buildRoads,
  buildSidewalks,
  createWetMaterial,
  puddleTexture,
} from './roads';
import { alleyRetaining, stair, tree } from './street';

function streetTest(roads: readonly Road[]): (x: number, z: number) => boolean {
  const surfaces = roads.filter((r) => r.kind !== 'stair');
  const grid = new GridHash(32);
  surfaces.forEach((r, id) => grid.insert(id, segmentBounds(r.a, r.b, r.width / 2 + 2)));
  return (x, z) =>
    grid.query({ minX: x, minZ: z, maxX: x, maxZ: z }).some((id) => {
      const r = surfaces[id];
      return !!r && pointSegmentDistance({ x, z }, r.a, r.b) <= r.width / 2 + 2;
    });
}

interface Chunk {
  i: number;
  j: number;
  o: { x: number; z: number };
  T: Targets;
}

function collectChunks(LAYOUT: Ctx['LAYOUT'], grid: ChunkGrid): Chunk[] {
  const chunks = new Map<string, Chunk>();
  const chunkAt = (x: number, z: number): Chunk => {
    const { i, j } = chunkIndex(x, z, grid);
    const key = `${i},${j}`;
    let c = chunks.get(key);
    if (!c) {
      const o = chunkCenter(i, j, grid);
      c = {
        i,
        j,
        o,
        T: {
          l0: new GeoBuilder(o.x, o.z),
          l1: new GeoBuilder(o.x, o.z),
          l2: new GeoBuilder(o.x, o.z),
        },
      };
      chunks.set(key, c);
    }
    return c;
  };

  const onStreet = streetTest(LAYOUT.roads);
  for (const spec of LAYOUT.buildings) {
    const c = chunkAt(spec.x, spec.z);
    emitBuilding(spec, c.T, onStreet);
    industrialStacks(spec, c.T);
  }
  for (const s of LAYOUT.slots) {
    if (s.kind === 'tree') tree(chunkAt(s.x, s.z).T.l0, s);
  }
  for (const r of LAYOUT.roads) {
    const mx = (r.a.x + r.b.x) / 2;
    const mz = (r.a.z + r.b.z) / 2;
    if (r.kind === 'stair') stair(chunkAt(mx, mz).T.l0, r);
    else if (r.district === 'hillside' && r.kind === 'alley')
      alleyRetaining(chunkAt(mx, mz).T.l0, r);
  }
  return [...chunks.values()];
}

export function init(ctx: Ctx): CityModuleInstance {
  const { scene, LAYOUT, env, gui } = ctx;
  const group = new THREE.Group();
  group.name = 'buildings';
  scene.add(group);

  const chunks = collectChunks(LAYOUT, chunkGrid(LAYOUT, CITY.chunkSize));
  // Low tier (CI SwiftShader): start at LOD1, so no LOD0 detail (trees, stairs, props) and no
  // interior-mapped windows; LOD2 takes over at the LOD1 distance.
  const low = env.quality === 'low';

  const uniforms = createFacadeUniforms();
  const facade = createFacadeMaterial(uniforms, false);
  const facadeNear = low ? facade : createFacadeMaterial(uniforms, true);
  const geometries: THREE.BufferGeometry[] = [];
  const lods: THREE.LOD[] = [];
  const triangles = [0, 0, 0];
  for (const c of chunks) {
    const { o } = c;
    const lod = new THREE.LOD();
    lod.name = `chunk ${c.i},${c.j}`;
    lod.position.set(o.x, 0, o.z);
    const levels = low ? [c.T.l1, c.T.l2] : [c.T.l0, c.T.l1, c.T.l2];
    levels.forEach((b, i) => {
      const k = low ? i + 1 : i;
      const g = b.build();
      let obj: THREE.Object3D;
      if (g) {
        geometries.push(g);
        const mesh = new THREE.Mesh(g, k === 0 ? facadeNear : facade);
        mesh.castShadow = true;
        mesh.receiveShadow = k < 2;
        mesh.matrixAutoUpdate = false;
        obj = mesh;
        triangles[k] = (triangles[k] ?? 0) + (g.index ? g.index.count / 3 : 0);
      } else {
        obj = new THREE.Object3D();
      }
      lod.addLevel(obj, LOD_DISTANCES[i] ?? 0, LOD_HYSTERESIS);
    });
    lod.updateMatrix();
    lod.matrixAutoUpdate = false;
    lod.traverse((o2) => o2.updateMatrix());
    group.add(lod);
    lods.push(lod);
  }

  const puddle = puddleTexture(LAYOUT.seed);
  const wet = { value: 0.55 };
  const roadMat = createWetMaterial('road', puddle, wet, 0.6);
  const walkMat = createWetMaterial('sidewalk', puddle, wet, 0.7);
  const roadGeo = buildRoads(LAYOUT);
  const walkGeo = buildSidewalks(LAYOUT);
  geometries.push(roadGeo, walkGeo);
  const roads = new THREE.Mesh(roadGeo, roadMat);
  roads.name = 'roads';
  roads.receiveShadow = true;
  const walks = new THREE.Mesh(walkGeo, walkMat);
  walks.name = 'sidewalks';
  walks.receiveShadow = true;
  group.add(roads, walks);

  const specs = LAYOUT.buildings;
  const api: BuildingsApi = {
    group,
    specs,
    faces: specs.map((s) => buildingFaces(s)),
    maxHeight: specs.reduce((m, s) => Math.max(m, buildingTop(s)), 0),
    roadY: ROAD_Y,
    sidewalkHeight: SIDEWALK_H,
    materials: { facade, facadeNear, road: roadMat, sidewalk: walkMat },
  };
  ctx.buildings = api;

  const params = { litScale: 1 };
  const folder = gui.addFolder('Buildings');
  folder.add(params, 'litScale', 0, 3, 0.05).name('Lit windows ×');
  const info = {
    chunks: chunks.length,
    'tris LOD0': triangles[0] ?? 0,
    'tris LOD1': triangles[1] ?? 0,
    'tris LOD2': triangles[2] ?? 0,
  };
  for (const k of Object.keys(info) as (keyof typeof info)[]) folder.add(info, k).disable();
  folder.close();

  return {
    update(_dt, elapsed) {
      uniforms.uLitRatio.value = env.windowLitRatio * params.litScale;
      uniforms.uNight.value = env.nightFactor;
      uniforms.uPower.value = env.powerOn;
      uniforms.uTime.value = elapsed;
      wet.value = Math.max(env.wetness, 0.55 * env.nightFactor);
    },
    dispose() {
      scene.remove(group);
      for (const g of geometries) g.dispose();
      facade.dispose();
      if (facadeNear !== facade) facadeNear.dispose();
      uniforms.uDigits.value.dispose();
      roadMat.dispose();
      walkMat.dispose();
      puddle.dispose();
      folder.destroy();
      if (ctx.buildings === api) delete ctx.buildings;
    },
  };
}
