import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CITY,
  EMBANK_SLOPE as LAYOUT_EMBANK_SLOPE,
  LAYOUT,
  RIVER,
  riverFrame,
  riverSignedDistance,
  ridgeHeight,
  surfaceHeight,
} from '../src/city/layout';
import {
  EMBANK_SLOPE,
  GROUND_RADIUS,
  OUTER_EXTENT,
  MAP_HALF_X,
  MAP_HALF_Z,
  channelDistance,
  channelHalfWidth,
  channelProfile,
  gridAxis,
  groundAxes,
  noise2,
  ridgePeaks,
  ridgeProfile,
  riverSliceXs,
  channelParkWidth,
  waterEdgeD,
  channelSlices,
  isoRow,
  type StripSlice,
} from '../src/terrain/shape';
import { buildChannel, buildGround } from '../src/terrain/ground';
import { createWater } from '../src/terrain/water';

function profileY(d: number, park: number): number {
  const p = channelProfile(40, park);
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i]!;
    const b = p[i + 1]!;
    if (d <= a.d && d >= b.d && a.d !== b.d) return a.y + ((b.y - a.y) * (a.d - d)) / (a.d - b.d);
  }
  return Number.NaN;
}

describe('channel profile', () => {
  it('matches surfaceHeight across the embankment, park and park edge', () => {
    // Away from the islands and side channels, which surfaceHeight also models.
    for (const t of [-0.75, 0.12, 0.3, 0.58]) {
      const x = t * MAP_HALF_X;
      const f = riverFrame(x);
      const hw = channelHalfWidth(x);
      const park = channelParkWidth(x);
      for (let off = hw - 80; off <= hw + 1; off += 0.5) {
        const px = f.p.x + f.south.x * off;
        const pz = f.p.z + f.south.z * off;
        const d = riverSignedDistance(px, pz);
        if (d < -park - 4) continue; // under water
        expect(profileY(d, park)).toBeCloseTo(surfaceHeight(px, pz), 1);
      }
    }
  });

  it('puts the water edge under the stone park edge', () => {
    for (const t of [-0.75, 0, 0.58]) {
      const x = t * MAP_HALF_X;
      const park = channelParkWidth(x);
      const p = channelProfile(40, park);
      const last = p[p.length - 1]!;
      expect(last.y).toBeLessThan(RIVER.waterY);
      expect(waterEdgeD(x)).toBeGreaterThan(last.d);
      expect(profileY(waterEdgeD(x), park)).toBeGreaterThan(RIVER.waterY);
    }
  });
});

describe('channelDistance', () => {
  const xs = RIVER.centerline.map((p) => p.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);

  it('equals the layout query inside the map and stays continuous past it', () => {
    for (const [tx, tz] of [
      [0, 0],
      [-0.5, 0.25],
      [0.75, 0.1],
    ] as const) {
      const x = tx * MAP_HALF_X;
      const z = tz * MAP_HALF_Z;
      expect(channelDistance(x, z)).toBe(riverSignedDistance(x, z));
    }
    for (const x of [x1 + 200, x1 + 900, x0 - 700]) {
      const f = riverFrame(x);
      expect(channelDistance(f.p.x, f.p.z)).toBeCloseTo(-channelHalfWidth(x), 6);
    }
    for (const end of [x0, x1]) {
      for (const k of [-120, -40, 40, 120]) {
        let prev = Number.NaN;
        for (let x = end - 60; x <= end + 60; x += 2) {
          const f = riverFrame(x);
          const d = channelDistance(f.p.x + f.south.x * k, f.p.z + f.south.z * k);
          if (!Number.isNaN(prev)) expect(Math.abs(d - prev)).toBeLessThan(2);
          prev = d;
        }
      }
    }
  });

  it('half width matches the layout distance query on the centerline', () => {
    for (let x = x0 + 10; x <= x1 - 10; x += 97) {
      const f = riverFrame(x);
      expect(riverSignedDistance(f.p.x, f.p.z)).toBeCloseTo(-channelHalfWidth(x), 0);
    }
  });
});

// Straight arm, a 90° turn of radius 60 and a straight arm: tighter than the offsets below.
type Vec2Like = { x: number; z: number };
function bendCenterline(): Vec2Like[] {
  const pts: Vec2Like[] = [];
  for (let x = -300; x < 0; x += 5) pts.push({ x, z: 0 });
  for (let a = 0; a <= 90; a += 3) {
    const r = (a * Math.PI) / 180;
    pts.push({ x: 60 * Math.sin(r), z: 60 - 60 * Math.cos(r) });
  }
  for (let z = 65; z <= 360; z += 5) pts.push({ x: 60, z });
  return pts;
}

function polyDistance(pts: readonly Vec2Like[], p: Vec2Like): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t));
  }
  return best;
}

function bendSlices(pts: readonly Vec2Like[]): StripSlice[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const along = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
    return { p, along, south: { x: -along.z, z: along.x } };
  });
}

describe('isoRow on a bend tighter than the offset', () => {
  const pts = bendCenterline();
  const slices = bendSlices(pts);
  const halfW = 100;
  const dist = (p: Vec2Like): number => polyDistance(pts, p) - halfW;
  const row = (d: number, side: -1 | 1): Vec2Like[] =>
    isoRow(
      slices,
      slices.map(() => (halfW + d) * side),
      slices.map(() => d),
      dist,
    ).points;

  it('keeps every point on the distance line and never steps backwards', () => {
    // The turn heads toward +Z, so side 1 (south) is the inner side.
    for (const d of [60, 0, -30]) {
      const r = row(d, 1);
      let collapsed = 0;
      for (let i = 0; i < r.length; i++) {
        expect(Math.abs(dist(r[i]!) - d)).toBeLessThan(1.5);
        if (i > 0 && r[i]!.x === r[i - 1]!.x && r[i]!.z === r[i - 1]!.z) collapsed++;
        if (i > 0) {
          const s = slices[i]!.along;
          const step = (r[i]!.x - r[i - 1]!.x) * s.x + (r[i]!.z - r[i - 1]!.z) * s.z;
          expect(step).toBeGreaterThanOrEqual(-1e-9);
        }
      }
      expect(collapsed).toBeGreaterThan(5);
    }
  });

  it('leaves its inputs alone and the outer side untouched', () => {
    const before = JSON.stringify(slices);
    const offset = slices.map(() => -halfW);
    const target = slices.map(() => 0);
    const { points, moved } = isoRow(slices, offset, target, dist);
    expect(JSON.stringify(slices)).toBe(before);
    expect(offset.every((v) => v === -halfW)).toBe(true);
    expect(moved.some(Boolean)).toBe(false);
    for (let i = 0; i < points.length; i++) {
      const f = slices[i]!;
      expect(points[i]!.x).toBeCloseTo(f.p.x - f.south.x * halfW, 9);
      expect(points[i]!.z).toBeCloseTo(f.p.z - f.south.z * halfW, 9);
    }
  });

  it('keeps the end slices where a strip starts or ends inside a fold', () => {
    const mid = slices.findIndex((f) => f.p.x > 30);
    for (const part of [slices.slice(mid), slices.slice(0, mid)]) {
      const k = part.map(() => 160);
      const { points } = isoRow(
        part,
        k,
        part.map(() => 60),
        dist,
      );
      for (const i of [0, part.length - 1]) {
        const f = part[i]!;
        expect(points[i]).toEqual({ x: f.p.x + f.south.x * 160, z: f.p.z + f.south.z * 160 });
      }
    }
  });

  it('does not collapse a run that only misses the target because the width changes', () => {
    const line: StripSlice[] = Array.from({ length: 80 }, (_, i) => ({
      p: { x: i * 8, z: 0 },
      along: { x: 1, z: 0 },
      south: { x: 0, z: 1 },
    }));
    // Width jumps by 10 m over 16 m while the offsets use the width at each slice's own x.
    const w = (x: number): number => 100 + 10 * Math.min(1, Math.max(0, (x - 300) / 16));
    const offset = line.map((f) => w(f.p.x));
    const { points, moved } = isoRow(
      line,
      offset,
      offset.map(() => 0),
      (p) => p.z - w(p.x + 6),
    );
    expect(moved.some(Boolean)).toBe(false);
    for (let i = 0; i < line.length; i++) expect(points[i]!.z).toBe(offset[i]);
  });

  it('strips between rows of different depth face up', () => {
    for (const side of [-1, 1] as const) {
      const a = row(60, side);
      const b = row(0, side);
      for (let i = 0; i < a.length - 1; i++) {
        // Quad a[i], b[i], a[i+1], b[i+1]; orientation flips with the side.
        for (const [p, q, r] of [
          [a[i]!, b[i]!, a[i + 1]!],
          [b[i]!, b[i + 1]!, a[i + 1]!],
        ] as const) {
          const area = (r.z - q.z) * (p.x - q.x) - (r.x - q.x) * (p.z - q.z);
          expect(area * -side).toBeGreaterThanOrEqual(-1e-6);
        }
      }
    }
  });
});

describe('ground grid', () => {
  it('axes are sorted, unique and reach the outer extent', () => {
    const ax = gridAxis(-100, 100, 10, 1000);
    expect(ax[0]).toBe(-1000);
    expect(ax[ax.length - 1]).toBe(1000);
    for (let i = 1; i < ax.length; i++) expect(ax[i]!).toBeGreaterThan(ax[i - 1]!);
    const { xs, zs } = groundAxes();
    for (const a of [xs, zs]) {
      for (let i = 1; i < a.length; i++) expect(a[i]!).toBeGreaterThan(a[i - 1]!);
      expect(a[0]).toBe(-OUTER_EXTENT);
      expect(a[a.length - 1]).toBe(OUTER_EXTENT);
    }
  });

  // Builds the whole ground (≈1-2 s, over 5 s on a loaded runner).
  it('ground faces up, follows terrainHeight and leaves the channel open', () => {
    const g = buildGround();
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const index = g.getIndex()!;
    // About 21k triangles per km² of map (120k on the 2.4 km v2 map).
    expect(index.count / 3).toBeLessThan((2 * CITY.halfX * 2 * CITY.halfZ) / 48);
    const used = new Set<number>();
    for (let i = 0; i < index.count; i++) used.add(index.getX(i));
    const near = LAYOUT.ridges.find((r) => r.id === 'ridge-near')!;
    for (const v of used) {
      const x = pos.getX(v);
      const z = pos.getZ(v);
      const r = Math.hypot(x, z);
      expect(r).toBeLessThanOrEqual(GROUND_RADIUS + 1e-3);
      expect(r).toBeLessThan(near.radius);
      // Rim vertices sit in collapsed sliver cells, so their normals are meaningless. Rock faces on
      // the ridges reach past 60°; anything above ~72° (or facing down) is a fold, not a slope.
      if (r < GROUND_RADIUS - 1) expect(nrm.getY(v)).toBeGreaterThan(0.3);
      expect(channelDistance(x, z)).toBeGreaterThanOrEqual(6);
      if (r > GROUND_RADIUS - 1) {
        expect(pos.getY(v)).toBeLessThanOrEqual(ridgeHeight(near, Math.atan2(z, x)) + 1e-3);
      }
    }
  }, 20_000);

  it('river strips end exactly on the outer extent', () => {
    for (const [fine, coarse] of [
      [8, 20],
      [16, 40],
    ] as const) {
      const xs = riverSliceXs(fine, coarse);
      expect(xs[0]).toBe(-OUTER_EXTENT);
      expect(xs[xs.length - 1]).toBe(OUTER_EXTENT);
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(1);
        expect(xs[i]! - xs[i - 1]!).toBeLessThanOrEqual(coarse + 1e-9);
      }
    }
  });

  it('embankment slope comes from the layout', () => {
    expect(EMBANK_SLOPE).toBe(LAYOUT_EMBANK_SLOPE);
  });

  it('channel rows that share an edge coincide and the water edge tucks under the stone edge', () => {
    const ch = buildChannel().getAttribute('position');
    const w = createWater().mesh.geometry.getAttribute('position');
    const prof = channelProfile(0, 0).length;
    const per = prof * 2;
    // The main strip and its water band come first; side channels and islands follow.
    const slices = channelSlices().slices.length;
    expect(ch.count).toBeGreaterThanOrEqual(slices * per);
    expect(w.count).toBeGreaterThanOrEqual(slices * 2);
    const xz = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number) => ({
      x: attr.getX(i),
      z: attr.getZ(i),
    });
    const gap = (a: { x: number; z: number }, b: { x: number; z: number }) =>
      Math.hypot(a.x - b.x, a.z - b.z);
    for (let s = 0; s < slices; s++) {
      for (let side = 0; side < 2; side++) {
        const base = s * per + side * prof;
        for (const j of [1, 3, 5]) expect(gap(xz(ch, base + j), xz(ch, base + j + 1))).toBe(0);
        // Ground drops 12 m cells with a corner nearer than 6 m; the strip must reach past them.
        const o = xz(ch, base);
        expect(channelDistance(o.x, o.z)).toBeGreaterThan(6 + 12 * Math.SQRT2);
        const park = xz(ch, base + 6);
        const edge = xz(ch, base + 7);
        const water = xz(w, s * 2 + side);
        expect(gap(park, water) + gap(water, edge)).toBeCloseTo(gap(park, edge), 1);
      }
    }
  });

  it('channel strip and water face up', () => {
    for (const g of [buildChannel(), createWater().mesh.geometry]) {
      const pos = g.getAttribute('position');
      const index = g.getIndex()!;
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      let faces = 0;
      for (let i = 0; i < index.count; i += 3) {
        a.fromBufferAttribute(pos, index.getX(i));
        b.fromBufferAttribute(pos, index.getX(i + 1));
        c.fromBufferAttribute(pos, index.getX(i + 2));
        const n = c.sub(b).cross(a.sub(b));
        // Slices collapsed onto a crossing point leave zero-area faces.
        if (n.length() < 1e-3) continue;
        faces++;
        expect(n.normalize().y).toBeGreaterThan(0.3);
      }
      expect(faces).toBeGreaterThan(index.count / 6);
    }
  });
});

describe('ridges', () => {
  it('render profile stays within ±12% of the layout ridgeHeight', () => {
    for (const r of LAYOUT.ridges) {
      for (let i = 0; i < 360; i++) {
        const a = (i / 360) * Math.PI * 2;
        const h = ridgeHeight(r, a);
        expect(Math.abs(ridgeProfile(r, a) - h)).toBeLessThanOrEqual(h * 0.12 + 1e-9);
      }
      expect(ridgeProfile(r, 0)).toBeCloseTo(ridgeProfile(r, Math.PI * 2), 6);
    }
  });

  it('beacon peaks are separated local maxima', () => {
    const near = LAYOUT.ridges.find((r) => r.id === 'ridge-near')!;
    const peaks = ridgePeaks(near, 4);
    expect(peaks).toHaveLength(4);
    for (const a of peaks) {
      const h = ridgeProfile(near, a);
      expect(h).toBeGreaterThanOrEqual(ridgeProfile(near, a + 0.01));
      expect(h).toBeGreaterThanOrEqual(ridgeProfile(near, a - 0.01));
    }
    for (let i = 0; i < peaks.length; i++) {
      for (let j = i + 1; j < peaks.length; j++) {
        const d = Math.abs(peaks[i]! - peaks[j]!);
        expect(Math.min(d, Math.PI * 2 - d)).toBeGreaterThanOrEqual(0.35);
      }
    }
  });
});

describe('noise2', () => {
  it('is deterministic and in [0, 1)', () => {
    for (let i = 0; i < 200; i++) {
      const v = noise2(i * 0.37, i * -0.71);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(noise2(i * 0.37, i * -0.71)).toBe(v);
    }
  });
});
