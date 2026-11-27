import { describe, expect, it } from 'vitest';
import {
  advanceTime,
  dayFactorAt,
  envKeyAt,
  fillColorAt,
  fillFactorAt,
  keyLightAt,
  moonDirectionAt,
  shadowFrameFor,
  shadowKnobs,
  shouldRefreshShadow,
  SHADOW_REFRESH,
  sunDirectionAt,
  SHADOW_SNAP,
  SUN_PATH,
} from '../src/lighting/sun';

const len = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);

describe('sun path', () => {
  it('returns unit vectors and is continuous over the whole day', () => {
    let prev = sunDirectionAt(0);
    for (let i = 1; i <= 2000; i++) {
      const d = sunDirectionAt(i / 2000);
      expect(len(d)).toBeCloseTo(1, 9);
      expect(Math.hypot(d.x - prev.x, d.y - prev.y, d.z - prev.z)).toBeLessThan(0.02);
      prev = d;
    }
  });

  it('is below the horizon at night and high in the south at noon', () => {
    expect(sunDirectionAt(0).y).toBeLessThan(-0.5);
    const noon = sunDirectionAt(0.53);
    expect(noon.y).toBeGreaterThan(Math.sin((55 * Math.PI) / 180));
    expect(noon.z).toBeGreaterThan(0); // south = +Z
    expect(sunDirectionAt(SUN_PATH.sunrise).y).toBeCloseTo(0, 9);
    expect(sunDirectionAt(SUN_PATH.sunset).y).toBeCloseTo(0, 9);
  });

  it('rises in the east and sets in the west, low during the sunset plateau', () => {
    expect(sunDirectionAt(0.27).x).toBeGreaterThan(0.8);
    expect(sunDirectionAt(0.79).x).toBeLessThan(-0.8);
    for (const t of [0.76, 0.78, 0.8]) {
      const y = sunDirectionAt(t).y;
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(Math.sin((16 * Math.PI) / 180));
    }
  });

  it('wraps outside 0..1', () => {
    expect(sunDirectionAt(1.25)).toEqual(sunDirectionAt(0.25));
    expect(sunDirectionAt(-0.5)).toEqual(sunDirectionAt(0.5));
  });
});

describe('moon path', () => {
  it('is up at night in the northern sky and down at noon', () => {
    const m = moonDirectionAt(0);
    expect(m.y).toBeGreaterThan(0.3);
    expect(m.z).toBeLessThan(0); // north = -Z
    expect(moonDirectionAt(0.5).y).toBeLessThan(0);
    for (let i = 0; i <= 500; i++) expect(len(moonDirectionAt(i / 500))).toBeCloseTo(1, 9);
  });
});

describe('factors', () => {
  it('dayFactor is 0 at night, 1 by day, monotonic', () => {
    expect(dayFactorAt(-0.5)).toBe(0);
    expect(dayFactorAt(0.5)).toBe(1);
    let prev = 0;
    for (let y = -0.2; y <= 0.3; y += 0.01) {
      const f = dayFactorAt(y);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('key light hands over from sun to moon through zero', () => {
    expect(keyLightAt(0.5, -0.3)).toEqual({ body: 'sun', weight: 1 });
    expect(keyLightAt(-0.5, 0.4)).toEqual({ body: 'moon', weight: 1 });
    expect(keyLightAt(-0.0199, 0.4).weight).toBeLessThan(0.01);
    expect(keyLightAt(-0.0201, 0.4).weight).toBeLessThan(0.01);
    expect(keyLightAt(-0.5, -0.1).weight).toBe(0);
  });
});

describe('advanceTime', () => {
  it('never moves while locked (?time=0.0 must stay 00:00)', () => {
    let t = 0;
    for (let i = 0; i < 600; i++) t = advanceTime(t, 1 / 60, 480, true);
    expect(t).toBe(0);
  });

  it('advances and wraps when unlocked', () => {
    expect(advanceTime(0.5, 48, 480, false)).toBeCloseTo(0.6, 12);
    expect(advanceTime(0.95, 48, 480, false)).toBeCloseTo(0.05, 12);
    expect(advanceTime(0.3, 0, 480, false)).toBe(0.3);
  });
});

describe('envKeyAt', () => {
  it('picks the four baked keys', () => {
    expect(envKeyAt(0)).toBe('night');
    expect(envKeyAt(0.04)).toBe('night');
    expect(envKeyAt(0.25)).toBe('dawn');
    expect(envKeyAt(0.5)).toBe('day');
    expect(envKeyAt(0.78)).toBe('sunset');
    expect(envKeyAt(0.95)).toBe('night');
  });

  it('switches at the midpoints of the palette transitions', () => {
    const at = (h: number) => envKeyAt(h / 24);
    expect([at(4.99), at(5.01)]).toEqual(['night', 'dawn']);
    expect([at(7.99), at(8.01)]).toEqual(['dawn', 'day']);
    expect([at(16.62), at(16.63)]).toEqual(['day', 'sunset']);
    expect([at(20.59), at(20.61)]).toEqual(['sunset', 'night']);
  });

  it('changes at most 4 times over a day', () => {
    let changes = 0;
    let prev = envKeyAt(0);
    for (let i = 1; i <= 1440; i++) {
      const k = envKeyAt(i / 1440);
      if (k !== prev) changes++;
      prev = k;
    }
    expect(changes).toBe(4);
  });
});

describe('shadowFrameFor', () => {
  it('snaps center and size so small moves do not change it', () => {
    const a = shadowFrameFor(10, -20, 600);
    const b = shadowFrameFor(25, -5, 590);
    expect(b).toEqual(a);
    expect(a.cx % SHADOW_SNAP.grid).toBe(0);
  });

  it('covers the view and stays within limits', () => {
    for (const d of [20, 300, 900, 2600]) {
      const f = shadowFrameFor(0, 0, d);
      expect(f.half).toBeGreaterThanOrEqual(Math.min(SHADOW_SNAP.maxHalf, d * 1.1) - 1e-6);
      expect(f.half).toBeGreaterThanOrEqual(SHADOW_SNAP.minHalf);
      expect(f.half).toBeLessThanOrEqual(SHADOW_SNAP.maxHalf);
    }
  });
});

describe('shouldRefreshShadow', () => {
  it('refreshes immediately when the frustum moves (no stale clipped shadows)', () => {
    expect(shouldRefreshShadow(true, 0, 0, false)).toBe(true);
    expect(shouldRefreshShadow(false, 0, 0, true)).toBe(true);
  });

  it('throttles sun-motion refreshes to at most once per second and 0.5°', () => {
    const eps = SHADOW_REFRESH.sunEps;
    expect(shouldRefreshShadow(false, eps * 2, 0.2, false)).toBe(false);
    expect(shouldRefreshShadow(false, eps * 0.5, 2, false)).toBe(false);
    expect(shouldRefreshShadow(false, eps, SHADOW_REFRESH.minInterval, false)).toBe(true);
    expect(shouldRefreshShadow(false, 0, SHADOW_REFRESH.maxInterval, false)).toBe(true);
  });

  it('re-renders about once per second or less over a default 8 minute day', () => {
    let last = sunDirectionAt(0.3);
    let since = 0;
    let renders = 0;
    const dt = 1 / 60;
    let t = 0.3;
    for (let i = 0; i < 60 * 60; i++) {
      t += dt / 480;
      since += dt;
      const d = sunDirectionAt(t);
      const ang = Math.acos(Math.min(1, last.x * d.x + last.y * d.y + last.z * d.z));
      if (shouldRefreshShadow(false, ang, since, false)) {
        renders++;
        since = 0;
        last = d;
      }
    }
    expect(renders).toBeLessThanOrEqual(61);
    expect(renders).toBeGreaterThan(10);
  });
});

describe('shadow fill (env.fillFactor / fillColor)', () => {
  const floor = [0.003, 0.005, 0.005] as const;
  const navy = [0.01, 0.018, 0.058] as const;

  it('is full at night, already up while the sun is low, and off by day', () => {
    expect(fillFactorAt(-0.5)).toBe(1);
    expect(fillFactorAt(0.153)).toBeGreaterThan(0.8);
    expect(fillFactorAt(0.35)).toBe(0);
    expect(fillFactorAt(0.8)).toBe(0);
    for (let e = -0.3; e < 0.5; e += 0.01) {
      expect(fillFactorAt(e)).toBeGreaterThanOrEqual(1 - dayFactorAt(e) - 1e-9);
    }
  });

  it('is the night teal at night and the dark sky tint (same strength) at dusk', () => {
    expect(fillColorAt(-0.5, navy, floor)).toEqual([...floor]);
    const dusk = fillColorAt(0.153, navy, floor);
    const k = fillFactorAt(0.153);
    expect(Math.max(...dusk)).toBeCloseTo(0.005 * k, 6);
    expect(dusk[2]).toBeGreaterThan(dusk[1]);
    expect(fillColorAt(0.8, navy, floor)).toEqual([0, 0, 0]);
  });
});

describe('sun shadow per quality tier', () => {
  it('halves the map on medium and low, keeps refreshing slower, turns sun shadows off on low', () => {
    expect(shadowKnobs('high')).toEqual({
      mapSize: 2048,
      minInterval: SHADOW_REFRESH.minInterval,
      sunShadows: true,
    });
    expect(shadowKnobs('medium')).toMatchObject({
      mapSize: 1024,
      minInterval: 2,
      sunShadows: true,
    });
    expect(shadowKnobs('low')).toMatchObject({ mapSize: 1024, sunShadows: false });
  });

  it('a longer minimum interval holds back sun-driven refreshes but not frustum changes', () => {
    const angle = SHADOW_REFRESH.sunEps * 2;
    expect(shouldRefreshShadow(false, angle, 1.5, false)).toBe(true);
    expect(shouldRefreshShadow(false, angle, 1.5, false, 2)).toBe(false);
    expect(shouldRefreshShadow(true, 0, 0.1, false, 2)).toBe(true);
  });
});
