// Ground heightfield and the 흑린강 channel (bank strip, embankment, park, stone edge).
// The ground is one rectilinear grid (12 m in the hills, 24 m over flat districts, growing to
// ~200 m past the map edge) sampled from `terrainHeight`; cells touching the channel are dropped
// and the channel is a separate strip that follows the centerline, so the 4 m embankment slope
// stays crisp without a fine grid everywhere.
import * as THREE from 'three';
import { CITY, RIVER, riverFrame } from '../city/layout';
import { TERRAIN_COLORS as TC } from '../core/palette';
import {
  GROUND_RADIUS,
  channelDistance,
  channelProfile,
  groundAxes,
  groundVertex,
  noise2,
  riverSliceXs,
  type ChannelPart,
} from './shape';

/** Cells with any corner closer than this to the embankment (m) are left to the channel strip. */
const KEEP_DISTANCE = 6;

const c = (hex: number): THREE.Color => new THREE.Color().setHex(hex);

/** Ground albedos (palette TERRAIN_COLORS) by surface kind. */
export function groundPalette(): Record<'urban' | 'hill' | 'wood' | ChannelPart, THREE.Color> {
  return {
    urban: c(TC.groundUrban),
    bank: c(TC.groundUrban),
    hill: c(TC.groundHill),
    wood: c(TC.groundWood),
    park: c(TC.park),
    embankment: c(TC.embankment),
    parkEdge: c(TC.parkEdge),
  };
}

export function buildGround(): THREE.BufferGeometry {
  const { xs, zs } = groundAxes();
  const nx = xs.length;
  const nz = zs.length;
  const pal = groundPalette();
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const dist = new Float32Array(nx * nz);
  /** Vertex lies past the ground disc (pulled onto its rim). */
  const rim = new Uint8Array(nx * nz);
  const tmp = new THREE.Color();
  const half = CITY.half;
  for (let j = 0; j < nz; j++) {
    const z = zs[j] ?? 0;
    for (let i = 0; i < nx; i++) {
      const x = xs[i] ?? 0;
      const k = j * nx + i;
      const v = groundVertex(x, z);
      rim[k] = Math.hypot(x, z) > GROUND_RADIUS ? 1 : 0;
      const y = v.y;
      pos.set([v.x, y, v.z], k * 3);
      dist[k] = channelDistance(v.x, v.z);
      // Albedo: urban grey on the flats, scrub on the slopes, woods in noisy patches and
      // everywhere past the map edge.
      const hill = Math.min(1, y / 25);
      const outside = Math.min(1, Math.max(0, (Math.max(Math.abs(x), Math.abs(z)) - half) / 200));
      const n = noise2(x / 90, z / 90) * 0.65 + noise2(x / 23, z / 23) * 0.35;
      const wood = Math.max(outside, hill * Math.min(1, Math.max(0, (n - 0.45) * 4)));
      tmp.copy(pal.urban).lerp(pal.hill, hill).lerp(pal.wood, wood);
      tmp.multiplyScalar(0.85 + 0.3 * n);
      col.set([tmp.r, tmp.g, tmp.b], k * 3);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const d = a + nx;
      const e = d + 1;
      const near = Math.min(dist[a] ?? 0, dist[b] ?? 0, dist[d] ?? 0, dist[e] ?? 0);
      if (near < KEEP_DISTANCE) continue;
      // Fully outside the disc: all four corners collapsed onto the rim, nothing to draw.
      if ((rim[a] ?? 0) + (rim[b] ?? 0) + (rim[d] ?? 0) + (rim[e] ?? 0) === 4) continue;
      idx.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** How far the bank strip reaches over the ground: wider where the ground cells are coarse. */
function bankReach(x: number): number {
  const t = Math.min(1, Math.max(0, (Math.abs(x) - (CITY.half + 40)) / 300));
  return 40 + 40 * t * t * (3 - 2 * t);
}

/** Channel strip along the river: both banks, embankments, parks and the stone edges. */
export function buildChannel(): THREE.BufferGeometry {
  const pal = groundPalette();
  const halfW = RIVER.width / 2;
  const xs = riverSliceXs(8, 20);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const perSlice = channelProfile(0).length * 2;
  for (const x of xs) {
    const f = riverFrame(x);
    const profile = channelProfile(bankReach(x));
    for (const side of [-1, 1] as const) {
      for (const p of profile) {
        const off = (halfW + p.d) * side;
        pos.push(f.p.x + f.south.x * off, p.y, f.p.z + f.south.z * off);
        const cc = pal[p.part];
        col.push(cc.r, cc.g, cc.b);
      }
    }
  }
  const profLen = perSlice / 2;
  for (let s = 0; s < xs.length - 1; s++) {
    for (let side = 0; side < 2; side++) {
      for (let p = 0; p < profLen; p += 2) {
        const a = s * perSlice + side * profLen + p;
        const b = a + 1;
        const a2 = a + perSlice;
        const b2 = b + perSlice;
        // North side (side 0) runs outward→inward toward +Z; flip so both sides face up.
        if (side === 0) idx.push(a, b, a2, b, b2, a2);
        else idx.push(a, a2, b, b, a2, b2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
