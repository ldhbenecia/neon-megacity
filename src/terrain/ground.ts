import * as THREE from 'three';
import { TERRAIN_COLORS as TC } from '../core/palette';
import {
  GROUND_RADIUS,
  MAP_HALF_X,
  MAP_HALF_Z,
  channelDistance,
  channelProfile,
  bankReach,
  channelParkWidth,
  channelRows,
  channelSlices,
  groundAxes,
  groundVertex,
  noise2,
  type ChannelPart,
} from './shape';

// Cells dropped here must stay within bankReach(), or gaps open along the banks.
const KEEP_DISTANCE = 6;

const c = (hex: number): THREE.Color => new THREE.Color().setHex(hex);

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
  const rim = new Uint8Array(nx * nz);
  const tmp = new THREE.Color();
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
      const hill = Math.min(1, y / 25);
      const outside = Math.min(
        1,
        Math.max(0, Math.max(Math.abs(x) - MAP_HALF_X, Math.abs(z) - MAP_HALF_Z) / 200),
      );
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

export function buildChannel(): THREE.BufferGeometry {
  const pal = groundPalette();
  const c = channelSlices();
  const { xs } = c;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const profiles = xs.map((x) => channelProfile(bankReach(x), channelParkWidth(x)));
  const profLen = channelProfile(0).length;
  const perSlice = profLen * 2;
  const depths = Array.from({ length: profLen }, (_, j) => profiles.map((p) => p[j]?.d ?? 0));
  const rows = [...channelRows(c, depths, -1), ...channelRows(c, depths, 1)];
  for (let s = 0; s < xs.length; s++) {
    const profile = profiles[s] ?? [];
    for (let side = 0; side < 2; side++) {
      for (let j = 0; j < profLen; j++) {
        const p = profile[j];
        const q = rows[side * profLen + j]?.[s];
        if (!p || !q) throw new Error('terrain: channel row out of range');
        pos.push(q.x, p.y, q.z);
        const cc = pal[p.part];
        col.push(cc.r, cc.g, cc.b);
      }
    }
  }
  for (let s = 0; s < xs.length - 1; s++) {
    for (let side = 0; side < 2; side++) {
      for (let p = 0; p < profLen; p += 2) {
        const a = s * perSlice + side * profLen + p;
        const b = a + 1;
        const a2 = a + perSlice;
        const b2 = b + perSlice;
        // The north side runs toward +Z, so its winding is flipped to face up.
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
