import * as THREE from 'three';
import { createRng } from '../core/random';
import { MOUNTAIN_RANGES, ROAD_Y, roadSurfaceY, terrainHeight } from '../city/layout';
import { SIDEWALK } from '../city/constants';
import { toLocal } from '../city/math';
import { GridHash, segmentBounds, type Bounds } from '../city/spatial';
import type { Block, BuildingSpec, Layout, Road } from '../city/types';
import { ROAD } from './colors';
import { mergeIntervals } from './params';

export { ROAD_Y };
export const SIDEWALK_H = 0.15;
/** Extra environment reflection in a fully wet puddle (1 + this). */
export const PUDDLE_REFLECTION = 2;

class FlatBuilder {
  pos: number[] = [];
  col: number[] = [];
  nrm: number[] = [];
  idx: number[] = [];
  private c = new THREE.Color();
  quad(
    p: readonly (readonly [number, number, number])[],
    hex: number,
    n: readonly [number, number, number] = [0, 1, 0],
  ): void {
    this.c.setHex(hex);
    const base = this.pos.length / 3;
    for (const v of p) {
      this.pos.push(v[0], v[1], v[2]);
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.nrm.push(n[0], n[1], n[2]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const isHill = (r: Road): boolean => r.district === 'hillside';

/** Ground sample spacing for raised roads and slabs (m). */
export const TERRAIN_STEP = 3;
/** Sidewalk slab sample spacing: the slab top stands 0.15 m clear, so coarser is fine (m). */
const SLAB_STEP = 6;
/** Largest gap between a straight piece and the ground samples it spans (m). */
const TERRAIN_TOL = 0.015;

/**
 * Indices of equally spaced height samples to keep so that straight pieces between kept samples
 * stay within TERRAIN_TOL of every dropped one: flat or evenly sloped runs become one piece.
 */
export function terrainBreaks(h: readonly number[]): number[] {
  const out = [0];
  let i = 0;
  while (i < h.length - 1) {
    let j = i + 1;
    while (j + 1 < h.length) {
      const k = j + 1;
      const hi = h[i] as number;
      const hk = h[k] as number;
      let ok = true;
      for (let m = i + 1; m < k; m++) {
        if (Math.abs(hi + ((hk - hi) * (m - i)) / (k - i) - (h[m] as number)) > TERRAIN_TOL) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
      j = k;
    }
    out.push(j);
    i = j;
  }
  return out;
}

/** Ground is 0 outside every range box, so most city roads skip sampling entirely. */
function nearRange(x0: number, z0: number, x1: number, z1: number): boolean {
  return MOUNTAIN_RANGES.some((m) => x1 >= m.x0 && x0 <= m.x1 && z1 >= m.z0 && z0 <= m.z1);
}

/** Highest ground along a segment, sampled every TERRAIN_STEP. */
function maxTerrainAlong(ax: number, az: number, bx: number, bz: number): number {
  if (!nearRange(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz))) return 0;
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / TERRAIN_STEP));
  let m = 0;
  for (let i = 0; i <= n; i++)
    m = Math.max(m, terrainHeight(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n));
  return m;
}

const raisedCache = new WeakMap<Road, boolean>();
/** Hillside roads and city roads crossing a mountain foot follow the ground. */
function raised(r: Road): boolean {
  let v = raisedCache.get(r);
  if (v === undefined) {
    // Both edges, not just the centre line: a road can brush a mountain foot with one side.
    const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z) || 1;
    const ox = (-(r.b.z - r.a.z) / len) * (r.width / 2);
    const oz = ((r.b.x - r.a.x) / len) * (r.width / 2);
    v =
      isHill(r) ||
      maxTerrainAlong(r.a.x + ox, r.a.z + oz, r.b.x + ox, r.b.z + oz) > 0 ||
      maxTerrainAlong(r.a.x - ox, r.a.z - oz, r.b.x - ox, r.b.z - oz) > 0;
    raisedCache.set(r, v);
  }
  return v;
}

// Roads that never leave flat ground skip the terrain lookup: roadSurfaceY is ROAD_Y there.
function roadHeight(r: Road, x: number, z: number): number {
  return raised(r) ? roadSurfaceY(x, z, r) : ROAD_Y;
}

function crossT(a: Road['a'], b: Road['a'], c: Road['a'], d: Road['a']): number | null {
  const rx = b.x - a.x;
  const rz = b.z - a.z;
  const sx = d.x - c.x;
  const sz = d.z - c.z;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den;
  const u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
  if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) return null;
  return t;
}

/**
 * Length of road `r` covered by crossing road `o` (each side of the crossing point). At an angle θ
 * the other road's width spans w / sin θ along `r`, and `r`'s own half width adds hw · cot θ.
 * Very shallow crossings clear the whole road rather than leave lane marks on the other one.
 */
export function crossingHalf(r: Road, o: Road): number {
  const rl = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z) || 1;
  const ol = Math.hypot(o.b.x - o.a.x, o.b.z - o.a.z) || 1;
  const cross = ((r.b.x - r.a.x) * (o.b.z - o.a.z) - (r.b.z - r.a.z) * (o.b.x - o.a.x)) / (rl * ol);
  const sin = Math.max(1e-3, Math.abs(cross));
  const cos = Math.sqrt(Math.max(0, 1 - sin * sin));
  return Math.min(rl, (o.width / 2 + (r.width / 2) * cos) / sin + 1);
}

function strip(
  B: FlatBuilder,
  r: Road,
  s0: number,
  s1: number,
  l0: number,
  l1: number,
  lift: number,
  hex: number,
): void {
  const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z);
  const dx = (r.b.x - r.a.x) / len;
  const dz = (r.b.z - r.a.z) / len;
  const px = -dz;
  const pz = dx;
  const P = (s: number, l: number): [number, number, number] => {
    const x = r.a.x + dx * s + px * l;
    const z = r.a.z + dz * s + pz * l;
    return [x, roadHeight(r, x, z) + lift, z];
  };
  const n = raised(r) ? Math.max(1, Math.ceil((s1 - s0) / TERRAIN_STEP)) : 1;
  const at = (i: number): number => s0 + ((s1 - s0) * i) / n;
  let keep = [0, n];
  if (n > 1) {
    const lc = (l0 + l1) / 2;
    const h: number[] = [];
    for (let i = 0; i <= n; i++) h.push(P(at(i), lc)[1]);
    keep = terrainBreaks(h);
  }
  for (let i = 1; i < keep.length; i++) {
    const a = at(keep[i - 1] as number);
    const b = at(keep[i] as number);
    B.quad([P(a, l1), P(b, l1), P(b, l0), P(a, l0)], hex);
  }
}

export function buildRoads(L: Layout): THREE.BufferGeometry {
  const B = new FlatBuilder();
  const roads = L.roads.filter((r) => r.kind !== 'stair');
  const crossBounds = (r: Road): Bounds =>
    segmentBounds(r.a, r.b, 0.03 * Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z) + 1);
  const grid = new GridHash();
  roads.forEach((r, id) => grid.insert(id, crossBounds(r)));
  for (const r of roads) {
    const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z);
    if (len < 0.5) continue;
    const hw = r.width / 2;
    const color = r.kind === 'alley' ? ROAD.alley : ROAD.asphalt;
    strip(B, r, 0, len, -hw, hw, 0, color);
    if (r.kind === 'alley' || isHill(r)) continue;

    const crossings: { t: number; half: number }[] = [];
    for (const id of grid.query(crossBounds(r))) {
      const o = roads[id];
      if (!o || o === r || o.kind === 'alley') continue;
      const t = crossT(r.a, r.b, o.a, o.b);
      if (t !== null) crossings.push({ t, half: crossingHalf(r, o) });
    }
    const iv = mergeIntervals(crossings, len);
    const free: [number, number][] = [];
    let cur = 0;
    for (const [a, b] of iv) {
      if (a * len > cur) free.push([cur, a * len]);
      cur = Math.max(cur, b * len);
    }
    if (cur < len) free.push([cur, len]);
    const lift = 0.03;
    for (const [f0, f1] of free) {
      const span = f1 - f0;
      if (span < 6) continue;
      const zebra = r.kind === 'arterial' || r.kind === 'street';
      for (const [edge, dir] of [
        [f0, 1],
        [f1, -1],
      ] as const) {
        if (!zebra || edge <= 0.01 || edge >= len - 0.01) continue;
        const z0 = edge + dir * 0.6;
        const z1 = edge + dir * 3.6;
        for (let l = -hw + 0.8; l < hw - 0.8; l += 1.2) {
          strip(B, r, Math.min(z0, z1), Math.max(z0, z1), l, l + 0.6, lift, ROAD.markWhite);
        }
      }
      const m0 = f0 + 4.5;
      const m1 = f1 - 4.5;
      if (m1 - m0 < 2) continue;
      if (r.kind === 'arterial') {
        strip(B, r, m0, m1, -0.35, -0.2, lift, ROAD.markYellow);
        strip(B, r, m0, m1, 0.2, 0.35, lift, ROAD.markYellow);
        for (const lane of [-hw / 2, hw / 2]) {
          for (let s = m0; s < m1 - 3; s += 9)
            strip(B, r, s, s + 3, lane - 0.075, lane + 0.075, lift, ROAD.markWhite);
        }
      } else {
        for (let s = m0; s < m1 - 3; s += 8)
          strip(B, r, s, s + 3, -0.075, 0.075, lift, ROAD.markWhite);
      }
      strip(B, r, m0, m1, hw - 0.55, hw - 0.4, lift, ROAD.markWhite);
      strip(B, r, m0, m1, -hw + 0.4, -hw + 0.55, lift, ROAD.markWhite);
    }
  }
  return B.build();
}

export function buildSidewalks(L: Layout): THREE.BufferGeometry {
  const B = new FlatBuilder();
  for (const block of L.blocks) {
    // The palace court is paved by palace.ts; block slabs would cover it.
    if (
      block.district === 'hillside' ||
      block.district === 'riverside' ||
      block.district === 'palace'
    )
      continue;
    const walk = SIDEWALK[block.district];
    if (walk === undefined || block.buildingIds.length === 0) continue;
    const rect = paveRect(
      block,
      block.buildingIds.map((id) => L.buildings[id]).filter((b): b is BuildingSpec => !!b),
      walk,
    );
    if (!rect) continue;
    slab(B, block, rect);
  }
  return B.build();
}

export function paveRect(
  block: Pick<Block, 'x' | 'z' | 'w' | 'd' | 'rotY'>,
  buildings: readonly Pick<BuildingSpec, 'x' | 'z' | 'w' | 'd' | 'rotY'>[],
  walk: number,
): { x0: number; x1: number; z0: number; z1: number } | null {
  if (buildings.length === 0) return null;
  let x0 = -block.w / 2;
  let x1 = block.w / 2;
  let z0 = -block.d / 2;
  let z1 = block.d / 2;
  for (const b of buildings) {
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const c = Math.cos(b.rotY);
      const s = Math.sin(b.rotY);
      const lx = (sx * b.w) / 2;
      const lz = (sz * b.d) / 2;
      const wx = b.x + c * lx + s * lz;
      const wz = b.z - s * lx + c * lz;
      const p = toLocal(wx - block.x, wz - block.z, block.rotY);
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
  }
  const r = { x0: x0 - walk, x1: x1 + walk, z0: z0 - walk, z1: z1 + walk };
  return r.x1 - r.x0 > 1 && r.z1 - r.z0 > 1 ? r : null;
}

function slab(
  B: FlatBuilder,
  block: Block,
  r: { x0: number; x1: number; z0: number; z1: number },
): void {
  const c = Math.cos(block.rotY);
  const s = Math.sin(block.rotY);
  const wx = (lx: number, lz: number): number => block.x + c * lx + s * lz;
  const wz = (lx: number, lz: number): number => block.z - s * lx + c * lz;
  const corners: [number, number][] = [
    [r.x0, r.z1],
    [r.x1, r.z1],
    [r.x1, r.z0],
    [r.x0, r.z0],
  ];
  let up = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i] as [number, number];
    const [bx, bz] = corners[(i + 1) % 4] as [number, number];
    up = Math.max(up, maxTerrainAlong(wx(ax, az), wz(ax, az), wx(bx, bz), wz(bx, bz)));
  }
  up = Math.max(up, terrainHeight(block.x, block.z));
  // Flat ground keeps one quad. On a mountain foot the slab is a grid whose columns and rows break
  // only where some row or column of ground samples bends, so it has no T-junction cracks.
  const ground = up > 0 ? (x: number, z: number): number => terrainHeight(x, z) : (): number => 0;
  const nx = up > 0 ? Math.max(1, Math.ceil((r.x1 - r.x0) / SLAB_STEP)) : 1;
  const nz = up > 0 ? Math.max(1, Math.ceil((r.z1 - r.z0) / SLAB_STEP)) : 1;
  const lxAt = (i: number): number => r.x0 + ((r.x1 - r.x0) * i) / nx;
  const lzAt = (k: number): number => r.z0 + ((r.z1 - r.z0) * k) / nz;
  const H: number[][] = [];
  for (let k = 0; k <= nz; k++) {
    const row: number[] = [];
    for (let i = 0; i <= nx; i++) {
      const lx = lxAt(i);
      const lz = lzAt(k);
      row.push(ground(wx(lx, lz), wz(lx, lz)));
    }
    H.push(row);
  }
  const xs = new Set<number>();
  const zs = new Set<number>();
  for (const row of H) for (const i of terrainBreaks(row)) xs.add(i);
  for (let i = 0; i <= nx; i++)
    for (const k of terrainBreaks(H.map((row) => row[i] as number))) zs.add(k);
  const xi = [...xs].sort((a, b) => a - b);
  const zi = [...zs].sort((a, b) => a - b);
  const y = SIDEWALK_H;
  const V = (i: number, k: number, dy: number): [number, number, number] => {
    const lx = lxAt(i);
    const lz = lzAt(k);
    return [wx(lx, lz), ((H[k] as number[])[i] as number) + dy, wz(lx, lz)];
  };
  for (let a = 1; a < xi.length; a++) {
    for (let b = 1; b < zi.length; b++) {
      const i0 = xi[a - 1] as number;
      const i1 = xi[a] as number;
      const k0 = zi[b - 1] as number;
      const k1 = zi[b] as number;
      B.quad([V(i0, k1, y), V(i1, k1, y), V(i1, k0, y), V(i0, k0, y)], ROAD.pavement);
    }
  }
  // Curbs along the four edges, broken where the top surface is.
  const edges: { pts: [number, number][]; n: [number, number] }[] = [
    { pts: xi.map((i) => [i, nz]), n: [0, 1] },
    { pts: [...zi].reverse().map((k) => [nx, k]), n: [1, 0] },
    { pts: [...xi].reverse().map((i) => [i, 0]), n: [0, -1] },
    { pts: zi.map((k) => [0, k]), n: [-1, 0] },
  ];
  for (const e of edges) {
    const n: [number, number, number] = [c * e.n[0] + s * e.n[1], 0, -s * e.n[0] + c * e.n[1]];
    for (let j = 1; j < e.pts.length; j++) {
      const [ia, ka] = e.pts[j - 1] as [number, number];
      const [ib, kb] = e.pts[j] as [number, number];
      B.quad([V(ia, ka, 0), V(ib, kb, 0), V(ib, kb, y), V(ia, ka, y)], ROAD.curb, n);
    }
  }
}

// Lattice indices wrap with `period`; each octave must span a whole number of periods per tile
// or the 32 m / 3 m texture repeat shows seams.
function periodicNoise(grid: Float32Array, x: number, y: number, period: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const wrap = (i: number): number => (((i % period) + period) % period) & 255;
  const x0 = wrap(xi);
  const x1 = wrap(xi + 1);
  const r0 = wrap(yi) * 256;
  const r1 = wrap(yi + 1) * 256;
  const g00 = grid[r0 + x0] ?? 0;
  const g10 = grid[r0 + x1] ?? 0;
  const g01 = grid[r1 + x0] ?? 0;
  const g11 = grid[r1 + x1] ?? 0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = g00 + (g10 - g00) * sx;
  const b = g01 + (g11 - g01) * sx;
  return a + (b - a) * sy;
}

export function puddleData(seed: number, N: number): Uint8Array {
  const rng = createRng(seed);
  const grid = Float32Array.from({ length: 256 * 256 }, () => rng.next());
  const data = new Uint8Array(N * N * 4);
  const octaves: [number, number][] = [
    [12, 0.45],
    [24, 0.27],
    [48, 0.17],
    [96, 0.11],
  ];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let n = 0;
      for (const [f, w] of octaves) n += periodicNoise(grid, (x / N) * f, (y / N) * f, f) * w;
      const p = Math.min(1, Math.max(0, (n - 0.6) / 0.05));
      const grain =
        periodicNoise(grid, (x / N) * 128, (y / N) * 128, 128) * 0.5 +
        periodicNoise(grid, (x / N) * 256 + 17, (y / N) * 256 + 31, 256) * 0.5;
      const k = (y * N + x) * 4;
      data[k] = Math.round(p * 255);
      data[k + 1] = Math.round(grain * 255);
      data[k + 2] = 0;
      data[k + 3] = 255;
    }
  }
  return data;
}

/** 512² keeps the build cost down and still gives 16 px/m. */
export const PUDDLE_SIZE = 512;

/** `data` is puddleData(seed, PUDDLE_SIZE) when the city worker already made it. */
export function puddleTexture(
  seed = 2077,
  data = puddleData(seed, PUDDLE_SIZE),
): THREE.DataTexture {
  const N = PUDDLE_SIZE;
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export interface WetUniforms {
  uWet: { value: number };
  uPuddle: { value: THREE.Texture };
}

export function createWetMaterial(
  name: string,
  puddle: THREE.Texture,
  wet: WetUniforms['uWet'],
  dryRough: number,
): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: dryRough,
    metalness: 0,
  });
  m.name = name;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = wet;
    shader.uniforms.uPuddle = { value: puddle };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWXZ = (modelMatrix * vec4(transformed, 1.0)).xz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vWXZ;\nuniform float uWet;\nuniform sampler2D uPuddle;\nfloat wPud; float wGrain;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Puddle mask averaged along the view direction: puddles stretch toward the camera like
        // real wet-road reflections and their edges soften instead of reading as paint blots.
        vec2 toCam = cameraPosition.xz - vWXZ;
        vec2 vdir = toCam / max(length(toCam), 1e-3);
        float pm = 0.0;
        for (int k = -2; k <= 2; k++) pm += texture2D(uPuddle, (vWXZ + vdir * float(k) * 0.9) / 32.0).r;
        wPud = smoothstep(0.2, 0.85, pm / 5.0) * smoothstep(0.15, 0.6, uWet);
        wGrain = texture2D(uPuddle, vWXZ / 3.0).g;
        diffuseColor.rgb *= (0.85 + 0.3 * wGrain) * mix(1.0, 0.45, wPud);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float dryR = ${dryRough.toFixed(2)} + 0.15 * (wGrain - 0.5);
        float wetR = mix(dryR * 0.75, 0.1, wPud);
        roughnessFactor = mix(dryR, wetR, uWet);`,
      )
      // Puddles act as dark mirrors (ART_DIRECTION 6.1): lift only the image-based specular there,
      // half desaturated so the environment's colour panels read as reflections, not paint.
      .replace(
        '#include <lights_fragment_maps>',
        `#include <lights_fragment_maps>
        float rLum = dot(radiance, vec3(0.299, 0.587, 0.114));
        radiance = mix(radiance, mix(vec3(rLum), radiance, 0.5), wPud);
        radiance *= 1.0 + ${PUDDLE_REFLECTION.toFixed(2)} * wPud * uWet;`,
      );
  };
  m.customProgramCacheKey = () => `hangang-wet-v3-${name}`;
  return m;
}
