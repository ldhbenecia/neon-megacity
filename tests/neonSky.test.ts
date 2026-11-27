import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../src/city/layout';
import { skyPaths, vehicleStreams } from '../src/neon/lanes';

describe('neon drones fly the layout sky lanes', () => {
  const paths = skyPaths(LAYOUT.skyLanes);
  const drones = vehicleStreams(paths, LAYOUT.highways);

  it('turns every sky lane into a flying path with its altitude band', () => {
    expect(LAYOUT.skyLanes.length).toBeGreaterThan(0);
    expect(paths.map((p) => p.id)).toEqual(LAYOUT.skyLanes.map((l) => l.id));
    paths.forEach((p, i) => {
      const lane = LAYOUT.skyLanes[i]!;
      expect(p.kind).toBe('flying');
      expect(p.closed).toBe(lane.closed);
      expect(p.altitude).toEqual(lane.altitude);
      expect(p.length).toBeGreaterThan(100);
      if (lane.closed) {
        const a = p.points[0]!;
        const b = p.points[p.points.length - 1]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1e-3);
      }
    });
  });

  it('puts drones on every lane, inside its altitude band (ART_DIRECTION 40–80 aloft)', () => {
    expect(drones.length).toBeGreaterThanOrEqual(40);
    expect(drones.length).toBeLessThanOrEqual(80);
    paths.forEach((p, i) => {
      const on = drones.filter((d) => d.path === i);
      expect(on.length, p.id).toBeGreaterThan(0);
      const [lo, hi] = p.altitude!;
      // vehicleStreams spreads lift by ±3 m around a height drawn inside the band.
      for (const d of on) {
        expect(d.lift).toBeGreaterThanOrEqual(lo - 3 - 1e-6);
        expect(d.lift).toBeLessThanOrEqual(hi + 3 + 1e-6);
      }
    });
  });

  it('fails loudly on a broken lane instead of dropping it', () => {
    expect(() =>
      skyPaths([{ id: 'sky-bad', points: [{ x: 0, z: 0 }], closed: true, altitude: [100, 160] }]),
    ).toThrow(/sky-bad/);
  });

  it('follows the layout samples when a lane carries them', () => {
    const samples = [
      { x: 0, z: 0 },
      { x: 300, z: 0 },
      { x: 300, z: 300 },
      { x: 0, z: 0 },
    ];
    const [p] = skyPaths([
      { id: 'sky-s', points: samples.slice(0, 3), samples, closed: true, altitude: [100, 160] },
    ]);
    // Resampled evenly along the samples' polyline: same length and ends, not the control points.
    expect(p!.length).toBeCloseTo(300 + 300 + Math.hypot(300, 300), 3);
    expect([p!.points[0]!.x, p!.points[0]!.z]).toEqual([0, 0]);
    const last = p!.points[p!.points.length - 1]!;
    expect(Math.hypot(last.x, last.z)).toBeLessThan(1e-6);
  });
});
