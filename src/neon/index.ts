import * as THREE from 'three';
import {
  buildingContaining,
  buildingFaces,
  deckHeightAt,
  highwayCurve,
  surfaceHeight,
  type BuildingFace,
  type Layout,
  type Vec3,
} from '../city/layout';
import { MATERIAL, NEON, SCREEN_MIN_GAIN, type NeonName } from '../core/palette';
import type { CityModuleInstance, Ctx, Quality } from '../core/types';
import { buildAtlas } from './atlas';
import { buildCatalog } from './catalog';
import { createNeonUniforms } from './glsl';
import { hdrColor } from './geom';
import {
  bridgePaths,
  groundPaths,
  highwayPath,
  vehicleStreams,
  type Path,
  railPaths,
  skyPaths,
} from './lanes';
import { LIGHT_BUDGETS, createLightPool, type LightCandidate } from './lights';
import { placeSigns, roadGapIndex, type FlatSign, type Placement } from './placement';
import { buildHolograms, buildRings, buildScreens } from './screens';
import { buildFountains, fountainJets, fountainJetsFromNozzles } from './fountain';
import { buildPaint } from './paint';
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
    if (f.wash) continue;
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
    // Painted walls are lit by their lamps, not glowing: no reflection on the road.
    if (s.kind === 'crown' || s.wash || s.y0 > 30) continue;
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
  // infra's curve wins: it is trimmed to the visible deck, so its `closed` (not the layout's)
  // says whether traffic loops or fades out at the ends.
  const curveFor = (id: string): THREE.CatmullRomCurve3 | undefined => {
    const hw = L.highways.find((h) => h.id === id);
    return infra?.curves.get(id) ?? (hw ? highwayCurve(hw) : undefined);
  };
  const curveSamples = (id: string): Vec3[] | null => {
    const curve = curveFor(id);
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
  const street = planStreet(L, catalog, sidewalkH);
  const P = placeSigns(L, faces, catalog, { reserved: street.flats.length });

  const flats = buildFlatSigns(shared, atlas.texture, catalog, [
    ...P.flats.filter((f) => !f.wash),
    ...street.flats,
  ]);
  const paint = buildPaint(
    shared,
    atlas.texture,
    catalog,
    P.flats.filter((f) => f.wash),
  );
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
  // Banners hang from cables tied to the facades a little higher on each side (a slight sag).
  const wires = bannerWires(P.flats, L);
  const wireGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 4).translate(0, 0.5, 0);
  const bannerCables = new THREE.InstancedMesh(wireGeo, poleMat, Math.max(1, wires.length));
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();
  wires.forEach((w, i) => {
    dir.set(w.b.x - w.a.x, w.b.y - w.a.y, w.b.z - w.a.z);
    const len = dir.length();
    q.setFromUnitVectors(up, dir.normalize());
    m4.compose(new THREE.Vector3(w.a.x, w.a.y, w.a.z), q, new THREE.Vector3(1, len, 1));
    bannerCables.setMatrixAt(i, m4);
  });
  bannerCables.count = wires.length;
  bannerCables.computeBoundingSphere();
  bannerCables.name = 'neon-banner-cables';
  disposables.push(
    wireGeo,
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
  for (const m of [screens, rings, holos, halos, decals, paint]) {
    disposables.push(m.geometry, m.material as THREE.Material);
  }
  const nozzles = ctx.infra?.fountainNozzles;
  const jets = nozzles
    ? fountainJetsFromNozzles(nozzles, L.river.waterY)
    : fountainJets(L.bridges, L.river.waterY);
  const fountains = buildFountains(shared, jets);
  disposables.push(fountains.geometry, fountains.material as THREE.Material);
  group.add(
    flats,
    tubeMesh,
    crossMesh,
    crossPoles,
    bannerCables,
    paint,
    screens,
    rings,
    holos,
    halos,
    decals,
    fountains,
  );

  const streetMeshes = buildStreet(street, solidMat);
  group.add(streetMeshes.group);
  disposables.push(streetMeshes);

  const paths: Path[] = [
    ...groundPaths(L.roads, (x, z) => surfaceHeight(x, z) + roadY),
    ...bridgePaths(L.bridges, deckY),
  ];
  for (const hw of L.highways) {
    const s = curveSamples(hw.id);
    if (s) paths.push(highwayPath(hw.id, s, curveFor(hw.id)?.closed ?? hw.closed));
  }
  paths.push(...skyPaths(L.skyLanes));
  const tracks = ctx.infra?.railTracks;
  if (tracks) paths.push(...railPaths(tracks));
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
  // User tiers (docs/PERF.md): fewer point lights, no halos, reflections or fountains on low, and a
  // share of the cars and drones. Signs always stay. 'ci' keeps the full set, as before.
  let lowFx = false;
  const applyQuality = (q: Quality): void => {
    lights.setBudget(LIGHT_BUDGETS[q === 'ci' ? 'high' : q]);
    lowFx = q === 'low';
    halos.visible = view.halos && !lowFx;
    decals.visible = view.reflections && !lowFx;
    fountains.visible = !lowFx;
    traffic.setShare(TRAFFIC_SHARE[q]);
  };
  applyQuality(env.quality);
  const offQuality = ctx.onQuality(applyQuality);
  folder.add(view, 'signs').onChange((v: boolean) => {
    for (const m of [flats, tubeMesh, crossMesh, crossPoles, bannerCables, paint, screens, rings])
      m.visible = v;
  });
  folder.add(view, 'traffic').onChange((v: boolean) => (traffic.group.visible = v));
  folder.add(view, 'halos').onChange((v: boolean) => (halos.visible = v && !lowFx));
  folder.add(view, 'reflections').onChange((v: boolean) => (decals.visible = v && !lowFx));
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
      trains: traffic.trains,
      fountainJets: jets.length,
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
      offQuality();
      crossPoles.dispose();
      bannerCables.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}

const CABLE_MAX_REACH = 8;
const CABLE_STEP = 0.25;
const CABLE_RISE = 1;

// A banner cable runs from the banner end across the road until it meets a facade; without a
// wall within reach there is no cable (nothing to tie it to).
function bannerWires(flats: readonly FlatSign[], L: Layout): { a: Vec3; b: Vec3 }[] {
  const out: { a: Vec3; b: Vec3 }[] = [];
  for (const s of flats) {
    if (s.building >= 0) continue;
    const tx = -s.nz;
    const tz = s.nx;
    const y = s.y1 + CABLE_RISE;
    for (const side of [-1, 1]) {
      const ex = s.x + (tx * side * s.w) / 2;
      const ez = s.z + (tz * side * s.w) / 2;
      let anchor: Vec3 | null = null;
      for (let d = CABLE_STEP; d <= CABLE_MAX_REACH; d += CABLE_STEP) {
        const x = ex + tx * side * d;
        const z = ez + tz * side * d;
        if (buildingContaining(L, x, y, z) !== null) {
          anchor = { x: x - tx * side * CABLE_STEP, y, z: z - tz * side * CABLE_STEP };
          break;
        }
      }
      if (anchor) out.push({ a: { x: ex, y: s.y1, z: ez }, b: anchor });
    }
  }
  return out;
}

const TRAFFIC_SHARE: Readonly<Record<Quality, number>> = { high: 1, medium: 0.7, low: 0.4, ci: 1 };

function countDrawables(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if ((o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) && o.visible) n++;
  });
  return n;
}
