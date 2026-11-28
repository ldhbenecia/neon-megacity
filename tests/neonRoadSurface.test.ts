import { describe, expect, it } from 'vitest';
import { LAYOUT, roadSurfaceY, surfaceHeight, terrainHeight } from '../src/city/layout';
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

  it('ground traffic stays within 5 cm of the road surface along the whole path', () => {
    const byId = new Map(LAYOUT.roads.map((r) => [`road-${r.id}`, r]));
    const paths = groundPaths(LAYOUT.roads, roadSurfaceY);
    let bent = 0;
    for (const p of paths) {
      const r = byId.get(p.id);
      if (!r) continue;
      if (p.points.length > 2) bent++;
      for (let i = 1; i < p.points.length; i++) {
        const a = p.points[i - 1]!;
        const b = p.points[i]!;
        for (const f of [0.25, 0.5, 0.75]) {
          const x = a.x + (b.x - a.x) * f;
          const z = a.z + (b.z - a.z) * f;
          const y = a.y + (b.y - a.y) * f;
          expect(Math.abs(y - roadSurfaceY(x, z, r))).toBeLessThan(0.05);
        }
      }
    }
    // Some roads do climb the slopes: the sampling is exercised, not just the straight case.
    expect(bent).toBeGreaterThan(0);
  });

  it('on the carriageway the road surface and the bare ground agree, so decals do not jump', () => {
    const near = nearestRoadIndex(LAYOUT, 0.5);
    for (const r of LAYOUT.roads) {
      if (r.kind === 'stair') continue;
      const nx = -(r.b.z - r.a.z);
      const nz = r.b.x - r.a.x;
      const l = Math.hypot(nx, nz) || 1;
      for (const f of [0, 0.5, 1]) {
        for (const side of [-1, 1]) {
          const d = r.width / 2 + 0.45;
          const x = r.a.x + (r.b.x - r.a.x) * f + (nx / l) * side * d;
          const z = r.a.z + (r.b.z - r.a.z) * f + (nz / l) * side * d;
          if (near(x, z).gap >= 0.5) continue;
          expect(Math.abs(surfaceHeight(x, z) - terrainHeight(x, z))).toBeLessThan(1e-6);
        }
      }
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
