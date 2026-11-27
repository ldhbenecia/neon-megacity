import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CITY,
  EMBANK_SLOPE as LAYOUT_EMBANK_SLOPE,
  LAYOUT,
  MOUNTAIN_RANGES,
  RIVER,
  riverFrame,
  riverSignedDistance,
  ridgeHeight,
  surfaceHeight,
} from '../src/city/layout';
import {
  EMBANK_SLOPE,
  groundRadius,
  outerExtent,
  MAP_HALF_X,
  MAP_HALF_Z,
  channelDistance,
  channelHalfWidth,
  channelProfile,
  gridAxis,
  groundAxes,
  groundWaterDistance,
  SIDE_REACH,
  sideDistance,
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
import {
  buildChannel,
  buildGround,
  forestMask,
  shadeValleys,
  valleyShade,
} from '../src/terrain/ground';
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
      expect(a[0]).toBe(-outerExtent());
      expect(a[a.length - 1]).toBe(outerExtent());
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
      expect(r).toBeLessThanOrEqual(groundRadius() + 1e-3);
      expect(r).toBeLessThan(near.radius);
      // Rim vertices sit in collapsed sliver cells, so their normals are meaningless. Rock faces on
      // the ridges reach past 60°; anything above ~72° (or facing down) is a fold, not a slope.
      if (r < groundRadius() - 1) expect(nrm.getY(v)).toBeGreaterThan(0.3);
      expect(channelDistance(x, z)).toBeGreaterThanOrEqual(6);
      if (r > groundRadius() - 1) {
        expect(pos.getY(v)).toBeLessThanOrEqual(ridgeHeight(near, Math.atan2(z, x)) + 1e-3);
      }
    }
    // Vertex normals average a fold away; every triangle must face up on its own.
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    let down = 0;
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(pos, index.getX(i));
      b.fromBufferAttribute(pos, index.getX(i + 1));
      c.fromBufferAttribute(pos, index.getX(i + 2));
      if (Math.hypot(a.x, a.z) > groundRadius() - 1) continue;
      const n = c.sub(b).cross(a.sub(b));
      if (n.length() > 1e-6 && n.y <= 0) down++;
    }
    expect(down).toBe(0);
  }, 20_000);

  it('split mountain cells and coarse cells share their edges exactly (no cracks)', () => {
    const g = buildGround();
    const pos = g.getAttribute('position');
    const index = g.getIndex()!;
    // Every triangle edge used once is a border: on the map interior there must be none apart
    // from the cells dropped along the water.
    const key = (p: number, q: number) => (p < q ? `${p},${q}` : `${q},${p}`);
    const edges = new Map<string, number>();
    for (let i = 0; i < index.count; i += 3) {
      const t = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      for (let e = 0; e < 3; e++) {
        const k = key(t[e]!, t[(e + 1) % 3]!);
        edges.set(k, (edges.get(k) ?? 0) + 1);
      }
    }
    const xz = (v: number) => ({ x: pos.getX(v), y: pos.getY(v), z: pos.getZ(v) });
    const midOf = (k: string) => {
      const [p, q] = k.split(',').map(Number) as [number, number];
      const a = xz(p);
      const b = xz(q);
      return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    };
    // A T-junction is fine when the long edge and its short pieces are collinear: each open edge's
    // midpoint must lie on another open edge. A crack (fine vertex off the coarse edge) fails.
    type P = { x: number; y: number; z: number };
    // Every open edge can be a partner; only those away from water and the rim are checked
    // (cells dropped along the water leave real borders). Filtering partners too would leave a
    // piece whose collinear long edge happens to sit just inside the water filter unmatched.
    const all: [P, P, string][] = [];
    const checked: [P, P, string][] = [];
    for (const [k, n] of edges) {
      if (n !== 1) continue;
      const [p, q] = k.split(',').map(Number) as [number, number];
      const e: [P, P, string] = [xz(p), xz(q), k];
      all.push(e);
      const m = midOf(k);
      if (Math.abs(m.x) > CITY.halfX || Math.abs(m.z) > CITY.halfZ) continue;
      if (groundWaterDistance(m.x, m.z) < 60) continue;
      checked.push(e);
    }
    // In 3D: a crack is a fine vertex lifted off the coarse edge.
    const onSegment = (m: P, a: P, b: P) => {
      const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      const t =
        ((m.x - a.x) * d.x + (m.y - a.y) * d.y + (m.z - a.z) * d.z) /
        (d.x * d.x + d.y * d.y + d.z * d.z);
      const e = Math.hypot(a.x + d.x * t - m.x, a.y + d.y * t - m.y, a.z + d.z * t - m.z);
      return t > -1e-6 && t < 1 + 1e-6 && e < 1e-3;
    };
    let cracked = 0;
    for (const [a, b, k] of checked) {
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
      if (!all.some(([c, d, k2]) => k2 !== k && onSegment(m, c, d))) cracked++;
    }
    expect(cracked).toBe(0);
  }, 20_000);

  it('ground cells dropped beside a side channel stay inside its bank strip', () => {
    const { xs, zs } = groundAxes();
    let worst = 0;
    for (let j = 0; j < zs.length - 1; j++) {
      for (let i = 0; i < xs.length - 1; i++) {
        const corners = [
          [xs[i]!, zs[j]!],
          [xs[i + 1]!, zs[j]!],
          [xs[i]!, zs[j + 1]!],
          [xs[i + 1]!, zs[j + 1]!],
        ].map(([x, z]) => sideDistance(x!, z!));
        if (Math.min(...corners) >= 6) continue;
        worst = Math.max(worst, ...corners.filter(Number.isFinite));
      }
    }
    expect(worst).toBeLessThan(SIDE_REACH);
  });

  it('islands are convex with no sharp corners (fans and mitred skirts stay sound)', () => {
    for (const isl of LAYOUT.islands.filter((i) => i.kind !== 'land')) {
      const p = isl.polygon;
      let sign = 0;
      for (let i = 0; i < p.length; i++) {
        const a = p[i]!;
        const b = p[(i + 1) % p.length]!;
        const c = p[(i + 2) % p.length]!;
        const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
        if (sign === 0) sign = Math.sign(cross);
        expect(Math.sign(cross)).toBe(sign);
        const u = Math.atan2(a.z - b.z, a.x - b.x);
        const v = Math.atan2(c.z - b.z, c.x - b.x);
        let ang = Math.abs(u - v);
        if (ang > Math.PI) ang = 2 * Math.PI - ang;
        expect(ang).toBeGreaterThan(Math.PI / 3);
      }
    }
  });

  it('river strips end exactly on the outer extent', () => {
    for (const [fine, coarse] of [
      [8, 20],
      [16, 40],
    ] as const) {
      const xs = riverSliceXs(fine, coarse);
      expect(xs[0]).toBe(-outerExtent());
      expect(xs[xs.length - 1]).toBe(outerExtent());
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
        for (let j = 1; j < prof - 1; j += 2) {
          expect(gap(xz(ch, base + j), xz(ch, base + j + 1))).toBe(0);
        }
        // Ground drops 12 m cells with a corner nearer than 6 m; the strip must reach past them.
        const o = xz(ch, base);
        expect(channelDistance(o.x, o.z)).toBeGreaterThan(6 + 12 * Math.SQRT2);
        const park = xz(ch, base + prof - 2);
        const edge = xz(ch, base + prof - 1);
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

describe('valley shading and the range forest mask', () => {
  it('valleyShade stays finite and in [0.65, 1.25], and leaves non-forest alone', () => {
    for (const below of [-100, -5, -1, 0, 1, 5, 100]) {
      for (const f of [0, 0.5, 1]) {
        const k = valleyShade(below, f);
        expect(Number.isFinite(k)).toBe(true);
        expect(k).toBeGreaterThanOrEqual(0.65);
        expect(k).toBeLessThanOrEqual(1.25);
        if (f === 0) expect(k).toBe(1);
      }
    }
  });

  it('shadeValleys darkens a sunken forest vertex, lightens a raised one, skips the plain', () => {
    // 5 × 5 grid at 8 m; forest ground at 40 m with one pit and one bump, plus a plain corner.
    const n = 5;
    const bare: number[] = [];
    const pos: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        let y = 40;
        if (i === 1 && j === 1) y = 30;
        if (i === 3 && j === 3) y = 50;
        if (i === 0 && j === 4) y = 0;
        bare.push(y);
        pos.push(i * 8, y, j * 8);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * n * 3).fill(0.5), 3));
    g.setIndex(idx);
    shadeValleys(g, bare);
    const col = g.getAttribute('color');
    expect(col.getX(1 * n + 1)).toBeLessThan(0.5);
    expect(col.getX(3 * n + 3)).toBeGreaterThan(0.5);
    expect(col.getX(4 * n + 0)).toBe(0.5);
    for (let i = 0; i < col.count; i++) expect(Number.isFinite(col.getX(i))).toBe(true);
  });

  it('forestMask is 0 outside every mountain range box and on building footprints', () => {
    const mask = forestMask();
    const outside = { x: CITY.halfX - 5, z: CITY.halfZ - 5 };
    expect(
      MOUNTAIN_RANGES.some(
        (r) => outside.x >= r.x0 && outside.x <= r.x1 && outside.z >= r.z0 && outside.z <= r.z1,
      ),
    ).toBe(false);
    expect(mask(outside.x, outside.z)).toBe(0);
    const inRange = LAYOUT.buildings.filter((b) =>
      MOUNTAIN_RANGES.some((r) => b.x >= r.x0 && b.x <= r.x1 && b.z >= r.z0 && b.z <= r.z1),
    );
    for (const b of inRange.slice(0, 50)) expect(mask(b.x, b.z)).toBeLessThan(0.5);
  });
});
