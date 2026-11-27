import * as THREE from 'three';
import { LAYOUT, MOUNTAIN_RANGES, RIVER, isForest, terrainHeight, type Vec2 } from '../city/layout';
import { TERRAIN_COLORS as TC } from '../core/palette';
import {
  groundRadius,
  MAP_HALF_X,
  MAP_HALF_Z,
  SIDE_REACH,
  SIDE_STRIPS,
  channelDistance,
  channelProfile,
  bankReach,
  centroid,
  grow,
  channelParkWidth,
  channelRows,
  channelSlices,
  groundAxes,
  groundVertex,
  groundWaterDistance,
  inPolygon,
  islandMoats,
  noise2,
  sideDistance,
  sideProfile,
  sideSlices,
  sideStripDistance,
  type ChannelPart,
  type ChannelSlices,
  type ProfilePoint,
} from './shape';

// Cells dropped here must stay within bankReach(), or gaps open along the banks.
const KEEP_DISTANCE = 6;
/** Largest cell edge on the in-map mountains (m); the base grid is split until it is below. */
export const MOUNTAIN_CELL = 8;

const c = (hex: number): THREE.Color => new THREE.Color().setHex(hex);

export function groundPalette(): Record<
  'urban' | 'hill' | 'wood' | 'forest' | 'rock' | ChannelPart,
  THREE.Color
> {
  return {
    urban: c(TC.groundUrban),
    rock: c(TC.groundRock),
    forest: c(TC.groundForest),
    bank: c(TC.groundUrban),
    hill: c(TC.groundHill),
    wood: c(TC.groundWood),
    park: c(TC.park),
    embankment: c(TC.embankment),
    parkEdge: c(TC.parkEdge),
  };
}

type Palette = ReturnType<typeof groundPalette>;

// Mountains read as dark forest: canopy mottling at a few metres, lighter only on the bare
// crests and spurs that catch the moon.
function groundColor(
  x: number,
  y: number,
  z: number,
  canopy: number,
  pal: Palette,
  out: THREE.Color,
): void {
  const hill = Math.min(1, y / 25);
  const outside = Math.min(
    1,
    Math.max(0, Math.max(Math.abs(x) - MAP_HALF_X, Math.abs(z) - MAP_HALF_Z) / 200),
  );
  const n = noise2(x / 90, z / 90) * 0.65 + noise2(x / 23, z / 23) * 0.35;
  const forest = forestAt(y);
  const wood = Math.max(outside, forest, hill * Math.min(1, Math.max(0, (n - 0.45) * 4)));
  out.copy(pal.urban).lerp(pal.hill, hill).lerp(pal.wood, wood).lerp(pal.forest, forest);
  // Crowns (high canopy) lighter, the gaps between stands darker.
  out.multiplyScalar((0.85 + 0.3 * n) * (1 - forest * 0.45 + forest * 0.9 * canopy));
}

/** Forest weight of ground at height y: 0 on the plain and low foothills, 1 from 24 m up. */
const FOREST_START = 4;

function forestAt(y: number): number {
  return Math.min(1, Math.max(0, (y - FOREST_START) / 20));
}

/** Height of tree crowns over forest ground (m); visual only, never negative. */
const CANOPY = 2.5;
/** Radius of the level summit kept around 남산's mast (m). */
const SUMMIT_FLAT = 50;
/** Cell of the baked forest mask (m). */
const FOREST_CELL = 16;

/** Clearance kept free of canopy around every building footprint (m). */
const BUILDING_CLEAR = 8;

/**
 * layout's isForest baked once on a FOREST_CELL grid over each mountain and read bilinearly (the
 * query costs ~20 µs, too much for every vertex). A node counts as forest only off every building
 * footprint (plus BUILDING_CLEAR), so a lift reaching half a cell past the forest edge never
 * buries a hillside house. Nodes below forestAt's start are skipped: no canopy there anyway.
 */
export function forestMask(): (x: number, z: number) => number {
  const BUCKET = 32;
  const near = new Map<string, { x: number; z: number; r: number }[]>();
  for (const bld of LAYOUT.buildings) {
    const r = Math.hypot(bld.w, bld.d) / 2 + BUILDING_CLEAR;
    const bx = Math.floor(bld.x / BUCKET);
    const bz = Math.floor(bld.z / BUCKET);
    const key = `${bx},${bz}`;
    const list = near.get(key) ?? [];
    list.push({ x: bld.x, z: bld.z, r });
    near.set(key, list);
  }
  const reach = Math.ceil(
    (Math.max(0, ...LAYOUT.buildings.map((b) => Math.hypot(b.w, b.d) / 2)) + BUILDING_CLEAR) /
      BUCKET,
  );
  const onBuilding = (x: number, z: number): boolean => {
    const bx = Math.floor(x / BUCKET);
    const bz = Math.floor(z / BUCKET);
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        for (const q of near.get(`${bx + dx},${bz + dz}`) ?? []) {
          if (Math.hypot(x - q.x, z - q.z) < q.r) return true;
        }
      }
    }
    return false;
  };
  // One grid per mountain range box: ranges that join (북악 and 인왕) are baked once.
  const grids = MOUNTAIN_RANGES.map((r) => {
    const x0 = r.x0;
    const z0 = r.z0;
    const nx = Math.ceil((r.x1 - r.x0) / FOREST_CELL) + 1;
    const nz = Math.ceil((r.z1 - r.z0) / FOREST_CELL) + 1;
    const v = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * FOREST_CELL;
        const z = z0 + j * FOREST_CELL;
        if (terrainHeight(x, z) <= FOREST_START) continue;
        v[j * nx + i] = isForest(x, z) && !onBuilding(x, z) ? 1 : 0;
      }
    }
    return { x0, z0, nx, nz, v };
  });
  return (x, z) => {
    let best = 0;
    for (const g of grids) {
      const u = (x - g.x0) / FOREST_CELL;
      const w = (z - g.z0) / FOREST_CELL;
      if (u < 0 || w < 0 || u >= g.nx - 1 || w >= g.nz - 1) continue;
      const i = Math.floor(u);
      const j = Math.floor(w);
      const fu = u - i;
      const fw = w - j;
      const at = (a: number, b: number): number => g.v[(j + b) * g.nx + i + a] ?? 0;
      const top = at(0, 0) + (at(1, 0) - at(0, 0)) * fu;
      const bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * fu;
      best = Math.max(best, top + (bottom - top) * fw);
    }
    return best;
  };
}

/** 남산's mast (buildings) stands on a level summit: no canopy within SUMMIT_FLAT of it. */
function mastAt(): Vec2 | null {
  const l = LAYOUT.landmarks.find((m) => m.id === 'namsan-mast');
  const n = LAYOUT.mountains.find((m) => m.id === 'namsan');
  return l ? { x: l.x, z: l.z } : n ? { x: n.peak.x, z: n.peak.z } : null;
}

// Only ever raises the ground, so a tree placed on surfaceHeight sinks a little rather than
// floats, and only where the layout keeps forest: the mask must be over 0.5 (inside the baked
// forest edge), so hillside houses below the forest line stand on bare ground.
function canopyLift(
  x: number,
  y: number,
  z: number,
  canopy: number,
  mask: (x: number, z: number) => number,
  mast: Vec2 | null,
): number {
  const f = forestAt(y);
  if (f <= 0) return 0;
  const inside = Math.min(1, Math.max(0, (mask(x, z) - 0.5) * 2));
  if (inside <= 0) return 0;
  const keep = mast
    ? Math.min(1, Math.max(0, (Math.hypot(x - mast.x, z - mast.z) - SUMMIT_FLAT) / 20))
    : 1;
  return CANOPY * f * inside * keep * canopy;
}

/** A cell is split once one corner rises this far (m); flat ground inside a radius stays coarse. */
const MOUNTAIN_RISE = 2;

/** Inside a mountain range box and risen more than MOUNTAIN_RISE (terrainHeight is their max). */
function raised(x: number, z: number): boolean {
  for (const r of MOUNTAIN_RANGES) {
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1)
      return terrainHeight(x, z) > MOUNTAIN_RISE;
  }
  return false;
}

export function buildGround(): THREE.BufferGeometry {
  const { xs, zs } = groundAxes();
  const nx = xs.length;
  const nz = zs.length;
  const pal = groundPalette();
  const pos: number[] = [];
  const col: number[] = [];
  const dist: number[] = [];
  /** Height before the canopy lift: the valley shading follows the terrain, not the crowns. */
  const bare: number[] = [];
  const rim: number[] = [];
  const tmp = new THREE.Color();
  const mask = forestMask();
  const mast = mastAt();
  const vertex = (x: number, z: number): number => {
    const v = groundVertex(x, z);
    const stands = v.y > 4 ? noise2(v.x / 14 + 31, v.z / 14 + 7) : 0;
    const canopy = v.y > 4 ? stands * 0.7 + noise2(v.x / 5 + 3, v.z / 5 + 11) * 0.3 : 0;
    groundColor(x, v.y, z, canopy, pal, tmp);
    // The lift follows the stand-scale term only: the 5 m term on 8 m cells tilts steep slopes.
    pos.push(v.x, v.y + canopyLift(v.x, v.y, v.z, stands, mask, mast), v.z);
    col.push(tmp.r, tmp.g, tmp.b);
    dist.push(groundWaterDistance(v.x, v.z));
    bare.push(v.y);
    rim.push(Math.hypot(x, z) > groundRadius() ? 1 : 0);
    return dist.length - 1;
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) vertex(xs[i] ?? 0, zs[j] ?? 0);
  }
  const idx: number[] = [];
  const quad = (a: number, b: number, d: number, e: number): void => {
    const near = Math.min(dist[a] ?? 0, dist[b] ?? 0, dist[d] ?? 0, dist[e] ?? 0);
    if (near < KEEP_DISTANCE) return;
    if ((rim[a] ?? 0) + (rim[b] ?? 0) + (rim[d] ?? 0) + (rim[e] ?? 0) === 4) return;
    idx.push(a, d, b, b, d, e);
  };
  // Which base cells split into MOUNTAIN_CELL cells: decided for all first, so a shared edge
  // knows both sides. Sampled at corners, centre and edge midpoints so a small rise between
  // corners still splits.
  const cw = nx - 1;
  const split = new Uint8Array(cw * (nz - 1));
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < cw; i++) {
      const x0 = xs[i] ?? 0;
      const x1 = xs[i + 1] ?? 0;
      const z0 = zs[j] ?? 0;
      const z1 = zs[j + 1] ?? 0;
      let hit = false;
      for (const fx of [0, 0.5, 1]) {
        for (const fz of [0, 0.5, 1]) {
          if (!hit && raised(x0 + (x1 - x0) * fx, z0 + (z1 - z0) * fz)) hit = true;
        }
      }
      split[j * cw + i] = hit ? 1 : 0;
    }
  }
  const isSplit = (i: number, j: number): boolean =>
    i >= 0 && j >= 0 && i < cw && j < nz - 1 && split[j * cw + i] === 1;
  // On an edge shared with an unsplit cell the extra vertex sits on the straight line between the
  // two corners, so the coarse quad's edge and the fine ones coincide: no cracks.
  const between = (k0: number, k1: number, t: number): number => {
    for (let c = 0; c < 3; c++) {
      const p0 = pos[k0 * 3 + c] ?? 0;
      const c0 = col[k0 * 3 + c] ?? 0;
      pos.push(p0 + ((pos[k1 * 3 + c] ?? 0) - p0) * t);
      col.push(c0 + ((col[k1 * 3 + c] ?? 0) - c0) * t);
    }
    const b0 = bare[k0] ?? 0;
    bare.push(b0 + ((bare[k1] ?? 0) - b0) * t);
    const d0 = dist[k0] ?? 0;
    dist.push(d0 + ((dist[k1] ?? 0) - d0) * t);
    rim.push(Math.max(rim[k0] ?? 0, rim[k1] ?? 0));
    return dist.length - 1;
  };
  // Fine vertices on a base cell edge are shared with the neighbouring cell through this key:
  // (i, a, j, b) with a and b normalised onto the lower cell so both sides agree.
  const fine = new Map<string, number>();
  const fineVertex = (
    i: number,
    a: number,
    sx: number,
    j: number,
    b: number,
    sz: number,
  ): number => {
    if (a === sx) {
      i++;
      a = 0;
    }
    if (b === sz) {
      j++;
      b = 0;
    }
    if (a === 0 && b === 0) return j * nx + i;
    const key =
      a === 0 ? `x${i},${j},${b}/${sz}` : b === 0 ? `z${i},${a}/${sx},${j}` : `${i},${j},${a},${b}`;
    const hit = fine.get(key);
    if (hit !== undefined) return hit;
    let k: number;
    if (a === 0 && !(isSplit(i - 1, j) && isSplit(i, j))) {
      k = between(j * nx + i, (j + 1) * nx + i, b / sz);
    } else if (b === 0 && !(isSplit(i, j - 1) && isSplit(i, j))) {
      k = between(j * nx + i, j * nx + i + 1, a / sx);
    } else {
      const x0 = xs[i] ?? 0;
      const z0 = zs[j] ?? 0;
      k = vertex(
        x0 + (((xs[i + 1] ?? x0) - x0) * a) / sx,
        z0 + (((zs[j + 1] ?? z0) - z0) * b) / sz,
      );
    }
    fine.set(key, k);
    return k;
  };
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < cw; i++) {
      const a = j * nx + i;
      if (!isSplit(i, j)) {
        quad(a, a + 1, a + nx, a + nx + 1);
        continue;
      }
      const x0 = xs[i] ?? 0;
      const z0 = zs[j] ?? 0;
      const sx = Math.ceil(((xs[i + 1] ?? x0) - x0) / MOUNTAIN_CELL - 1e-6);
      const sz = Math.ceil(((zs[j + 1] ?? z0) - z0) / MOUNTAIN_CELL - 1e-6);
      for (let v = 0; v < sz; v++) {
        for (let u = 0; u < sx; u++) {
          quad(
            fineVertex(i, u, sx, j, v, sz),
            fineVertex(i, u + 1, sx, j, v, sz),
            fineVertex(i, u, sx, j, v + 1, sz),
            fineVertex(i, u + 1, sx, j, v + 1, sz),
          );
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  shadeValleys(g, bare);
  tintRock(g, pal);
  g.computeBoundingSphere();
  return g;
}

/** Neighbour-averaging rounds for the valley shading: about this many cells of reach. */
const VALLEY_ROUNDS = 6;
/** Darkening per metre a vertex sits below its smoothed neighbourhood (and lift above it). */
const VALLEY_GAIN = 0.12;

// Gullies and ridges the gentle height detail barely shows in the silhouette: a vertex below the
// average of its neighbourhood (smoothed over VALLEY_ROUNDS mesh rings) is in a valley and is
// darkened, one above it on a spur is lightened. One pass over the index per round, no extra
// height queries; only raised ground (forest) is touched.
export function shadeValleys(g: THREE.BufferGeometry, bare: ArrayLike<number>): void {
  const col = g.getAttribute('color');
  const index = g.getIndex();
  if (!index) return;
  const ix = index.array;
  const n = col.count;
  let h = Float32Array.from({ length: n }, (_, i) => bare[i] ?? 0);
  let next = new Float32Array(n);
  const sum = new Float32Array(n);
  const cnt = new Uint16Array(n);
  for (let round = 0; round < VALLEY_ROUNDS; round++) {
    sum.fill(0);
    cnt.fill(0);
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] ?? 0;
      const b = ix[t + 1] ?? 0;
      const c = ix[t + 2] ?? 0;
      const ha = h[a] ?? 0;
      const hb = h[b] ?? 0;
      const hc = h[c] ?? 0;
      sum[a] = (sum[a] ?? 0) + hb + hc;
      sum[b] = (sum[b] ?? 0) + ha + hc;
      sum[c] = (sum[c] ?? 0) + ha + hb;
      cnt[a] = (cnt[a] ?? 0) + 2;
      cnt[b] = (cnt[b] ?? 0) + 2;
      cnt[c] = (cnt[c] ?? 0) + 2;
    }
    for (let i = 0; i < n; i++) {
      const k = cnt[i] ?? 0;
      next[i] = k > 0 ? ((h[i] ?? 0) + (sum[i] ?? 0) / k) * 0.5 : (h[i] ?? 0);
    }
    [h, next] = [next, h];
  }
  for (let i = 0; i < n; i++) {
    const own = bare[i] ?? 0;
    const f = forestAt(own);
    if (f <= 0) continue;
    const k = valleyShade((h[i] ?? 0) - own, f);
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
}

/** Color factor for a vertex `below` m under its smoothed neighbourhood, forest weight f. */
export function valleyShade(below: number, f: number): number {
  return 1 - Math.min(0.35, Math.max(-0.25, below * VALLEY_GAIN)) * f;
}

// Steep forest ground (cliffs, crests, gully walls) shows bare rock, a touch lighter so ridge lines
// catch the moon while the wooded slopes stay a dark mass.
function tintRock(g: THREE.BufferGeometry, pal: Palette): void {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const col = g.getAttribute('color');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const f = forestAt(pos.getY(i));
    if (f <= 0) continue;
    const steep = Math.min(1, Math.max(0, (1 - nor.getY(i) - 0.12) / 0.2));
    if (steep <= 0) continue;
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(pal.rock, steep * f * 0.8);
    col.setXYZ(i, c.r, c.g, c.b);
  }
}

// Signed area in x-z of triangle (a, b, c) as wound for an up-facing face; 0 counts as up.
function facesUp(a: Vec2, b: Vec2, c: Vec2): boolean {
  return (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z) <= 1e-9;
}

interface StripOut {
  pos: number[];
  col: number[];
  idx: number[];
}

/**
 * Appends one bank strip (both sides) to `out`: `profiles[s]` across each slice, rows at those
 * depths from `channelRows`. Quads whose centre fails `keep` are left out.
 */
function appendStrip(
  out: StripOut,
  c: ChannelSlices,
  profiles: readonly (readonly ProfilePoint[])[],
  dist: (x: number, z: number) => number,
  /** Called with the quad's four corners; false leaves the quad out. */
  keep: (corners: readonly Vec2[]) => boolean,
  pal: Palette,
): void {
  const profLen = profiles[0]?.length ?? 0;
  const perSlice = profLen * 2;
  const base = out.pos.length / 3;
  const depths = Array.from({ length: profLen }, (_, j) => profiles.map((p) => p[j]?.d ?? 0));
  const rows = [...channelRows(c, depths, -1, dist), ...channelRows(c, depths, 1, dist)];
  for (let s = 0; s < c.slices.length; s++) {
    const profile = profiles[s] ?? [];
    for (let side = 0; side < 2; side++) {
      for (let j = 0; j < profLen; j++) {
        const p = profile[j];
        const q = rows[side * profLen + j]?.[s];
        if (!p || !q) throw new Error('terrain: channel row out of range');
        out.pos.push(q.x, p.y, q.z);
        const cc = pal[p.part];
        out.col.push(cc.r, cc.g, cc.b);
      }
    }
  }
  const at = (k: number): Vec2 => ({ x: out.pos[k * 3] ?? 0, z: out.pos[k * 3 + 2] ?? 0 });
  for (let s = 0; s < c.slices.length - 1; s++) {
    for (let side = 0; side < 2; side++) {
      for (let p = 0; p < profLen; p += 2) {
        const a = base + s * perSlice + side * profLen + p;
        const b = a + 1;
        const a2 = a + perSlice;
        const b2 = b + perSlice;
        const pa = at(a);
        if (!keep([pa, at(b), at(a2), at(b2)])) continue;
        // Where a bend is tighter than two rows deep both rows fold; the few quads left turned
        // over inside the fold are dropped rather than drawn upside down.
        if (side === 0 ? !facesUp(pa, at(b), at(a2)) : !facesUp(pa, at(a2), at(b))) continue;
        // Side -1 runs toward +south of the walking direction, so its winding is flipped to face up.
        if (side === 0) out.idx.push(a, b, a2, b, b2, a2);
        else out.idx.push(a, a2, b, b, a2, b2);
      }
    }
  }
}

// Island tops sit at their own height; a 45° stone skirt runs from the rim down below the water.
function appendIslands(out: StripOut, pal: Palette): void {
  const below = RIVER.waterY - 0.8;
  const marsh = pal.wood.clone().multiplyScalar(0.8);
  for (const isl of LAYOUT.islands) {
    if (isl.kind === 'land') continue;
    const top = isl.kind === 'marsh' ? marsh : isl.kind === 'park' ? pal.park : pal.urban;
    const skirt = isl.kind === 'marsh' ? marsh : pal.embankment;
    const rim = isl.polygon;
    const foot = grow(rim, Math.max(1, isl.y - below));
    const n = rim.length;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const a = rim[i] as Vec2;
      const b = rim[(i + 1) % n] as Vec2;
      area += a.x * b.z - b.x * a.z;
    }
    const flip = area > 0;
    const base = out.pos.length / 3;
    const mid = centroid(rim);
    out.pos.push(mid.x, isl.y, mid.z);
    out.col.push(top.r, top.g, top.b);
    for (const p of rim) {
      out.pos.push(p.x, isl.y, p.z);
      out.col.push(top.r, top.g, top.b);
    }
    for (let i = 0; i < n; i++) {
      const p = rim[i] as Vec2;
      const q = foot[i] as Vec2;
      out.pos.push(p.x, isl.y, p.z, q.x, below, q.z);
      out.col.push(skirt.r, skirt.g, skirt.b, skirt.r, skirt.g, skirt.b);
    }
    const ring = base + 1 + n;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = base + 1 + i;
      const b = base + 1 + j;
      if (flip) out.idx.push(base, b, a);
      else out.idx.push(base, a, b);
      const r0 = ring + i * 2;
      const r1 = ring + j * 2;
      if (flip) out.idx.push(r0, r1, r0 + 1, r1, r1 + 1, r0 + 1);
      else out.idx.push(r0, r0 + 1, r1, r1, r0 + 1, r1 + 1);
    }
  }
}

export function buildChannel(): THREE.BufferGeometry {
  const pal = groundPalette();
  const out: StripOut = { pos: [], col: [], idx: [] };
  const moats = islandMoats();
  const main = channelSlices();
  appendStrip(
    out,
    main,
    main.xs.map((x) => channelProfile(bankReach(x), channelParkWidth(x))),
    channelDistance,
    // The side channels' mouths and the island moats open the park to the water below: a quad
    // goes once any corner is in them, and the water runs on under it (SIDE_WATER_UNDER).
    (q) => q.every((p) => sideDistance(p.x, p.z) > 0 && !moats.some((m) => inPolygon(p.x, p.z, m))),
    pal,
  );
  SIDE_STRIPS.forEach((_, i) => {
    const c = sideSlices(i);
    appendStrip(
      out,
      c,
      c.slices.map(() => sideProfile(SIDE_REACH)),
      (x, z) => sideStripDistance(i, x, z),
      // Inside the main channel the main strip and water take over.
      (q) => {
        const cx = q.reduce((t, p) => t + p.x, 0) / q.length;
        const cz = q.reduce((t, p) => t + p.z, 0) / q.length;
        return channelDistance(cx, cz) > 0;
      },
      pal,
    );
  });
  appendIslands(out, pal);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(out.col, 3));
  g.setIndex(out.idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
