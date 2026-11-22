// Buildings module (ART_DIRECTION 4, 6.1, 6.2, 13.1): roads, sidewalks, stairs, building
// geometry per archetype, window shader, rooftop / facade props, shop fronts, trees, and
// 256 m chunk merge with a 3-level THREE.LOD per chunk. Publishes `ctx.buildings`.
//
// Draw calls: one facade material for every building surface, so each visible chunk costs one
// call at whichever LOD it shows, plus 2 for roads and sidewalks.
import * as THREE from 'three';
import { buildingFaces, buildingTop } from '../city/layout';
import { pointSegmentDistance } from '../city/math';
import type { BuildingsApi, CityModuleInstance, Ctx, Road } from '../core/types';
import { GeoBuilder } from './builder';
import { emitBuilding, industrialStacks, type Targets } from './archetypes';
import { createFacadeMaterial } from './facadeMaterial';
import { LOD_DISTANCES, LOD_HYSTERESIS, chunkCenter, chunkIndex } from './params';
import {
  ROAD_Y,
  SIDEWALK_H,
  buildRoads,
  buildSidewalks,
  createWetMaterial,
  puddleTexture,
} from './roads';
import { alleyRetaining, stair, tree } from './street';

/** True when (x, z) lies on (or within 2 m of) a street, arterial or alley surface. */
function streetTest(roads: readonly Road[]): (x: number, z: number) => boolean {
  const CELL = 32;
  const grid = new Map<string, Road[]>();
  for (const r of roads) {
    if (r.kind === 'stair') continue;
    const pad = r.width / 2 + 2;
    const i0 = Math.floor((Math.min(r.a.x, r.b.x) - pad) / CELL);
    const i1 = Math.floor((Math.max(r.a.x, r.b.x) + pad) / CELL);
    const j0 = Math.floor((Math.min(r.a.z, r.b.z) - pad) / CELL);
    const j1 = Math.floor((Math.max(r.a.z, r.b.z) + pad) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = `${i},${j}`;
        const list = grid.get(k);
        if (list) list.push(r);
        else grid.set(k, [r]);
      }
    }
  }
  return (x, z) => {
    const list = grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? [];
    return list.some((r) => pointSegmentDistance({ x, z }, r.a, r.b) <= r.width / 2 + 2);
  };
}

interface Chunk {
  i: number;
  j: number;
  T: Targets;
}

export function init(ctx: Ctx): CityModuleInstance {
  const { scene, LAYOUT, env, gui } = ctx;
  const half = LAYOUT.extent / 2;
  const group = new THREE.Group();
  group.name = 'buildings';
  scene.add(group);

  // --- chunks -------------------------------------------------------------
  const chunks = new Map<string, Chunk>();
  const chunkAt = (x: number, z: number): Chunk => {
    const { i, j } = chunkIndex(x, z, half);
    const key = `${i},${j}`;
    let c = chunks.get(key);
    if (!c) {
      const o = chunkCenter(i, j, half);
      c = {
        i,
        j,
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

  const { material: facade, uniforms } = createFacadeMaterial();
  const geometries: THREE.BufferGeometry[] = [];
  const lods: THREE.LOD[] = [];
  let triangles = [0, 0, 0];
  for (const c of chunks.values()) {
    const o = chunkCenter(c.i, c.j, half);
    const lod = new THREE.LOD();
    lod.name = `chunk ${c.i},${c.j}`;
    lod.position.set(o.x, 0, o.z);
    const levels = [c.T.l0, c.T.l1, c.T.l2];
    levels.forEach((b, k) => {
      const g = b.build();
      let obj: THREE.Object3D;
      if (g) {
        geometries.push(g);
        const mesh = new THREE.Mesh(g, facade);
        mesh.castShadow = true;
        mesh.receiveShadow = k < 2;
        mesh.matrixAutoUpdate = false;
        obj = mesh;
        triangles[k] = (triangles[k] ?? 0) + (g.index ? g.index.count / 3 : 0);
      } else {
        obj = new THREE.Object3D();
      }
      lod.addLevel(obj, LOD_DISTANCES[k] ?? 0, LOD_HYSTERESIS);
    });
    lod.updateMatrix();
    lod.matrixAutoUpdate = false;
    lod.traverse((o2) => o2.updateMatrix());
    group.add(lod);
    lods.push(lod);
  }
  triangles = triangles.map(Math.round);

  // --- roads and sidewalks ------------------------------------------------
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
  walks.castShadow = true;
  group.add(roads, walks);

  // --- API ------------------------------------------------------------------
  const specs = LAYOUT.buildings;
  const api: BuildingsApi = {
    group,
    specs,
    faces: specs.map((s) => buildingFaces(s)),
    maxHeight: specs.reduce((m, s) => Math.max(m, buildingTop(s)), 0),
    roadY: ROAD_Y,
    sidewalkHeight: SIDEWALK_H,
    materials: { facade, road: roadMat, sidewalk: walkMat },
  };
  ctx.buildings = api;

  // --- GUI ------------------------------------------------------------------
  const params = { litScale: 1 };
  const folder = gui.addFolder('Buildings');
  folder.add(params, 'litScale', 0, 3, 0.05).name('Lit windows ×');
  const info = {
    chunks: chunks.size,
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
      uniforms.uDigits.value.dispose();
      roadMat.dispose();
      walkMat.dispose();
      puddle.dispose();
      folder.destroy();
      if (ctx.buildings === api) delete ctx.buildings;
    },
  };
}
