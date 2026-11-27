import { describe, expect, it } from 'vitest';
import { NIGHT, paletteAt } from '../src/core/palette';
import {
  RAIN,
  WETNESS,
  beamLength,
  bloomMipsFor,
  bloomScaleFor,
  skyExtrasFor,
  userTier,
  computeFog,
  msaaSamplesFor,
  rainAltitudeFade,
  rainDropCount,
  rainPoolFor,
  searchlightDirection,
  searchlightLevelAt,
  stepRain,
  stepWetness,
  sunScatterStrength,
  wetnessTarget,
} from '../src/atmosphere/logic';
import { tileableFbm } from '../src/atmosphere/noise';
import { ShaderChunk, ShaderLib, UniformsUtils } from 'three';
import { installFogChunks } from '../src/atmosphere/fogChunks';
import {
  FOG_UNIFORMS,
  HEIGHT_FOG,
  emissiveFogFactor,
  fogFactor,
  heightFogScale,
} from '../src/core/shaders/emissiveFog';

describe('fog chunks', () => {
  it('installs height / scattering fog, shares uniforms through clones and uninstalls', () => {
    const before = ShaderChunk.fog_fragment;
    const uninstall = installFogChunks();
    expect(ShaderChunk.fog_fragment).toContain('cityFogAmount');
    expect(ShaderChunk.fog_pars_fragment).toContain('#define CITY_FOG');
    const cloned = UniformsUtils.clone(ShaderLib.standard.uniforms);
    expect(cloned.cityFogHeight?.value).toBe(FOG_UNIFORMS.cityFogHeight.value);
    expect(ShaderLib.basic.uniforms.cityFogSun?.value).toBe(FOG_UNIFORMS.cityFogSun.value);
    uninstall();
    expect(ShaderChunk.fog_fragment).toBe(before);
    expect(ShaderLib.standard.uniforms.cityFogHeight).toBeUndefined();
  });

  it('height fog: full at the ground, x0.35 up high, x1.25 over water', () => {
    expect(heightFogScale(0)).toBe(1);
    expect(heightFogScale(400)).toBeCloseTo(HEIGHT_FOG.top, 9);
    expect(heightFogScale(-2)).toBeCloseTo(HEIGHT_FOG.water, 9);
    expect(heightFogScale(400, 5)).toBeCloseTo(HEIGHT_FOG.top, 9);
    expect(heightFogScale(0, 1900)).toBeLessThan(0.45);
    expect(heightFogScale(0, 5)).toBeGreaterThan(0.98);
    const d = NIGHT.fogDensity;
    expect(fogFactor(d, 150)).toBeLessThan(0.1);
    expect(fogFactor(d, 800)).toBeGreaterThan(0.4);
    expect(fogFactor(d, 2000)).toBeGreaterThan(0.9);
    expect(emissiveFogFactor(d * 1.2, 1000)).toBeLessThan(0.5);
  });
});

describe('fog', () => {
  it('scales the palette density by 1 + 0.5 × rain and keeps the hue', () => {
    const p = paletteAt(0);
    const dry = computeFog(p, 0);
    const wet = computeFog(p, 1);
    expect(dry.density).toBeCloseTo(NIGHT.fogDensity, 9);
    expect(wet.density).toBeCloseTo(NIGHT.fogDensity * 1.5, 9);
    expect(wet.color[1] / wet.color[2]).toBeCloseTo(dry.color[1] / dry.color[2], 6);
    expect(wet.color[1]).toBeGreaterThan(dry.color[1]);
    expect(computeFog(p, 0.5, 2).density).toBeCloseTo(NIGHT.fogDensity * 1.25 * 2, 9);
  });

  it('night fog stays teal (green and blue well above red)', () => {
    const { color } = computeFog(paletteAt(0.02), 0.4);
    expect(color[1]).toBeGreaterThan(color[0] * 2);
    expect(color[2]).toBeGreaterThan(color[0] * 2);
  });

  it('sun scattering only near / above the horizon', () => {
    expect(sunScatterStrength(-0.5)).toBe(0);
    expect(sunScatterStrength(0.05)).toBe(1);
    expect(sunScatterStrength(0)).toBeGreaterThan(0);
  });
});

describe('rain and wetness', () => {
  it('eases rain toward rainTarget over a few seconds and holds it once reached', () => {
    let r = 0;
    for (let t = 0; t < 1; t += 0.1) r = stepRain(r, 1, 0.1);
    expect(r).toBeGreaterThan(0.3);
    expect(r).toBeLessThan(0.8);
    for (let t = 0; t < 10; t += 0.1) r = stepRain(r, 1, 0.1);
    expect(r).toBe(1);
    expect(stepRain(0.35, 0.35, 0.1)).toBe(0.35);
  });

  it('never touches env.rain: wetness is a function of rain, not the reverse', () => {
    const env = { rain: 0.73, wetness: 0.55 };
    for (let i = 0; i < 100; i++) env.wetness = stepWetness(env.wetness, env.rain, 0.1);
    expect(env.rain).toBe(0.73);
  });

  it('rises to 1 over 30 s of rain and decays to 0.55 over 120 s', () => {
    let w: number = WETNESS.dry;
    for (let t = 0; t < 15; t += 0.1) w = stepWetness(w, 0.5, 0.1);
    expect(w).toBeCloseTo(0.775, 2);
    for (let t = 0; t < 20; t += 0.1) w = stepWetness(w, 0.5, 0.1);
    expect(w).toBe(1);
    for (let t = 0; t < 60; t += 0.1) w = stepWetness(w, 0, 0.1);
    expect(w).toBeCloseTo(0.775, 2);
    for (let t = 0; t < 100; t += 0.1) w = stepWetness(w, 0, 0.1);
    expect(w).toBe(WETNESS.dry);
  });

  it('boots at the steady state of the initial rain', () => {
    expect(wetnessTarget(0.35)).toBe(1);
    expect(wetnessTarget(0)).toBe(WETNESS.dry);
  });

  it('drop count follows rain, capped by the quality pool', () => {
    expect(rainDropCount(0)).toBe(0);
    expect(rainDropCount(0.02)).toBe(0);
    expect(rainDropCount(1)).toBe(RAIN.maxDrops);
    expect(rainDropCount(0.35)).toBeGreaterThanOrEqual(6000);
    expect(rainDropCount(1, rainPoolFor(1))).toBe(RAIN.maxDrops / 2);
    expect(rainPoolFor(2)).toBe(0);
  });

  it('stops above the cloud deck', () => {
    expect(rainAltitudeFade(5)).toBe(1);
    expect(rainAltitudeFade(420)).toBe(1);
    expect(rainAltitudeFade(1900)).toBe(0);
  });
});

describe('searchlights', () => {
  it('night 1, sunset 0.3, day off', () => {
    expect(searchlightLevelAt(0.02)).toBe(1);
    expect(searchlightLevelAt(0.78)).toBeCloseTo(0.3, 6);
    expect(searchlightLevelAt(0.5)).toBe(0);
  });

  it('swings within ±25° (plus lean) of vertical and stays a unit vector', () => {
    const beam = { azimuth: 1, period: 22, phase: 0.3, amplitude: (25 * Math.PI) / 180, lean: 0.1 };
    const maxTilt = beam.amplitude + beam.lean + 1e-9;
    for (let t = 0; t < 60; t += 0.7) {
      const [x, y, z] = searchlightDirection(t, beam);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
      expect(Math.acos(y)).toBeLessThanOrEqual(maxTilt);
    }
  });

  it('beam length reaches the cloud base', () => {
    expect(beamLength(500, 1, 650, 1500)).toBe(150);
    expect(beamLength(500, 0.5, 650, 1500)).toBe(300);
    expect(beamLength(700, 1, 650, 1500)).toBe(1500);
  });
});

describe('post and quality', () => {
  it('MSAA and bloom resolution drop with DPR', () => {
    expect(msaaSamplesFor(1)).toBe(4);
    expect(msaaSamplesFor(1.25)).toBe(2);
    expect(msaaSamplesFor(2)).toBe(0);
    expect(bloomScaleFor(2, 0)).toBe(1);
    expect(bloomScaleFor(2, 1)).toBe(0.5);
    expect(bloomScaleFor(0.75, 0)).toBe(0.75);
  });
});

describe('cloud noise', () => {
  it('is deterministic and tiles seamlessly', () => {
    const n = 64;
    const a = tileableFbm(n, 3);
    expect(tileableFbm(n, 3)).toEqual(a);
    let edge = 0;
    let inner = 0;
    for (let y = 0; y < n; y++) {
      edge += Math.abs(a[y * n + (n - 1)]! - a[y * n]!);
      inner += Math.abs(a[y * n + 10]! - a[y * n + 11]!);
    }
    expect(edge).toBeLessThan(inner * 3 + n * 2);
    const min = Math.min(...a);
    const max = Math.max(...a);
    expect(max - min).toBeGreaterThan(60);
  });
});

describe('user quality tiers', () => {
  it('map high / medium / low onto tiers 0 / 1 / 2 and scale the extras', () => {
    expect(['high', 'medium', 'low'].map(userTier)).toEqual([0, 1, 2]);
    expect([0, 1, 2].map(bloomMipsFor)).toEqual([5, 4, 3]);
    expect([0, 1, 2].map(rainPoolFor)).toEqual([RAIN.maxDrops, RAIN.maxDrops / 2, 0]);
    expect([0, 1, 2].map(skyExtrasFor)).toEqual([true, true, false]);
  });
});
