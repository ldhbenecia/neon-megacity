import * as THREE from 'three';
import { buildingFaces, buildingTop, terrainHeight } from '../city/layout';
import { NIGHT_FILL_AMBIENT } from '../core/palette';
import { pointSegmentDistance } from '../city/math';
import { GridHash, segmentBounds } from '../city/spatial';
import type { BuildingsApi, CityModuleInstance, Ctx, Road } from '../core/types';
import { GeoBuilder } from './builder';
import {
  LOD0_BUDGET_MS,
  LOD0_KEEP,
  LOD0_RELEASE_FACTOR,
  NullBuilder,
  lod0Job,
  pickLevel,
  type Level,
  type Lod0Job,
} from './lod';
import { emitBuilding, faceBlank, industrialStacks } from './archetypes';
import { namsanMast } from './landmarks';
import { palaceGrounds, palacePlan } from './palace';
import { createFacadeMaterial, createFacadeUniforms } from './facadeMaterial';
import {
  lodDistancesFor,
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
  l1: GeoBuilder;
  l2: GeoBuilder;
  /** LOD0 emitters, run later by a `lod0Job` into a fresh builder. */
  lod0: ((b: GeoBuilder) => void)[];
}

const NULL = new NullBuilder(0, 0);

function collectChunks(
  LAYOUT: Ctx['LAYOUT'],
  grid: ChunkGrid,
  onStreet: (x: number, z: number) => boolean,
): Chunk[] {
  const chunks = new Map<string, Chunk>();
  const chunkAt = (x: number, z: number): Chunk => {
    const { i, j } = chunkIndex(x, z, grid);
    const key = `${i},${j}`;
    let c = chunks.get(key);
    if (!c) {
      const o = chunkCenter(i, j, grid);
      c = { i, j, o, l1: new GeoBuilder(o.x, o.z), l2: new GeoBuilder(o.x, o.z), lod0: [] };
      chunks.set(key, c);
    }
    return c;
  };

  for (const spec of LAYOUT.buildings) {
    const c = chunkAt(spec.x, spec.z);
    const far = { l0: NULL, l1: c.l1, l2: c.l2 };
    emitBuilding(spec, far, onStreet);
    industrialStacks(spec, far);
    c.lod0.push((b) => {
      const near = { l0: b, l1: NULL, l2: NULL };
      emitBuilding(spec, near, onStreet);
      industrialStacks(spec, near);
    });
  }
  for (const s of LAYOUT.slots) {
    if (s.kind === 'tree') chunkAt(s.x, s.z).lod0.push((b) => tree(b, s));
  }
  for (const r of LAYOUT.roads) {
    const mx = (r.a.x + r.b.x) / 2;
    const mz = (r.a.z + r.b.z) / 2;
    if (r.kind === 'stair') chunkAt(mx, mz).lod0.push((b) => stair(b, r));
    else if (r.district === 'hillside' && r.kind === 'alley')
      chunkAt(mx, mz).lod0.push((b) => alleyRetaining(b, r));
  }
  for (const l of LAYOUT.landmarks) {
    if (l.id !== 'namsan-mast') continue;
    const c = chunkAt(l.x, l.z);
    const y0 = terrainHeight(l.x, l.z);
    // LOD0 replaces LOD1 near the camera, so the near job must draw it too.
    namsanMast(c.l1, l.x, y0, l.z, l.h, 1);
    namsanMast(c.l2, l.x, y0, l.z, l.h, 2);
    c.lod0.push((g) => namsanMast(g, l.x, y0, l.z, l.h, 1));
  }
  // Palace walls, corridors and terrace come from layout.palaceWalls via palaceGrounds.
  const plan = palacePlan(LAYOUT);
  if (plan) {
    const c = chunkAt((plan.x0 + plan.x1) / 2, (plan.z0 + plan.z1) / 2);
    palaceGrounds(c.l1, plan, 1);
    palaceGrounds(c.l2, plan, 2);
    c.lod0.push((g) => palaceGrounds(g, plan, 0));
  }
  return [...chunks.values()];
}

interface ChunkLod {
  chunk: Chunk;
  group: THREE.Group;
  box: THREE.Box3;
  l1: THREE.Object3D;
  l2: THREE.Object3D;
  /** null: not built; Object3D without geometry: built but empty. */
  l0: THREE.Object3D | null;
  level: Level;
}

export function init(ctx: Ctx): CityModuleInstance {
  const { scene, LAYOUT, CITY, env, gui } = ctx;
  const group = new THREE.Group();
  group.name = 'buildings';
  scene.add(group);

  const onStreet = streetTest(LAYOUT.roads);
  const chunks = collectChunks(LAYOUT, chunkGrid(LAYOUT, CITY.chunkSize), onStreet);
  // Low tier (CI SwiftShader): start at LOD1, so no LOD0 detail (trees, stairs, props) and no
  // interior-mapped windows; LOD2 takes over at the LOD1 distance.
  const low = env.quality === 'ci';

  const uniforms = createFacadeUniforms();
  const facade = createFacadeMaterial(uniforms, false);
  const facadeNear = low ? facade : createFacadeMaterial(uniforms, true);
  const geometries: THREE.BufferGeometry[] = [];
  const triangles = [0, 0];
  const info = {
    chunks: chunks.length,
    'tris LOD1': 0,
    'tris LOD2': 0,
    'LOD0 chunks': 0,
  };

  const makeMesh = (g: THREE.BufferGeometry | null, level: Level): THREE.Object3D => {
    if (!g) return new THREE.Object3D();
    const mesh = new THREE.Mesh(g, level === 0 ? facadeNear : facade);
    mesh.castShadow = true;
    mesh.receiveShadow = level < 2;
    mesh.matrixAutoUpdate = false;
    return mesh;
  };
  let distances = lodDistancesFor(env.quality);
  const offQuality = ctx.onQuality((q) => {
    distances = lodDistancesFor(q);
  });
  const lods: ChunkLod[] = chunks.map((chunk) => {
    const group = new THREE.Group();
    group.name = `chunk ${chunk.i},${chunk.j}`;
    group.position.set(chunk.o.x, 0, chunk.o.z);
    const built = [chunk.l1.build(), chunk.l2.build()];
    built.forEach((g, k) => {
      if (!g) return;
      geometries.push(g);
      triangles[k] = (triangles[k] ?? 0) + (g.index ? g.index.count / 3 : 0);
    });
    const l1 = makeMesh(built[0] ?? null, 1);
    const l2 = makeMesh(built[1] ?? null, 2);
    l2.visible = false;
    group.add(l1, l2);
    group.updateMatrix();
    group.matrixAutoUpdate = false;
    group.traverse((o2) => o2.updateMatrix());
    group.updateMatrixWorld(true);
    // World-space box of the chunk's LOD1 (or LOD2) geometry; LOD picks by distance to it.
    const box = new THREE.Box3();
    const bb = built[0]?.boundingBox ?? built[1]?.boundingBox;
    if (bb) box.copy(bb).translate(group.position);
    else box.setFromCenterAndSize(group.position, new THREE.Vector3());
    return { chunk, group, box, l1, l2, l0: null, level: 1 };
  });
  for (const c of lods) group.add(c.group);
  info['tris LOD1'] = triangles[0] ?? 0;
  info['tris LOD2'] = triangles[1] ?? 0;

  let lod0Count = 0;
  // Lighting keeps shadowMap.autoUpdate off: casters that appear or vanish must ask for a redraw.
  const shadowsChanged = (): void => {
    ctx.renderer.shadowMap.needsUpdate = true;
  };
  const attachLod0 = (c: ChunkLod, g: THREE.BufferGeometry | null): void => {
    const obj = makeMesh(g, 0);
    obj.visible = false;
    c.group.add(obj);
    obj.updateMatrixWorld(true);
    c.l0 = obj;
    lod0Count++;
    shadowsChanged();
  };
  const releaseLod0 = (c: ChunkLod): void => {
    if (!c.l0) return;
    c.group.remove(c.l0);
    if (c.l0 instanceof THREE.Mesh) (c.l0.geometry as THREE.BufferGeometry).dispose();
    c.l0 = null;
    lod0Count--;
    shadowsChanged();
  };
  const newJob = (c: ChunkLod): Lod0Job =>
    lod0Job(new GeoBuilder(c.chunk.o.x, c.chunk.o.z), c.chunk.lod0);
  let job: { c: ChunkLod; job: Lod0Job } | null = null;
  /** Chunk whose LOD0 exists only for the boot compile; released like any far LOD0. */
  let warm: ChunkLod | null = null;
  /** 1 while a chunk in LOD0 range still shows LOD1 (screenshots wait for 0). */
  let pending = 0;

  const camPos = new THREE.Vector3();
  /** Levels, visibility, LOD0 release and at most one time-sliced LOD0 job per frame. */
  const updateLods = (budgetMs: number): void => {
    ctx.camera.getWorldPosition(camPos);
    let nearest: ChunkLod | null = null;
    let nearestD = Infinity;
    let farthest: ChunkLod | null = null;
    const noLod0 = distances[1] === 0;
    let farthestD = noLod0 ? -1 : distances[1] * LOD0_RELEASE_FACTOR;
    for (const c of lods) {
      // Distance over zoom like THREE.LOD (the rig keeps zoom at 1), to the chunk box: a 400 m
      // chunk's centre can be ~280 m from a building at its edge.
      const d = c.box.distanceToPoint(camPos) / ctx.camera.zoom;
      c.level = pickLevel(d, c.level, distances, LOD_HYSTERESIS);
      if (c.l0 && d > farthestD) {
        farthest = c;
        farthestD = d;
      }
      if (c.level === 0 && !c.l0 && d < nearestD) {
        nearest = c;
        nearestD = d;
      }
      const shown = c.level === 0 && !c.l0 ? 1 : c.level;
      if (c.l0) c.l0.visible = shown === 0;
      c.l1.visible = shown === 1;
      c.l2.visible = shown === 2;
    }
    // Tiers without LOD0 release every built one (one per frame); otherwise keep a small cache.
    if (farthest && (noLod0 || lod0Count > LOD0_KEEP)) releaseLod0(farthest);
    // The boot-compile LOD0 has done its job once the first frame runs (after the compile stage).
    if (warm) {
      if (warm.level !== 0) releaseLod0(warm);
      warm = null;
    }
    pending = job || nearest ? 1 : 0;
    if (job && job.c.level !== 0) job = null;
    if (!job && nearest) job = { c: nearest, job: newJob(nearest) };
    if (!job) return;
    const g = job.job.step(performance.now() + budgetMs);
    if (g === undefined) return;
    attachLod0(job.c, g);
    job = null;
  };
  // Boot: LOD0 for the chunks around the starting camera at once, so the first view is final and
  // the near (interior-mapped) facade program is compiled with the rest during the boot stage.
  for (let k = 0; k < lods.length && !low; k++) {
    updateLods(Infinity);
    if (!lods.some((c) => c.level === 0 && !c.l0)) break;
  }
  updateLods(0);
  // A far start pose has no LOD0 yet: build the nearest chunk's anyway and leave it visible for
  // the boot compile; the first update hides it again.
  if (!low && lod0Count === 0) {
    let first: ChunkLod | null = null;
    for (const c of lods) {
      if (!first || c.box.distanceToPoint(camPos) < first.box.distanceToPoint(camPos)) first = c;
    }
    if (first) {
      attachLod0(first, newJob(first).step(Infinity) ?? null);
      if (first.l0) first.l0.visible = true;
      warm = first;
    }
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
    // Landmark towers are drawn from their own geometry, not the tier boxes buildingFaces sees:
    // their faces are not usable for signs.
    faces: specs.map((s) =>
      buildingFaces(s).map((f) => ({
        ...f,
        blank: faceBlank(s, f.side, onStreet),
        usable: !s.tags.landmark,
      })),
    ),
    maxHeight: specs.reduce((m, s) => Math.max(m, buildingTop(s)), 0),
    roadY: ROAD_Y,
    sidewalkHeight: SIDEWALK_H,
    materials: { facade, facadeNear, road: roadMat, sidewalk: walkMat },
    lod0Pending: () => pending,
  };
  ctx.buildings = api;

  const params = { litScale: 1 };
  const folder = gui.addFolder('Buildings');
  folder.add(params, 'litScale', 0, 3, 0.05).name('Lit windows ×');
  for (const k of Object.keys(info) as (keyof typeof info)[])
    folder.add(info, k).listen().disable();
  folder.close();

  return {
    update(_dt, elapsed) {
      uniforms.uLitRatio.value = env.windowLitRatio * params.litScale;
      uniforms.uNight.value = env.nightFactor;
      // Lighting owns the fill curve; before it sets one, fall back to the night teal floor.
      if (env.fillColor) uniforms.uFillColor.value.copy(env.fillColor);
      else uniforms.uFillColor.value.fromArray(NIGHT_FILL_AMBIENT).multiplyScalar(env.nightFactor);
      uniforms.uPower.value = env.powerOn;
      uniforms.uTime.value = elapsed;
      wet.value = Math.max(env.wetness, 0.55 * env.nightFactor);
      updateLods(low ? 0 : LOD0_BUDGET_MS);
      info['LOD0 chunks'] = lod0Count;
    },
    dispose() {
      offQuality();
      scene.remove(group);
      for (const g of geometries) g.dispose();
      for (const c of lods) releaseLod0(c);
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
