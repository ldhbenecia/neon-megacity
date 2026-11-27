import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MATERIAL, NEON } from '../core/palette';
import { PATH_PARS, type NeonUniforms } from './glsl';
import { GlowMode, glowMaterial } from './glow';
import { toInstanced } from './geom';
import { packPaths, type Path, type Vehicle } from './lanes';

export const PATH_TEX_WIDTH = 512;

function pathTexture(paths: readonly Path[]): THREE.DataTexture {
  const data = packPaths(paths, PATH_TEX_WIDTH);
  const tex = new THREE.DataTexture(
    data,
    PATH_TEX_WIDTH,
    Math.max(1, paths.length),
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function instanceAttributes(
  geo: THREE.InstancedBufferGeometry,
  paths: readonly Path[],
  list: readonly Vehicle[],
): void {
  const n = list.length;
  const iPath = new Float32Array(n * 4);
  const iMotion = new Float32Array(n * 4);
  const iExtra = new Float32Array(n * 2);
  list.forEach((v, i) => {
    const p = paths[v.path] as Path;
    iPath.set(
      [
        v.path,
        p.closed ? 1 : 0,
        Math.min(0.45, p.fade / Math.max(p.length, 1)),
        p.kind === 'flying' ? 1 : 0,
      ],
      i * 4,
    );
    iMotion.set([v.u0, v.speed, v.dir, v.lane], i * 4);
    iExtra.set([v.lift, v.seed % 1000], i * 2);
  });
  geo.setAttribute('iPath', new THREE.InstancedBufferAttribute(iPath, 4));
  geo.setAttribute('iMotion', new THREE.InstancedBufferAttribute(iMotion, 4));
  geo.setAttribute('iExtra', new THREE.InstancedBufferAttribute(iExtra, 2));
  geo.instanceCount = n;
}

function lightGeometry(flying: boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const corner: number[] = [];
  const kind: number[] = [];
  const index: number[] = [];
  const sprite = (x: number, y: number, z: number, k: number): void => {
    const base = pos.length / 3;
    for (const [cx, cy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      pos.push(x, y, z);
      corner.push(cx, cy);
      kind.push(k);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const half = flying ? 3 : 2.2;
  sprite(half, 0.75, -0.65, 0);
  sprite(half, 0.75, 0.65, 0);
  sprite(-half, 0.85, -0.6, 1);
  sprite(-half, 0.85, 0.6, 1);
  if (flying) {
    sprite(0, -0.6, 0, 3);
  } else {
    const base = pos.length / 3;
    for (const [x, z] of [
      [2.4, -1.4],
      [12, -2.6],
      [12, 2.6],
      [2.4, 1.4],
    ] as const) {
      pos.push(x, 0.06, z);
      corner.push((x - 2.4) / 9.6, z / 2.6);
      kind.push(2);
    }
    index.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setIndex(index);
  return g;
}

const TRAIN_CARS = 6;
const CAR_LEN = 20;

// One car: window bands on both sides (aKind 4, aCorner = metres along the car, 0..1 up). Each
// car is its own instance on its own path point, so a train bends over ramps and fades car by car.
function carLightGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const corner: number[] = [];
  const kind: number[] = [];
  const index: number[] = [];
  const x0 = -CAR_LEN / 2 + 1;
  const x1 = CAR_LEN / 2 - 1;
  for (const z of [-1.62, 1.62]) {
    const base = pos.length / 3;
    for (const [x, y, cx, cy] of [
      [x0, 1.5, 0, 0],
      [x1, 1.5, x1 - x0, 0],
      [x1, 2.6, x1 - x0, 1],
      [x0, 2.6, 0, 1],
    ] as const) {
      pos.push(x, y, z);
      corner.push(cx, cy);
      kind.push(4);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setIndex(index);
  return g;
}

function carBodyGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(CAR_LEN - 0.8, 3.2, 3.1).translate(0, 1.8, 0);
}

/** A train is TRAIN_CARS car instances, each CAR_LEN further back along its path. */
export function trainCars(trains: readonly Vehicle[], paths: readonly Path[]): Vehicle[] {
  const out: Vehicle[] = [];
  for (const t of trains) {
    const len = paths[t.path]?.length ?? 1;
    for (let k = 0; k < TRAIN_CARS; k++) {
      out.push({ ...t, u0: (t.u0 - (k * CAR_LEN) / len + 1) % 1 });
    }
  }
  return out;
}

function bodyGeometry(flying: boolean): THREE.BufferGeometry {
  const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
  ): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const parts = flying
    ? [
        box(6, 0.9, 2.6, 0, 0, 0),
        box(2.4, 0.7, 1.7, 0.6, 0.75, 0),
        box(4, 0.6, 0.8, -0.4, -0.1, 1.8),
        box(4, 0.6, 0.8, -0.4, -0.1, -1.8),
      ]
    : [box(4.4, 0.8, 1.9, 0, 0.6, 0), box(2.3, 0.6, 1.7, -0.3, 1.3, 0)];
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return g;
}

function lightMaterial(shared: NeonUniforms, pathTex: THREE.DataTexture): THREE.ShaderMaterial {
  return glowMaterial(shared, GlowMode.vehicle, {
    uniforms: {
      uPath: { value: pathTex },
      uHead: { value: new THREE.Color(MATERIAL.headlight).multiplyScalar(3.5) },
      uTail: { value: new THREE.Color(MATERIAL.taillight).multiplyScalar(3.2) },
      uGlowA: { value: new THREE.Color(NEON.neonCyan.hex).multiplyScalar(1.6) },
      uGlowB: { value: new THREE.Color(NEON.neonOrange.hex).multiplyScalar(1.6) },
    },
  });
}

function bodyMaterial(
  shared: NeonUniforms,
  pathTex: THREE.DataTexture,
): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: MATERIAL.facadeLight,
    metalness: 0.7,
    roughness: 0.35,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPath = { value: pathTex };
    shader.uniforms.uTime = shared.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\n${PATH_PARS}`)
      .replace(
        // beginnormal_vertex runs before begin_vertex, so the vehicle frame is computed here.
        '#include <beginnormal_vertex>',
        `vec3 vP; vec3 vF; vec3 vR; float vFade;
        vehicleFrame(vP, vF, vR, vFade);
        vec3 objectNormal = vF * normal.x + vec3(0.0, normal.y, 0.0) + vR * normal.z;
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vP + (vF * position.x + vec3(0.0, position.y, 0.0) + vR * position.z) * vFade;`,
      );
  };
  m.customProgramCacheKey = () => 'neon-vehicle-body';
  return m;
}

export interface Traffic {
  group: THREE.Group;
  vehicles: number;
  flying: number;
  trains: number;
  dispose(): void;
}

export function buildTraffic(
  shared: NeonUniforms,
  paths: readonly Path[],
  vehicles: readonly Vehicle[],
): Traffic {
  const group = new THREE.Group();
  group.name = 'neon-traffic';
  const tex = pathTexture(paths);
  const disposables: { dispose(): void }[] = [tex];
  const kindOf = (v: Vehicle): 'car' | 'fly' | 'train' => {
    const k = paths[v.path]?.kind;
    return k === 'flying' ? 'fly' : k === 'rail' ? 'train' : 'car';
  };
  const cars = vehicles.filter((v) => kindOf(v) === 'car');
  const flyers = vehicles.filter((v) => kindOf(v) === 'fly');
  const trains = trainCars(
    vehicles.filter((v) => kindOf(v) === 'train'),
    paths,
  );
  const sets: ['car' | 'fly' | 'train', Vehicle[]][] = [
    ['car', cars],
    ['fly', flyers],
    ['train', trains],
  ];
  for (const [kind, list] of sets) {
    if (!list.length) continue;
    const flying = kind === 'fly';
    const lg = toInstanced(kind === 'train' ? carLightGeometry() : lightGeometry(flying));
    instanceAttributes(lg, paths, list);
    const bg = toInstanced(kind === 'train' ? carBodyGeometry() : bodyGeometry(flying));
    instanceAttributes(bg, paths, list);
    const lm = lightMaterial(shared, tex);
    const bm = bodyMaterial(shared, tex);
    const lights = new THREE.Mesh(lg, lm);
    const bodies = new THREE.Mesh(bg, bm);
    lights.name = `${kind}-lights`;
    bodies.name = `${kind}-bodies`;
    for (const m of [lights, bodies]) {
      // Positions come from the shader; geometry bounds are meaningless.
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
      group.add(m);
    }
    lights.renderOrder = 2;
    disposables.push(lg, bg, lm, bm);
  }
  return {
    group,
    vehicles: cars.length,
    flying: flyers.length,
    trains: trains.length / TRAIN_CARS,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
