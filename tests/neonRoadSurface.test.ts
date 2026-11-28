import { describe, expect, it } from 'vitest';
import { LAYOUT, roadSurfaceY, surfaceHeight } from '../src/city/layout';
import { pointSegmentDistance } from '../src/city/math';
import { groundPaths } from '../src/neon/lanes';
import { nearestRoadIndex, roadGapIndex } from '../src/neon/placement';

describe('neon on the road surface', () => {
  it('ground traffic starts on each road surface, hillside roads included', () => {
    const roads = LAYOUT.roads.filter((r) => r.kind !== 'stair');
    const paths = groundPaths(LAYOUT.roads, roadSurfaceY);
    expect(paths.length).toBeGreaterThan(0);
    const hill = roads.find((r) => r.district === 'hillside');
    const flat = roads.find((r) => r.district !== 'hillside');
    if (hill)
      expect(roadSurfaceY(hill.a.x, hill.a.z, hill)).toBeGreaterThan(
        roadSurfaceY(hill.a.x, hill.a.z),
      );
    // Off the hills the road surface equals the bare ground plus the road lift, as before.
    if (flat) {
      expect(
        roadSurfaceY(flat.a.x, flat.a.z, flat) - surfaceHeight(flat.a.x, flat.a.z),
      ).toBeCloseTo(roadSurfaceY(flat.a.x, flat.a.z) - surfaceHeight(flat.a.x, flat.a.z), 6);
    }
  });

  it('nearest road index agrees with the gap index and returns the closest road', () => {
    const near = nearestRoadIndex(LAYOUT, 6);
    const gap = roadGapIndex(LAYOUT, 6);
    for (const r of LAYOUT.roads.slice(0, 200)) {
      if (r.kind === 'stair') continue;
      const x = (r.a.x + r.b.x) / 2;
      const z = (r.a.z + r.b.z) / 2;
      const n = near(x, z);
      expect(n.gap).toBe(gap(x, z));
      expect(n.road).not.toBeNull();
      expect(pointSegmentDistance({ x, z }, n.road!.a, n.road!.b) - n.road!.width / 2).toBeCloseTo(
        n.gap,
        9,
      );
    }
  });
});
