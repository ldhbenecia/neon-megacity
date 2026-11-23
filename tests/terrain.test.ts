import { describe, expect, it } from 'vitest';
import {
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
  channelDistance,
  channelProfile,
  gridAxis,
  groundAxes,
  noise2,
  ridgePeaks,
  ridgeProfile,
  riverSliceXs,
  waterHalfWidth,
} from '../src/terrain/shape';
import { buildChannel, buildGround } from '../src/terrain/ground';

function profileY(d: number): number {
  const p = channelProfile(40);
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i]!;
    const b = p[i + 1]!;
    if (d <= a.d && d >= b.d && a.d !== b.d) return a.y + ((b.y - a.y) * (a.d - d)) / (a.d - b.d);
  }
  return Number.NaN;
}

describe('channel profile', () => {
  it('matches surfaceHeight across the embankment, park and park edge', () => {
    for (const x of [-900, -300, 140, 700]) {
      const f = riverFrame(x);
      for (let off = 40; off <= 121; off += 0.5) {
        const px = f.p.x + f.south.x * off;
        const pz = f.p.z + f.south.z * off;
        const d = riverSignedDistance(px, pz);
        if (d < -RIVER.parkWidth - 4) continue; // under water
        expect(profileY(d)).toBeCloseTo(surfaceHeight(px, pz), 1);
      }
    }
  });

  it('puts the water edge under the stone park edge', () => {
    const p = channelProfile(40);
    const last = p[p.length - 1]!;
    expect(last.y).toBeLessThan(RIVER.waterY);
    const waterD = waterHalfWidth() - RIVER.width / 2;
    expect(waterD).toBeGreaterThan(last.d);
    expect(profileY(waterD)).toBeGreaterThan(RIVER.waterY);
  });
});

describe('channelDistance', () => {
  it('equals the layout query inside the map and stays continuous past it', () => {
    for (const [x, z] of [
      [0, 0],
      [-600, 300],
      [900, 120],
    ] as const) {
      expect(channelDistance(x, z)).toBe(riverSignedDistance(x, z));
    }
    for (const x of [1500, 2200, -2000]) {
      const f = riverFrame(x);
      expect(channelDistance(f.p.x, f.p.z)).toBeCloseTo(-RIVER.width / 2, 6);
    }
    expect(Math.abs(channelDistance(1285, 100) - channelDistance(1295, 100))).toBeLessThan(2);
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

  it('ground faces up, follows terrainHeight and leaves the channel open', () => {
    const g = buildGround();
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const index = g.getIndex()!;
    expect(index.count / 3).toBeLessThan(120_000);
    const used = new Set<number>();
    for (let i = 0; i < index.count; i++) used.add(index.getX(i));
    const near = LAYOUT.ridges.find((r) => r.id === 'ridge-near')!;
    for (const v of used) {
      const x = pos.getX(v);
      const z = pos.getZ(v);
      const r = Math.hypot(x, z);
      expect(r).toBeLessThanOrEqual(GROUND_RADIUS + 1e-3);
      expect(r).toBeLessThan(near.radius);
      // Rim vertices sit in collapsed sliver cells, so their normals are meaningless.
      if (r < GROUND_RADIUS - 1) expect(nrm.getY(v)).toBeGreaterThan(0.5);
      expect(channelDistance(x, z)).toBeGreaterThanOrEqual(6);
      if (r > GROUND_RADIUS - 1) {
        expect(pos.getY(v)).toBeLessThanOrEqual(ridgeHeight(near, Math.atan2(z, x)) + 1e-3);
      }
    }
  });

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

  it('channel strip faces up', () => {
    const g = buildChannel();
    const nrm = g.getAttribute('normal');
    let up = 0;
    for (let i = 0; i < nrm.count; i++) if (nrm.getY(i) > 0.3) up++;
    expect(up).toBe(nrm.count);
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
