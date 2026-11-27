import * as THREE from 'three';
import { FOREST_LINE, LAYOUT, RIVER, isForest, type Vec2 } from '../city/layout';
import { TERRAIN_COLORS as TC } from '../core/palette';
import {
  GROUND_RADIUS,
  MAP_HALF_X,
  MAP_HALF_Z,
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
/** Reach of a side channel's bank strip beyond its water edge (m). */
const SIDE_REACH = 20;

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
function groundColor(x: number, y: number, z: number, pal: Palette, out: THREE.Color): void {
  const hill = Math.min(1, y / 25);
  const outside = Math.min(
    1,
    Math.max(0, Math.max(Math.abs(x) - MAP_HALF_X, Math.abs(z) - MAP_HALF_Z) / 200),
  );
  const n = noise2(x / 90, z / 90) * 0.65 + noise2(x / 23, z / 23) * 0.35;
  const forest = forestAt(y);
  const wood = Math.max(outside, forest, hill * Math.min(1, Math.max(0, (n - 0.45) * 4)));
  out.copy(pal.urban).lerp(pal.hill, hill).lerp(pal.wood, wood).lerp(pal.forest, forest);
  const canopy = noise2(x / 14 + 31, z / 14 + 7) * 0.7 + noise2(x / 5 + 3, z / 5 + 11) * 0.3;
  // Crowns (high canopy) lighter, the gaps between stands darker.
  out.multiplyScalar((0.85 + 0.3 * n) * (1 - forest * 0.45 + forest * 0.9 * canopy));
}

/** Forest weight of ground at height y: 0 on the plain and low foothills, 1 from 24 m up. */
function forestAt(y: number): number {
  return Math.min(1, Math.max(0, (y - 4) / 20));
}

/** Height of tree crowns over forest ground (m); visual only, never negative. */
const CANOPY = 2.5;
/** 남산's summit stays level for the transmission tower (buildings): no canopy within this. */
const SUMMIT_FLAT = 50;

// Crowns clump at a stand scale the 8 m mountain cells resolve. Only ever raises the ground, so a
// tree placed on surfaceHeight sinks a little rather than floats.
function canopyLift(x: number, y: number, z: number): number {
  const f = forestAt(y);
  // Only where the layout keeps forest: hillside houses below the forest line stand on bare ground.
  // Above FOREST_LINE it is forest by definition, which spares most of the costly isForest calls.
  if (f <= 0 || !(aboveForestLine(x, y, z) || isForest(x, z))) return 0;
  let keep = 1;
  for (const m of LAYOUT.mountains) {
    if (m.id !== 'namsan') continue;
    const d = Math.hypot(x - m.peak.x, z - m.peak.z);
    keep = Math.min(keep, Math.min(1, Math.max(0, (d - SUMMIT_FLAT) / 20)));
  }
  const n = noise2(x / 14 + 31, z / 14 + 7) * 0.7 + noise2(x / 5 + 3, z / 5 + 11) * 0.3;
  return CANOPY * f * keep * n;
}

function aboveForestLine(x: number, y: number, z: number): boolean {
  for (const m of LAYOUT.mountains) {
    if (Math.hypot(x - m.peak.x, z - m.peak.z) < m.radius && y > FOREST_LINE * m.height)
      return true;
  }
  return false;
}

function nearMountain(x: number, z: number): boolean {
  for (const m of LAYOUT.mountains) {
    if (Math.hypot(x - m.peak.x, z - m.peak.z) < m.radius) return true;
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
  const rim: number[] = [];
  const tmp = new THREE.Color();
  const vertex = (x: number, z: number): number => {
    const v = groundVertex(x, z);
    groundColor(x, v.y, z, pal, tmp);
    pos.push(v.x, v.y + canopyLift(v.x, v.y, v.z), v.z);
    col.push(tmp.r, tmp.g, tmp.b);
    dist.push(groundWaterDistance(v.x, v.z));
    rim.push(Math.hypot(x, z) > GROUND_RADIUS ? 1 : 0);
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
  // Fine vertices inside one base cell edge are shared with the neighbouring cell through this
  // key: (i, a, j, b) with a and b normalised onto the lower cell so both sides agree.
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
    const x0 = xs[i] ?? 0;
    const z0 = zs[j] ?? 0;
    const x = x0 + (((xs[i + 1] ?? x0) - x0) * a) / sx;
    const z = z0 + (((zs[j + 1] ?? z0) - z0) * b) / sz;
    const k = vertex(x, z);
    fine.set(key, k);
    return k;
  };
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const x0 = xs[i] ?? 0;
      const x1 = xs[i + 1] ?? 0;
      const z0 = zs[j] ?? 0;
      const z1 = zs[j + 1] ?? 0;
      const mountain =
        nearMountain(x0, z0) ||
        nearMountain(x1, z0) ||
        nearMountain(x0, z1) ||
        nearMountain(x1, z1);
      if (!mountain) {
        quad(a, a + 1, a + nx, a + nx + 1);
        continue;
      }
      const sx = Math.ceil((x1 - x0) / MOUNTAIN_CELL - 1e-6);
      const sz = Math.ceil((z1 - z0) / MOUNTAIN_CELL - 1e-6);
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
  tintRock(g, pal);
  g.computeBoundingSphere();
  return g;
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
  keep: (x: number, z: number) => boolean,
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
        const pb2 = at(b2);
        if (!keep((pa.x + pb2.x) / 2, (pa.z + pb2.z) / 2)) continue;
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
    // The side channels' mouths and the island moats open the park to the water below.
    (x, z) => sideDistance(x, z) > 0 && !moats.some((m) => inPolygon(x, z, m)),
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
      (x, z) => channelDistance(x, z) > 0,
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
