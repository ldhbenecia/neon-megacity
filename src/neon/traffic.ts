// Ground, elevated and flying traffic (6.2). One path texture holds every lane polyline; each
// vehicle is an instance that the vertex shader moves with u = fract(u0 + speed * time).
// Two draw calls for cars (lights + bodies) and two for flying vehicles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MATERIAL, NEON } from '../core/palette';
import { ADDITIVE_TAIL, COMMON_PARS, neonMaterial, type NeonUniforms } from './glsl';
import { toInstanced } from './geom';
import { packPaths, type Path, type Vehicle } from './lanes';

export const PATH_TEX_WIDTH = 512;

const PATH_PARS = /* glsl */ `
uniform sampler2D uPath;
attribute vec4 iPath;   // row, closed, fadeFrac, flying
attribute vec4 iMotion; // u0, speed (1/s), dir, lane
attribute vec2 iExtra;  // lift, seed
vec3 pathAt(float row, float u) {
  int r = int(row + 0.5);
  float n = texelFetch(uPath, ivec2(0, r), 0).w;
  float f = clamp(u, 0.0, 1.0) * (n - 1.0);
  float i = min(floor(f), n - 2.0);
  vec3 a = texelFetch(uPath, ivec2(int(i), r), 0).xyz;
  vec3 b = texelFetch(uPath, ivec2(int(i) + 1, r), 0).xyz;
  return mix(a, b, f - i);
}
float wrapU(float u, float closed) { return closed > 0.5 ? fract(u) : clamp(u, 0.0, 1.0); }
// Vehicle frame: position P, forward F, right R; fade = 0 at open path ends (never pops in).
void vehicleFrame(out vec3 P, out vec3 F, out vec3 R, out float fade) {
  float u = fract(iMotion.x + iMotion.y * uTime);
  float ff = iPath.z;
  fade = iPath.y > 0.5 ? 1.0 : smoothstep(0.0, ff, u) * smoothstep(1.0, 1.0 - ff, u);
  float uu = iMotion.z > 0.0 ? u : 1.0 - u;
  float n = texelFetch(uPath, ivec2(0, int(iPath.x + 0.5)), 0).w;
  float du = 1.0 / max(n - 1.0, 1.0);
  vec3 p0 = pathAt(iPath.x, wrapU(uu - du, iPath.y));
  vec3 p1 = pathAt(iPath.x, wrapU(uu + du, iPath.y));
  vec3 d = (p1 - p0) * iMotion.z;
  F = length(d) > 1e-4 ? normalize(d) : vec3(1.0, 0.0, 0.0);
  R = normalize(vec3(-F.z, 0.0, F.x));
  P = pathAt(iPath.x, uu) + R * iMotion.w + vec3(0.0, iExtra.x, 0.0);
  if (iPath.w > 0.5) P.y += sin(uTime * 0.8 + iExtra.y) * 1.2;
}
`;

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

/** Light sprites: per-vertex local center (position), billboard corner and kind. */
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
    // Ground beam: a flat quad on the road ahead (kind 2 uses position as a real vertex).
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
  const head = new THREE.Color(MATERIAL.headlight).multiplyScalar(3.5);
  const tail = new THREE.Color(MATERIAL.taillight).multiplyScalar(3.2);
  const glowA = new THREE.Color(NEON.neonCyan.hex).multiplyScalar(1.6);
  const glowB = new THREE.Color(NEON.neonOrange.hex).multiplyScalar(1.6);
  return neonMaterial(shared, {
    additive: true,
    side: THREE.DoubleSide,
    uniforms: {
      uPath: { value: pathTex },
      uHead: { value: head },
      uTail: { value: tail },
      uGlowA: { value: glowA },
      uGlowB: { value: glowB },
    },
    vertexShader: /* glsl */ `
      ${COMMON_PARS}
      ${PATH_PARS}
      uniform vec3 uHead; uniform vec3 uTail; uniform vec3 uGlowA; uniform vec3 uGlowB;
      attribute vec2 aCorner;
      attribute float aKind;
      varying vec3 vCol;
      varying vec2 vCorner;
      varying float vKind;
      #include <fog_pars_vertex>
      void main() {
        vec3 P; vec3 F; vec3 R; float fade;
        vehicleFrame(P, F, R, fade);
        vec3 up = vec3(0.0, 1.0, 0.0);
        vec3 world = P + F * position.x + up * position.y + R * position.z;
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        vec3 toCam = normalize(cameraPosition - world);
        float facing = dot(toCam, F);
        float k = 1.0;
        vec3 col;
        if (aKind < 0.5) {
          col = uHead * (0.25 + 0.75 * smoothstep(-0.2, 0.6, facing));
        } else if (aKind < 1.5) {
          col = uTail * (0.3 + 0.7 * smoothstep(-0.2, 0.6, -facing));
        } else if (aKind < 2.5) {
          col = uHead * 0.035 * uNight;
        } else {
          col = mix(uGlowA, uGlowB, step(0.5, fract(iExtra.y * 0.618)));
        }
        if (aKind < 1.5 || aKind > 2.5) {
          // Billboard sprite; grows with distance so far streams stay readable (energy ~ k).
          float size = aKind > 2.5 ? 1.1 : (aKind < 0.5 ? 0.32 : 0.28);
          k = clamp(-mvPosition.z / 90.0, 1.0, 7.0);
          mvPosition.xy += aCorner * size * k;
          col /= k;
        }
        vCol = col * fade * mix(0.35, 1.0, uNight);
        vCorner = aCorner;
        vKind = aKind;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON_PARS}
      varying vec3 vCol;
      varying vec2 vCorner;
      varying float vKind;
      #include <fog_pars_fragment>
      void main() {
        float a;
        if (vKind > 1.5 && vKind < 2.5) {
          // Beam: bright near the car, fading forward and to the sides.
          a = (1.0 - vCorner.x) * (1.0 - vCorner.y * vCorner.y);
        } else {
          float d = dot(vCorner, vCorner);
          a = exp(-d * 5.0) + 0.6 * exp(-d * 28.0);
        }
        gl_FragColor = vec4(vCol * a, 1.0);
        ${ADDITIVE_TAIL}
      }
    `,
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
  dispose(): void;
}

/** Builds car + flying vehicle meshes. `vehicles` index into `paths`. */
export function buildTraffic(
  shared: NeonUniforms,
  paths: readonly Path[],
  vehicles: readonly Vehicle[],
): Traffic {
  const group = new THREE.Group();
  group.name = 'neon-traffic';
  const tex = pathTexture(paths);
  const disposables: { dispose(): void }[] = [tex];
  const isFlying = (v: Vehicle): boolean => paths[v.path]?.kind === 'flying';
  const cars = vehicles.filter((v) => !isFlying(v));
  const flyers = vehicles.filter(isFlying);
  const sets: [boolean, Vehicle[]][] = [
    [false, cars],
    [true, flyers],
  ];
  for (const [flying, list] of sets) {
    if (!list.length) continue;
    const lg = toInstanced(lightGeometry(flying));
    instanceAttributes(lg, paths, list);
    const bg = toInstanced(bodyGeometry(flying));
    instanceAttributes(bg, paths, list);
    const lm = lightMaterial(shared, tex);
    const bm = bodyMaterial(shared, tex);
    const lights = new THREE.Mesh(lg, lm);
    const bodies = new THREE.Mesh(bg, bm);
    lights.name = flying ? 'flying-lights' : 'car-lights';
    bodies.name = flying ? 'flying-bodies' : 'car-bodies';
    for (const m of [lights, bodies]) {
      m.frustumCulled = false; // positions come from the shader
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
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
