// Street prop meshes from a StreetPlan (6.2): pole bodies, lamp heads, 포장마차 tents,
// bus shelters and additive light pools. Static instancing, a few draw calls in total.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MATERIAL, NEON } from '../core/palette';
import { ADDITIVE_TAIL, COMMON_PARS, neonMaterial, type NeonUniforms } from './glsl';
import { hdrColor, setInstanceAttributes, toInstanced } from './geom';
import { buildEmissiveSolids, type SolidInstance } from './signs';
import { LAMP, type Pool, type StreetPlan } from './streetPlan';

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return g;
}

function lampBodyGeometry(): THREE.BufferGeometry {
  return merge([
    new THREE.CylinderGeometry(0.11, 0.16, LAMP.height, 6).translate(0, LAMP.height / 2, 0),
    new THREE.BoxGeometry(LAMP.arm + 0.3, 0.12, 0.12).translate(LAMP.arm / 2, LAMP.height - 0.1, 0),
    new THREE.BoxGeometry(1.1, 0.22, 0.45).translate(LAMP.arm, LAMP.height - 0.2, 0),
  ]);
}

function shelterGeometry(): THREE.BufferGeometry {
  return merge([
    new THREE.BoxGeometry(4.2, 0.12, 1.7).translate(0, 2.55, 0.1),
    new THREE.BoxGeometry(0.08, 2.5, 0.08).translate(-1.9, 1.25, 0.75),
    new THREE.BoxGeometry(0.08, 2.5, 0.08).translate(1.9, 1.25, 0.75),
    new THREE.BoxGeometry(4.0, 2.2, 0.05).translate(0, 1.35, 0.85),
    new THREE.BoxGeometry(2.6, 0.08, 0.45).translate(0, 0.5, 0.55),
    new THREE.BoxGeometry(0.15, 2.2, 1.3).translate(2.1, 1.25, 0.2),
  ]);
}

function stallBodyGeometry(): THREE.BufferGeometry {
  // Table, stools and the cart base under the tent.
  return merge([
    new THREE.BoxGeometry(2.6, 0.9, 0.8).translate(0, 0.45, 0.4),
    new THREE.BoxGeometry(1.6, 0.06, 0.7).translate(0, 0.72, -1.6),
    new THREE.CylinderGeometry(0.18, 0.18, 0.45, 6).translate(-0.6, 0.22, -2.2),
    new THREE.CylinderGeometry(0.18, 0.18, 0.45, 6).translate(0.6, 0.22, -2.2),
  ]);
}

/** Tent: 3 × 2.4 m box (0..1.9 m) with a peaked roof to 2.2 m, unit-free (scaled 1). */
function tentGeometry(): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(3, 1.9, 2.4).translate(0, 0.95, 0);
  const roof = new THREE.CylinderGeometry(1.7, 1.7, 3, 3, 1)
    .rotateZ(Math.PI / 2)
    .scale(1, 0.18, 0.72)
    .translate(0, 1.95, 0);
  return merge([box, roof]);
}

export interface StreetMeshes {
  group: THREE.Group;
  dispose(): void;
}

function instancedBody(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  mats: THREE.Matrix4[],
  name: string,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
  mats.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.count = mats.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
function trs(
  x: number,
  y: number,
  z: number,
  yaw: number,
  sx: number,
  sy = sx,
  sz = sx,
): THREE.Matrix4 {
  return _m.clone().compose(_p.set(x, y, z), _q.setFromAxisAngle(UP, yaw), _s.set(sx, sy, sz));
}

function poolColor(p: Pool): [number, number, number] {
  if (p.color === 'core') return hdrColor(MATERIAL.streetLightCore, p.strength);
  if (p.color === 'sodium') return hdrColor(MATERIAL.streetLightSodium, p.strength);
  return hdrColor(NEON[p.color].hex, p.strength);
}

function buildPools(shared: NeonUniforms, pools: readonly Pool[]): THREE.Mesh {
  const n = pools.length;
  const iPos = new Float32Array(n * 4);
  const iColor = new Float32Array(n * 3);
  pools.forEach((p, i) => {
    iPos.set([p.x, p.y, p.z, p.radius], i * 4);
    iColor.set(poolColor(p), i * 3);
  });
  const geo = setInstanceAttributes(
    toInstanced(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2)),
    n,
    {
      iPos: { size: 4, data: iPos },
      iColor: { size: 3, data: iColor },
    },
  );
  const mat = neonMaterial(shared, {
    additive: true,
    vertexShader: /* glsl */ `
      ${COMMON_PARS}
      attribute vec4 iPos; attribute vec3 iColor;
      varying vec2 vUv; varying vec3 vCol; varying float vFade;
      #include <fog_pars_vertex>
      void main() {
        vec3 world = iPos.xyz + vec3(position.x * iPos.w, 0.0, position.z * iPos.w);
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vUv = position.xz;
        vCol = iColor;
        // Street props cull at 250 m (6.2): fade the pools out instead of popping.
        vFade = 1.0 - smoothstep(200.0, 250.0, length(cameraPosition - iPos.xyz));
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON_PARS}
      varying vec2 vUv; varying vec3 vCol; varying float vFade;
      #include <fog_pars_fragment>
      void main() {
        if (vFade <= 0.0) discard;
        float d = dot(vUv, vUv);
        float a = exp(-d * 3.0) * (1.0 - smoothstep(0.75, 1.0, d));
        float wetBoost = 1.0 + uWet * 0.6;
        gl_FragColor = vec4(vCol * a * vFade * uNight * wetBoost * uPower, 1.0);
        ${ADDITIVE_TAIL}
      }
    `,
  });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -1;
  mat.polygonOffsetUnits = -1;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'neon-light-pools';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

export function buildStreet(
  shared: NeonUniforms,
  plan: StreetPlan,
  solidMat: THREE.ShaderMaterial,
): StreetMeshes {
  const group = new THREE.Group();
  group.name = 'neon-street';
  const disposables: { dispose(): void }[] = [];
  const metal = new THREE.MeshStandardMaterial({
    color: MATERIAL.bracing,
    metalness: 0.8,
    roughness: 0.45,
  });
  disposables.push(metal);

  // Lamp poles (street lights and stair lamps share one mesh, stair lamps scaled ~0.35).
  const lampGeo = lampBodyGeometry();
  const lampBodies = instancedBody(
    lampGeo,
    metal,
    plan.lamps.map((l) => trs(l.x, l.y, l.z, l.yaw, l.scale)),
    'street-light-poles',
  );
  group.add(lampBodies);
  disposables.push(lampGeo);

  // Plain poles: sign poles.
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 1, 6).translate(0, 0.5, 0);
  group.add(
    instancedBody(
      poleGeo,
      metal,
      plan.poles.map((p) => trs(p.x, p.y, p.z, 0, 1, p.h, 1)),
      'sign-poles',
    ),
  );
  disposables.push(poleGeo);

  // Bus shelters and stall furniture.
  const shelterGeo = shelterGeometry();
  group.add(
    instancedBody(
      shelterGeo,
      metal,
      plan.busStops.map((b) => trs(b.x, b.y, b.z, b.yaw, 1)),
      'bus-shelters',
    ),
  );
  const stallGeo = stallBodyGeometry();
  group.add(
    instancedBody(
      stallGeo,
      metal,
      plan.stalls.map((s) => trs(s.x, s.y, s.z, s.yaw, 1)),
      'stall-furniture',
    ),
  );
  disposables.push(shelterGeo, stallGeo);

  // Lamp heads, bus-shelter light strips and stall bulbs: emissive boxes in one mesh.
  const heads: SolidInstance[] = [];
  for (const l of plan.lamps) {
    const hex = l.kind === 'core' ? MATERIAL.streetLightCore : MATERIAL.streetLightSodium;
    heads.push({
      x: l.hx,
      y: l.hy - 0.06 * l.scale,
      z: l.hz,
      sx: 1.0 * l.scale,
      sy: 0.08 * l.scale,
      sz: 0.38 * l.scale,
      rotY: l.yaw,
      color: hdrColor(hex, 3),
      anim: 0,
      seed: Math.floor(l.x * 13 + l.z * 7),
      zone: 0.1,
    });
  }
  for (const b of plan.busStops) {
    heads.push({
      x: b.x,
      y: b.y + 2.47,
      z: b.z,
      sx: 3.6,
      sy: 0.04,
      sz: 0.12,
      rotY: b.yaw,
      color: hdrColor(NEON.neonWhite.hex, 2.5),
      anim: 0,
      seed: 1,
      zone: 0.3,
    });
  }
  for (const s of plan.stalls) {
    for (const side of [-0.8, 0.8]) {
      const c = Math.cos(s.yaw);
      const sn = Math.sin(s.yaw);
      // Bulbs hang just inside the open front (local -Z).
      const lx = side;
      const lz = -1.0;
      heads.push({
        x: s.x + c * lx + sn * lz,
        y: s.y + 1.75,
        z: s.z - sn * lx + c * lz,
        sx: 0.14,
        sy: 0.16,
        sz: 0.14,
        rotY: s.yaw,
        color: hdrColor(MATERIAL.streetLightSodium, 6),
        anim: 0,
        seed: s.seed,
        zone: s.river ? 0.05 : 0.5,
      });
    }
  }
  const headGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const headMesh = buildEmissiveSolids(headGeo, solidMat, heads, 'street-lamp-heads');
  group.add(headMesh);
  disposables.push(headMesh.geometry);

  // 포장마차 tents: orange tarp glowing from inside (HDR ×1.8).
  const tents: SolidInstance[] = plan.stalls.map((s) => ({
    x: s.x,
    y: s.y,
    z: s.z,
    sx: 1,
    sy: 1,
    sz: 1,
    rotY: s.yaw,
    color: hdrColor(NEON.neonOrange.hex, 1.8),
    anim: 0,
    seed: s.seed,
    zone: s.river ? 0.04 : 0.5,
  }));
  const tentMesh = buildEmissiveSolids(tentGeometry(), solidMat, tents, 'pojangmacha-tents');
  group.add(tentMesh);
  disposables.push(tentMesh.geometry);

  const pools = buildPools(shared, plan.pools);
  group.add(pools);
  disposables.push(pools.geometry, pools.material as THREE.Material);

  return {
    group,
    dispose() {
      for (const d of disposables) d.dispose();
      for (const c of group.children) if (c instanceof THREE.InstancedMesh) c.dispose();
    },
  };
}
