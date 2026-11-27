// Infra module (ART_DIRECTION 2.3, 2.5, 13.1): elevated highways, ramps, pillars, sound walls
// and the three bridges, plus their static lights. Publishes ctx.infra (InfraApi).
//
// Draw calls (11, budget 12): concrete, steel, lane paint, glow lines, uplight wash (merged
// meshes) + pillar columns, pillar beams, light points (InstancedMesh) + bridge detail steel,
// glow and paint (BatchedMesh, one instance per bridge, hidden by distance LOD; not built for
// quality 'low'). No real lights.
import * as THREE from 'three';
import { deckHeightAt, highwayCurve } from '../city/layout';
import { MATERIAL } from '../core/palette';

// TEMP until #77 lands in palette.ts.
const NIGHT_FILL_AMBIENT = [0.003, 0.005, 0.005] as const;

/** Night fill multiplier over the shared floor (measured: 1× leaves undersides at 3/255). */
const INFRA_FILL = 3;
import { EMISSIVE_FOG_DENSITY_SCALE, applyEmissiveFog } from '../core/shaders/emissiveFog';
import type { CityModuleInstance, Ctx, InfraApi } from '../core/types';
import { buildInfra } from './build';
import { infraColors } from './colors';
import { bridgeDetailOn } from './lod';
import type { MeshData, V3 } from './mesh';
import type { BridgeDetail, DetailParts } from './parts';
import { DECK_THICKNESS } from './profile';

function toGeometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(m.normals, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(m.colors, 3));
  // Same rule as three's arrayNeedsUint32: index 65535 is the Uint16 primitive-restart value.
  let maxIndex = 0;
  for (const i of m.indices) if (i > maxIndex) maxIndex = i;
  g.setIndex(
    maxIndex >= 65535
      ? new THREE.Uint32BufferAttribute(m.indices, 1)
      : new THREE.Uint16BufferAttribute(m.indices, 1),
  );
  g.computeBoundingSphere();
  return g;
}

/** Chamfered rectangular prism, foot at y = 0, top at y = 1, 1 × 1 footprint. */
function columnGeometry(): THREE.BufferGeometry {
  const c = 0.3;
  const pts: [number, number][] = [
    [-0.5, -c],
    [-c, -0.5],
    [c, -0.5],
    [0.5, -c],
    [0.5, c],
    [c, 0.5],
    [-c, 0.5],
    [-0.5, c],
  ];
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); // extrude along +Y
  return g;
}

/** Fog for additive materials: same thinned density as emissive fog, but fades to black. */
const WASH_FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float washFog = 1.0 - exp( - pow( fogDensity * ${EMISSIVE_FOG_DENSITY_SCALE.toFixed(4)} * vFogDepth, 2.0 ) );
  #else
    float washFog = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb *= 1.0 - washFog;
#endif
`;

function emissiveBasic(params: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, ...params });
  m.onBeforeCompile = (shader) => {
    applyEmissiveFog(shader);
  };
  return m;
}

const DETAIL_KEYS = ['steel', 'glow', 'markings'] as const satisfies readonly (keyof DetailParts)[];

interface DetailLod {
  /** One BatchedMesh per DETAIL_KEYS entry; materials are shared with the base meshes. */
  meshes: THREE.BatchedMesh[];
  /** Per bridge: center, current state and its instance id in each mesh (-1 = no geometry). */
  bridges: { center: V3; on: boolean; ids: number[] }[];
}

function buildDetail(
  list: readonly BridgeDetail[],
  materials: Record<(typeof DETAIL_KEYS)[number], THREE.Material>,
): DetailLod | null {
  if (list.length === 0) return null;
  const bridges = list.map((d) => ({ center: d.center, on: true, ids: [] as number[] }));
  const meshes = DETAIL_KEYS.map((key, k) => {
    const datas = list.map((d) => d[key]);
    const vertices = datas.reduce((n, m) => n + m.vertexCount, 0);
    const indices = datas.reduce((n, m) => n + m.indices.length, 0);
    const batch = new THREE.BatchedMesh(
      list.length,
      Math.max(1, vertices),
      Math.max(1, indices),
      materials[key],
    );
    batch.name = `infra-detail-${key}`;
    datas.forEach((m, i) => {
      let id = -1;
      if (m.vertexCount > 0) {
        const g = toGeometry(m);
        id = batch.addInstance(batch.addGeometry(g));
        g.dispose();
      }
      const entry = bridges[i];
      if (entry) entry.ids[k] = id;
    });
    batch.computeBoundingSphere();
    if (key === 'steel') {
      batch.castShadow = true;
      batch.receiveShadow = true;
    }
    if (key === 'markings') batch.receiveShadow = true;
    return batch;
  });
  return { meshes, bridges };
}

export function init(ctx: Ctx): CityModuleInstance {
  const L = ctx.LAYOUT;
  const parts = buildInfra(L, infraColors(), ctx.env.quality !== 'ci');

  const group = new THREE.Group();
  group.name = 'infra';
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const mesh = (data: MeshData, material: THREE.Material, name: string): THREE.Mesh => {
    const g = toGeometry(data);
    geometries.push(g);
    materials.push(material);
    const m = new THREE.Mesh(g, material);
    m.name = name;
    return m;
  };

  const concrete = mesh(
    parts.concrete,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0,
    }),
    'infra-concrete',
  );
  concrete.castShadow = true;
  concrete.receiveShadow = true;

  const steel = mesh(
    parts.steel,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.5,
      metalness: 0.35,
    }),
    'infra-steel',
  );
  steel.castShadow = true;
  steel.receiveShadow = true;

  // Lane paint is never emissive (palette laneWhite / laneYellow); it reads under lights only.
  const paintMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const paint = mesh(parts.markings, paintMat, 'infra-paint');
  paint.receiveShadow = true;

  const glowMat = emissiveBasic({});
  const glow = mesh(parts.glow, glowMat, 'infra-glow');

  // Additive: fogging toward fogColor would add a grey slab, so fade toward black instead.
  const washMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  washMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      WASH_FOG_FRAGMENT,
    );
  };
  const wash = mesh(parts.wash, washMat, 'infra-wash');
  wash.renderOrder = 2;

  // Pillars and bridge piers: one InstancedMesh of columns, one of beams (T caps, Y arms).
  const pillarMat = new THREE.MeshStandardMaterial({
    color: MATERIAL.concrete,
    roughness: 0.9,
  });
  materials.push(pillarMat);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  const colGeo = columnGeometry();
  geometries.push(colGeo);
  const columns = new THREE.InstancedMesh(colGeo, pillarMat, parts.columns.length);
  parts.columns.forEach((c, i) => {
    q.setFromEuler(e.set(0, c.rotY, 0));
    m4.compose(pos.set(c.x, c.y0, c.z), q, scl.set(c.w, c.y1 - c.y0, c.d));
    columns.setMatrixAt(i, m4);
  });
  columns.name = 'infra-columns';

  const beamGeo = new THREE.BoxGeometry(1, 1, 1);
  geometries.push(beamGeo);
  const beams = new THREE.InstancedMesh(beamGeo, pillarMat, parts.beams.length);
  parts.beams.forEach((b, i) => {
    q.setFromEuler(e.set(0, b.rotY, b.roll));
    m4.compose(pos.set(...b.center), q, scl.set(...b.size));
    beams.setMatrixAt(i, m4);
  });
  beams.name = 'infra-beams';

  const pointGeo = new THREE.OctahedronGeometry(1, 0);
  geometries.push(pointGeo);
  const pointMat = emissiveBasic({ vertexColors: false });
  materials.push(pointMat);
  const points = new THREE.InstancedMesh(pointGeo, pointMat, parts.points.length);
  const col = new THREE.Color();
  parts.points.forEach((p, i) => {
    q.setFromEuler(e.set(0, p.rotY, 0));
    m4.compose(pos.set(...p.p), q, scl.set(...p.size));
    points.setMatrixAt(i, m4);
    points.setColorAt(i, col.setRGB(p.color[0], p.color[1], p.color[2]));
  });
  points.name = 'infra-points';

  for (const im of [columns, beams, points]) {
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }
  for (const im of [columns, beams]) {
    im.castShadow = true;
    im.receiveShadow = true;
  }

  // Empty for quality 'low' (buildInfra skipped the detail), so no BatchedMesh is created.
  const detail = buildDetail(parts.bridgeDetail, {
    steel: steel.material as THREE.Material,
    glow: glowMat,
    markings: paintMat,
  });

  group.add(concrete, steel, paint, columns, beams, glow, wash, points);
  if (detail) group.add(...detail.meshes);
  ctx.scene.add(group);

  const curves = new Map<string, THREE.CatmullRomCurve3>();
  for (const hw of L.highways) curves.set(hw.id, highwayCurve(hw));
  const api: InfraApi = {
    group,
    curves,
    deckThickness: DECK_THICKNESS,
    deckHeightAt: (x, z) => deckHeightAt(L, x, z),
  };
  ctx.infra = api;

  const settings = { gain: 1, visible: true };
  const folder = ctx.gui.addFolder('Infra');
  folder.add(settings, 'gain', 0, 2, 0.01).name('light gain');
  folder.add(settings, 'visible').onChange((v: boolean) => (group.visible = v));
  folder.close();

  const emissive = [glowMat, washMat, pointMat];
  // Night fill: unlit undersides and piers would round to pure black up close. They get no street
  // or window light at all, so they need INFRA_FILL × the facade / terrain floor to read.
  const filled = [concrete.material, steel.material, pillarMat] as THREE.MeshStandardMaterial[];
  return {
    update() {
      if (detail) {
        const cam = ctx.camera.position;
        for (const b of detail.bridges) {
          const dx = cam.x - b.center[0];
          const dy = cam.y - b.center[1];
          const dz = cam.z - b.center[2];
          const on = bridgeDetailOn(b.on, dx * dx + dy * dy + dz * dz);
          if (on === b.on) continue;
          b.on = on;
          detail.meshes.forEach((m, k) => {
            const id = b.ids[k] ?? -1;
            if (id >= 0) m.setVisibleAt(id, on);
          });
        }
      }
      const gain = ctx.env.neonGain * ctx.env.powerOn * settings.gain;
      for (const m of emissive) m.color.setScalar(gain);
      const [r, g, b] = NIGHT_FILL_AMBIENT;
      const k = ctx.env.nightFactor * INFRA_FILL;
      for (const m of filled) m.emissive.setRGB(r * k, g * k, b * k);
    },
    dispose() {
      ctx.scene.remove(group);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const im of [columns, beams, points]) im.dispose();
      detail?.meshes.forEach((m) => m.dispose());
      folder.destroy();
      if (ctx.infra === api) delete ctx.infra;
    },
  };
}
