import * as THREE from 'three';
import {
  buildingFaces,
  deckHeightAt,
  highwayCurve,
  surfaceHeight,
  type BuildingFace,
  type Vec3,
} from '../city/layout';
import { MATERIAL, NEON, SCREEN_MIN_GAIN, type NeonName } from '../core/palette';
import type { CityModuleInstance, Ctx } from '../core/types';
import { buildAtlas } from './atlas';
import { buildCatalog } from './catalog';
import { createNeonUniforms } from './glsl';
import { hdrColor } from './geom';
import { bridgePaths, groundPaths, highwayPath, vehicleStreams, type Path } from './lanes';
import { createLightPool, type LightCandidate } from './lights';
import { placeSigns, roadGapIndex, type Placement } from './placement';
import { buildHolograms, buildRings, buildScreens } from './screens';
import { createSelection } from './selection';
import {
  buildEmissiveSolids,
  buildFlatSigns,
  buildHalos,
  buildReflections,
  CROSS_REF_H,
  crossGeometry,
  emissiveSolidMaterial,
  neonHdr,
  signColor,
  tubeGeometry,
  type DecalInstance,
  type HaloInstance,
  type SolidInstance,
} from './signs';
import { buildStreet, poolColor } from './street';
import { planStreet, type StreetPlan } from './streetPlan';
import { buildTraffic } from './traffic';

export const SIDEWALK_FALLBACK = 0.2;
const CURVE_SAMPLES = 400;
const MAX_DECALS = 1500;

const SCREEN_HUES: readonly NeonName[] = ['neonCyan', 'neonOrange', 'neonMagenta'];

function haloList(P: Placement): HaloInstance[] {
  const out: HaloInstance[] = [];
  for (const s of P.screens) {
    out.push({
      x: s.x,
      y: s.y,
      z: s.z,
      size: Math.sqrt(s.w * s.h) * 0.3,
      color: signColor(SCREEN_HUES[s.hue] ?? 'neonCyan', 0.9),
      zone: s.zone,
    });
  }
  for (const r of P.rings) {
    out.push({
      x: r.x,
      y: r.y,
      z: r.z,
      size: r.radius * 0.9,
      color: signColor(r.color, 0.8),
      zone: r.zone,
    });
  }
  for (const f of P.flats) {
    if (f.kind !== 'vtext') continue;
    out.push({
      x: f.x,
      y: f.y,
      z: f.z,
      size: Math.sqrt(f.w * f.h) * 0.45,
      color: signColor(f.color, 0.7),
      zone: f.zone,
    });
  }
  for (const c of P.crosses) {
    out.push({
      x: c.x,
      y: c.roofY + c.poleH + c.h * 0.6,
      z: c.z,
      size: c.h * 0.45,
      color: signColor('neonRed', 1),
      zone: c.zone,
    });
  }
  for (const t of P.tubes) {
    out.push({
      x: t.x,
      y: (t.y0 + t.y1) / 2,
      z: t.z,
      size: Math.sqrt(t.y1 - t.y0) * 0.9,
      color: signColor(t.color, 0.6),
      zone: t.zone,
    });
  }
  return out;
}

function decalList(
  P: Placement,
  street: StreetPlan,
  faces: readonly (readonly BuildingFace[])[],
  roadY: number,
  roadGap: (x: number, z: number) => number,
): DecalInstance[] {
  const out: (DecalInstance & { h: number })[] = [];
  const ground = (x: number, z: number): number => surfaceHeight(x, z) + roadY + 0.04;
  // Start wall-sign reflections at the carriageway edge: on the sidewalk slab they are hidden.
  const outFromWall = (x: number, z: number): number => {
    const gap = roadGap(x, z);
    return Number.isFinite(gap) ? Math.min(8, Math.max(3, gap + 0.3)) : 3;
  };
  for (const s of [...P.flats, ...street.flats]) {
    if (s.kind === 'crown' || s.y0 > 30) continue;
    const f = s.face >= 0 ? faces[s.building]?.[s.face] : undefined;
    const nx = f ? f.normal.x : s.nx;
    const nz = f ? f.normal.z : s.nz;
    const out3 = f ? outFromWall(s.x, s.z) : 0.5;
    const x = s.x + nx * out3;
    const z = s.z + nz * out3;
    const hAbove = Math.max(0, s.y - ground(x, z));
    out.push({
      x,
      y: ground(x, z),
      z,
      width: Math.max(0.5, Math.min(s.kind === 'blade' ? s.h * 0.15 : s.w, 14) * 0.6),
      length: Math.min(25, 6 + hAbove * 0.9),
      color: signColor(s.color, s.kind === 'panel' ? 0.6 : 1.1),
      h: s.y0,
    });
  }
  for (const s of P.screens) {
    const x = s.x + s.nx * 6;
    const z = s.z + s.nz * 6;
    out.push({
      x,
      y: ground(x, z),
      z,
      width: s.w * 0.6,
      length: 25,
      color: signColor(SCREEN_HUES[s.hue] ?? 'neonCyan', 0.8),
      h: 0,
    });
  }
  for (const p of street.pools) {
    out.push({ x: p.x, y: p.y, z: p.z, width: p.radius, length: -1, color: poolColor(p), h: 0 });
  }
  for (const st of street.stalls) {
    out.push({
      x: st.x,
      y: st.y + 0.04,
      z: st.z,
      width: 2.4,
      length: 10,
      color: signColor('neonOrange', 1),
      h: 0,
    });
  }
  out.sort((a, b) => a.h - b.h);
  return out.slice(0, MAX_DECALS);
}

function lightCandidates(P: Placement, street: StreetPlan): LightCandidate[] {
  const out: LightCandidate[] = [];
  for (const l of street.lamps) {
    if (l.scale < 1) continue;
    out.push({
      group: 'street',
      x: l.hx,
      y: l.hy - 0.5,
      z: l.hz,
      color: hdrColor(l.kind === 'core' ? MATERIAL.streetLightCore : MATERIAL.streetLightSodium, 1),
      intensity: 120,
      distance: 38,
    });
  }
  for (const s of P.screens) {
    out.push({
      group: 'screen',
      x: s.x + s.nx * 18,
      y: s.y - s.h * 0.25,
      z: s.z + s.nz * 18,
      color: hdrColor(NEON[SCREEN_HUES[s.hue] ?? 'neonCyan'].hex, 1),
      intensity: 9000,
      distance: 140,
    });
  }
  for (const st of street.stalls) {
    out.push({
      group: st.river ? 'river' : 'stall',
      x: st.x,
      y: st.y + 1.6,
      z: st.z,
      color: hdrColor(NEON.neonOrange.hex, 1),
      intensity: 70,
      distance: 18,
    });
  }
  return out;
}

export function init(ctx: Ctx): CityModuleInstance {
  const { LAYOUT: L, env, scene } = ctx;
  const group = new THREE.Group();
  group.name = 'neon';
  const disposables: { dispose(): void }[] = [];

  // Real BuildingsApi / InfraApi when published, layout pure functions while they are stubs.
  const api = ctx.buildings;
  const specs = api?.specs ?? L.buildings;
  const faces: readonly (readonly BuildingFace[])[] =
    api?.faces ?? L.buildings.map((b) => buildingFaces(b));
  const sidewalkH = api?.sidewalkHeight ?? SIDEWALK_FALLBACK;
  const roadY = api?.roadY ?? 0;
  const infra = ctx.infra;
  const deckY = (x: number, z: number): number =>
    (infra ? infra.deckHeightAt(x, z) : deckHeightAt(L, x, z)) ?? 0;
  const curveSamples = (id: string): Vec3[] | null => {
    const hw = L.highways.find((h) => h.id === id);
    const curve = infra?.curves.get(id) ?? (hw ? highwayCurve(hw) : undefined);
    if (!curve) return null;
    return curve.getSpacedPoints(CURVE_SAMPLES).map((v) => ({ x: v.x, y: v.y, z: v.z }));
  };

  const shared = createNeonUniforms();
  const reduce =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  shared.uMotion.value = reduce ? 0 : 1;
  shared.uScroll.value = reduce ? 0.3 : 1;

  const catalog = buildCatalog({ buildings: [...specs] });
  const atlas = buildAtlas(catalog, ctx.renderer);
  disposables.push(atlas.texture);
  const P = placeSigns(L, faces, catalog);
  const street = planStreet(L, catalog, sidewalkH);

  const flats = buildFlatSigns(shared, atlas.texture, catalog, [...P.flats, ...street.flats]);
  const solidMat = emissiveSolidMaterial(shared);
  const tubes: SolidInstance[] = P.tubes.map((t) => ({
    x: t.x,
    y: t.y0,
    z: t.z,
    sx: t.radius,
    sy: t.y1 - t.y0,
    sz: t.radius,
    rotY: 0,
    color: signColor(t.color, neonHdr(t.color, (t.seed % 89) / 89) * 0.6),
    anim: t.anim,
    seed: t.seed,
    zone: t.zone,
    minPx: 1,
  }));
  const tubeMesh = buildEmissiveSolids(tubeGeometry(), solidMat, tubes, 'neon-tubes');
  const crossSolids: SolidInstance[] = P.crosses.map((c) => ({
    x: c.x,
    y: c.roofY + c.poleH,
    z: c.z,
    sx: c.h / CROSS_REF_H,
    sy: c.h / CROSS_REF_H,
    sz: c.h / CROSS_REF_H,
    rotY: c.rotY,
    color: signColor('neonRed', 6),
    anim: 0,
    seed: c.building,
    zone: c.zone,
  }));
  const crossMesh = buildEmissiveSolids(crossGeometry(), solidMat, crossSolids, 'neon-crosses');
  const poleMat = new THREE.MeshStandardMaterial({
    color: MATERIAL.bracing,
    metalness: 0.8,
    roughness: 0.5,
  });
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 1, 5).translate(0, 0.5, 0);
  const crossPoles = new THREE.InstancedMesh(poleGeo, poleMat, Math.max(1, P.crosses.length));
  const m4 = new THREE.Matrix4();
  P.crosses.forEach((c, i) => {
    crossPoles.setMatrixAt(i, m4.makeScale(1, c.poleH, 1).setPosition(c.x, c.roofY, c.z));
  });
  crossPoles.count = P.crosses.length;
  crossPoles.computeBoundingSphere();
  crossPoles.name = 'neon-cross-poles';
  disposables.push(
    poleMat,
    poleGeo,
    solidMat,
    tubeMesh.geometry,
    crossMesh.geometry,
    flats.geometry,
    flats.material as THREE.Material,
  );

  const screens = buildScreens(shared, atlas.texture, catalog, P.screens);
  const rings = buildRings(shared, atlas.texture, catalog, P.rings);
  const holos = buildHolograms(shared, atlas.texture, catalog, P.holos);
  const halos = buildHalos(shared, haloList(P));
  const decals = buildReflections(
    shared,
    decalList(P, street, faces, roadY, roadGapIndex(ctx.LAYOUT)),
  );
  for (const m of [screens, rings, holos, halos, decals]) {
    disposables.push(m.geometry, m.material as THREE.Material);
  }
  group.add(flats, tubeMesh, crossMesh, crossPoles, screens, rings, holos, halos, decals);

  const streetMeshes = buildStreet(street, solidMat);
  group.add(streetMeshes.group);
  disposables.push(streetMeshes);

  const paths: Path[] = [
    ...groundPaths(L.roads, (x, z) => surfaceHeight(x, z) + roadY),
    ...bridgePaths(L.bridges, deckY),
  ];
  for (const hw of L.highways) {
    const s = curveSamples(hw.id);
    if (s) paths.push(highwayPath(hw.id, s, hw.closed));
  }
  const ringS = curveSamples('hw-ring');
  const riverS = curveSamples('hw-river-north');
  if (ringS) {
    paths.push({ ...highwayPath('fly-ring-low', ringS, true, 'flying'), altitude: [80, 140] });
    paths.push({ ...highwayPath('fly-ring-high', ringS, true, 'flying'), altitude: [200, 260] });
  }
  if (riverS)
    paths.push({ ...highwayPath('fly-river', riverS, false, 'flying'), altitude: [140, 200] });
  const vehicles = vehicleStreams(paths, L.highways);
  const traffic = buildTraffic(shared, paths, vehicles);
  group.add(traffic.group);
  disposables.push(traffic);

  const lights = createLightPool(lightCandidates(P, street));
  group.add(lights.group);
  disposables.push(lights);
  const selection = createSelection(shared);
  group.add(selection.mesh);
  disposables.push(selection);

  for (const o of group.children) o.castShadow = false;
  scene.add(group);

  const folder = ctx.gui.addFolder('Neon');
  const view = { signs: true, traffic: true, halos: true, reflections: true, holograms: true };
  folder.add(view, 'signs').onChange((v: boolean) => {
    for (const m of [flats, tubeMesh, crossMesh, crossPoles, screens, rings]) m.visible = v;
  });
  folder.add(view, 'traffic').onChange((v: boolean) => (traffic.group.visible = v));
  folder.add(view, 'halos').onChange((v: boolean) => (halos.visible = v));
  folder.add(view, 'reflections').onChange((v: boolean) => (decals.visible = v));
  folder.add(view, 'holograms').onChange((v: boolean) => (holos.visible = v));
  folder.close();

  if (typeof window !== 'undefined') {
    (window as unknown as { __neon?: unknown }).__neon = {
      signs: P.flats.length + street.flats.length,
      tubes: P.tubes.length,
      crosses: P.crosses.length,
      screens: P.screens.length,
      rings: P.rings.length,
      holograms: P.holos.length,
      halos:
        halos.geometry instanceof THREE.InstancedBufferGeometry ? halos.geometry.instanceCount : 0,
      decals:
        decals.geometry instanceof THREE.InstancedBufferGeometry
          ? decals.geometry.instanceCount
          : 0,
      lamps: street.lamps.length,
      vehicles: traffic.vehicles,
      flying: traffic.flying,
      pointLights: lights.count,
      drawCalls: countDrawables(group),
    };
  }

  return {
    update(dt, elapsed) {
      shared.uTime.value = elapsed;
      shared.uGain.value = env.neonGain;
      shared.uScreenGain.value = Math.max(env.neonGain, SCREEN_MIN_GAIN);
      shared.uPower.value = env.powerOn;
      shared.uWet.value = env.wetness;
      shared.uNight.value = env.nightFactor;
      lights.update(dt, ctx.camera.position, env.neonGain * env.nightFactor * env.powerOn);
      selection.update(env.selectedBuilding, specs);
    },
    dispose() {
      scene.remove(group);
      folder.destroy();
      crossPoles.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}

function countDrawables(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if ((o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) && o.visible) n++;
  });
  return n;
}
