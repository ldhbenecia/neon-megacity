import { describe, expect, it } from 'vitest';
import { LAYOUT, allTiers, buildingContaining, buildingTop } from '../src/city/layout';
import {
  CLOUD_LAYERS,
  RAIN,
  TIME_WRAP,
  TUNED_EXTENT,
  mapFogScale,
  searchlightMounts,
  wrapTime,
} from '../src/atmosphere/logic';
import {
  FOG_UNIFORMS,
  HEIGHT_FOG,
  fogFactor,
  heightFogScale,
  heightFogThinIntegral,
  waterFogBoost,
} from '../src/core/shaders/emissiveFog';

describe('searchlight mounts', () => {
  it('stand on the highest tier (setback / twin aware) of the tallest peaks, one per zone', () => {
    const byHeight = [...LAYOUT.buildings].sort((a, b) => buildingTop(b) - buildingTop(a));
    const first = byHeight[0]!;
    const second = byHeight.find((b) => b.zoneId !== first.zoneId)!;
    const mounts = searchlightMounts(LAYOUT.buildings, 2);
    expect(mounts).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const b = [first, second][i]!;
      const m = mounts[i]!;
      const tiers = allTiers(b);
      const top = Math.max(...tiers.map((t) => t.y1));
      expect(m.y).toBeCloseTo(top + 4, 6);
      const host = tiers.find((t) => t.y1 === top)!;
      expect(Math.hypot(m.x - host.x, m.z - host.z)).toBeLessThan(1e-6);
      expect(buildingContaining(LAYOUT, m.x, top - 1, m.z)).toBe(b.id);
    }
    expect(searchlightMounts([], 2)).toEqual([]);
  });

  it('keep beam i on zone i, filling missing zones from other peaks', () => {
    const tallestIn = (zone: string) =>
      [...LAYOUT.buildings]
        .filter((b) => b.zoneId === zone)
        .sort((a, b) => buildingTop(b) - buildingTop(a))[0]!;
    const host = (m: { x: number; y: number; z: number }) =>
      LAYOUT.buildings[buildingContaining(LAYOUT, m.x, m.y - 5, m.z)!]!;
    const zones = [...new Set(LAYOUT.buildings.map((b) => b.zoneId))].slice(0, 2);
    const mounts = searchlightMounts(LAYOUT.buildings, 3, [zones[0]!, 'no-such-zone', zones[1]!]);
    expect(mounts).toHaveLength(3);
    expect(host(mounts[0]!).id).toBe(tallestIn(zones[0]!).id);
    expect(host(mounts[2]!).id).toBe(tallestIn(zones[1]!).id);
    // The missing zone's slot goes to a peak in a zone without a beam yet.
    expect(zones).not.toContain(host(mounts[1]!).zoneId);
  });

  it('skip buildings without tiers', () => {
    const [a, b] = [...LAYOUT.buildings].sort((x, y) => buildingTop(y) - buildingTop(x));
    const bare = { ...a!, id: -1, tiers: [], twin: undefined } as unknown as typeof a;
    const mounts = searchlightMounts([bare!, b!], 2);
    expect(mounts).toHaveLength(1);
  });
});

describe('map-scaled fog', () => {
  it('keeps the tuned density on the tuned map and thins it by the square root on wider maps', () => {
    expect(mapFogScale(TUNED_EXTENT)).toBe(1);
    expect(mapFogScale(4000)).toBeCloseTo(Math.sqrt(2400 / 4000), 9);
    expect(mapFogScale(4000)).toBeGreaterThan(2400 / 4000);
  });
});

describe('shader time and altitude', () => {
  it('wraps shader time into a bounded range', () => {
    expect(wrapTime(1234.5, TIME_WRAP.rain)).toBeCloseTo(234.5, 9);
    expect(wrapTime(3 * TIME_WRAP.clouds + 7, TIME_WRAP.clouds)).toBeCloseTo(7, 6);
    expect(wrapTime(5, 1000)).toBe(5);
  });

  it('rain fades around the cloud deck height', () => {
    expect(RAIN.fadeAltitude[0]).toBeLessThan(CLOUD_LAYERS.lowY);
    expect(RAIN.fadeAltitude[1]).toBeGreaterThan(CLOUD_LAYERS.lowY);
  });
});

describe('height fog seen from above', () => {
  it('thins the ray mean to clear air above clearTop, continuously', () => {
    const { heightTop: H, clearTop: C } = HEIGHT_FOG;
    for (const y of [H, C]) {
      expect(heightFogThinIntegral(y + 1e-6)).toBeCloseTo(heightFogThinIntegral(y - 1e-6), 4);
    }
    // Slope of the integral is the thinning: (1 - top) just above heightTop, 1 at clearTop.
    const d = (y: number) => (heightFogThinIntegral(y + 0.5) - heightFogThinIntegral(y - 0.5)) / 1;
    expect(d(H + 1)).toBeCloseTo(1 - HEIGHT_FOG.top, 2);
    expect(d(C + 10)).toBeCloseTo(1, 6);
  });

  it('keeps topdown (y 1900 looking at the ground) readable', () => {
    expect(heightFogScale(0, 1900)).toBeLessThan(0.2);
  });

  it('keeps the top floor on near-horizontal rays: tower tops far away keep their haze', () => {
    expect(heightFogScale(600, 50, 2000)).toBeCloseTo(HEIGHT_FOG.top, 9);
    expect(heightFogScale(650, 600, 2000)).toBeCloseTo(HEIGHT_FOG.top, 9);
  });

  it('has no seam where a surface crosses the camera height', () => {
    const cam = 1900;
    const near = [cam - 3, cam - 0.5, cam + 0.5, cam + 3].map((y) => heightFogScale(y, cam, 300));
    for (const k of near) expect(k).toBeCloseTo(HEIGHT_FOG.top, 3);
  });

  it('ramps the water boost down the bank instead of a step', () => {
    expect(heightFogScale(-0.01, 1900)).toBe(heightFogScale(0, 1900));
    const bank = [-0.5, -1, -1.5, -2].map((y) => waterFogBoost(y));
    for (let i = 1; i < bank.length; i++) expect(bank[i]!).toBeGreaterThanOrEqual(bank[i - 1]!);
    expect(waterFogBoost(-1) - waterFogBoost(-0.5)).toBeLessThan(0.15);
    expect(waterFogBoost(-4)).toBeCloseTo(HEIGHT_FOG.water, 9);
  });
});

describe('height fog toggle', () => {
  it('CPU fog mirrors follow cityFogHeight.w like the shader', () => {
    const h = FOG_UNIFORMS.cityFogHeight.value;
    h[3] = 0;
    expect(heightFogScale(400)).toBe(1);
    expect(fogFactor(0.001, 1000, 400)).toBeCloseTo(1 - Math.exp(-1), 9);
    h[3] = 1;
    expect(heightFogScale(400)).toBeCloseTo(HEIGHT_FOG.top, 9);
  });
});
