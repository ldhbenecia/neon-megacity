import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../src/city/layout';
import { CAMERA_LIMITS } from '../src/core/query';
import { RAIN_STEPS, rainStep } from '../src/ux/controls';
import { AdaptiveDpr } from '../src/ux/dpr';
import {
  ARCHETYPE_FALLBACK,
  ARCHETYPE_KO,
  DISTRICT_FALLBACK,
  DISTRICT_KO,
  archetypeLabel,
  buildingCard,
  zoneLabel,
} from '../src/ux/hud';
import {
  activeSegment,
  createProgress,
  finish,
  formatPercent,
  progressFraction,
  startStage,
} from '../src/ux/progress';
import { parseUxQuery } from '../src/ux/query';

describe('boot progress (9.2)', () => {
  it('counts finished stages over the total weight', () => {
    let s = createProgress();
    expect(progressFraction(s, 100)).toBe(0);
    s = startStage(s, 'setup', 5);
    expect(progressFraction(s, 100)).toBe(0);
    s = startStage(s, 'lighting', 8);
    expect(progressFraction(s, 100)).toBeCloseTo(0.05);
    s = startStage(s, 'terrain', 8);
    expect(progressFraction(s, 100)).toBeCloseTo(0.13);
    s = finish(s);
    expect(progressFraction(s, 100)).toBe(1);
  });

  it('normalizes when the declared weights exceed the plan, ignores repeats', () => {
    let s = createProgress();
    s = startStage(s, 'a', 80);
    s = startStage(s, 'a', 80);
    s = startStage(s, 'b', 80);
    expect(s.stages).toHaveLength(2);
    expect(progressFraction(s, 100)).toBeCloseTo(0.5);
  });

  it('formats a fixed-width percent and the active segment', () => {
    expect(formatPercent(0.42)).toBe('042%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(-1)).toBe('000%');
    expect(activeSegment(0, 20)).toBe(0);
    expect(activeSegment(0.42, 20)).toBe(8);
    expect(activeSegment(1, 20)).toBe(19);
  });
});

describe('adaptive DPR (11)', () => {
  const run = (d: AdaptiveDpr, ms: number, seconds: number): number[] => {
    const out: number[] = [];
    for (let t = 0; t < seconds; t += ms / 1000) {
      const v = d.sample(ms / 1000);
      if (v !== null) out.push(v);
    }
    return out;
  };

  it('starts at the cap and steps down by 0.25 when slow, never below 1', () => {
    const d = new AdaptiveDpr({ max: 1.5 });
    expect(d.dpr).toBe(1.5);
    expect(run(d, 30, 2.1)).toEqual([1.25]);
    run(d, 30, 10);
    expect(d.dpr).toBe(1);
  });

  it('recovers only after 5 s under 14 ms', () => {
    const d = new AdaptiveDpr({ max: 1.5 });
    run(d, 30, 2.1);
    expect(d.dpr).toBe(1.25);
    expect(run(d, 16, 10)).toEqual([]); // 16 ms is "ok", not "fast"
    expect(run(d, 8, 6.5)).toEqual([1.5]);
  });

  it('reset() restores the cap and starts a fresh window', () => {
    const d = new AdaptiveDpr({ max: 1.5 });
    run(d, 30, 2.1);
    expect(d.dpr).toBe(1.25);
    expect(d.reset()).toBe(1.5);
    expect(d.averageMs).toBe(0);
  });

  it('ignores hitches and respects a low device ratio', () => {
    const d = new AdaptiveDpr({ max: Math.min(1, 1.5) });
    expect(d.sample(5)).toBeNull();
    expect(run(d, 40, 5)).toEqual([]);
    expect(d.dpr).toBe(1);
  });
});

describe('parseUxQuery', () => {
  it('turns on the NaN view only together with ?debug', () => {
    expect(parseUxQuery('?debug&nan').nan).toBe(true);
    expect(parseUxQuery('?nan').nan).toBe(false);
    expect(parseUxQuery('?debug&nan=0').nan).toBe(false);
  });

  it('parses ?pose= only when it has 6 finite numbers', () => {
    expect(parseUxQuery('?pose=100,200,300,4,5,6').pose).toEqual({
      position: { x: 100, y: 200, z: 300 },
      target: { x: 4, y: 5, z: 6 },
    });
    expect(parseUxQuery('?pose=-10.5, 200 ,300,4,5,6').pose?.position.x).toBe(-10.5);
    expect(parseUxQuery('?pose=0,100,0,0,95,0').pose, 'closer than minDistance').toBeUndefined();
    const far = CAMERA_LIMITS.maxDistance + 100;
    expect(parseUxQuery(`?pose=0,${far},0,0,0,0`).pose, 'beyond maxDistance').toBeUndefined();
    expect(parseUxQuery(`?pose=0,${far - 200},0,0,0,0`).pose, 'inside maxDistance').toBeDefined();
    for (const bad of [
      '1,2,3,4,5',
      '1,2,3,4,5,6,7',
      '1,2,x,4,5,6',
      '1,,3,4,5,6',
      'Infinity,2,3,4,5,6',
    ]) {
      expect(parseUxQuery(`?pose=${bad}`).pose, bad).toBeUndefined();
    }
  });

  it('defaults', () => {
    expect(parseUxQuery('')).toEqual({ hud: true, stats: false, debug: false, nan: false });
  });
  it('parses preset, hud and stats', () => {
    expect(parseUxQuery('?preset=3&hud=0&stats=1&debug')).toEqual({
      preset: 3,
      hud: false,
      stats: true,
      debug: true,
      nan: false,
    });
    expect(parseUxQuery('?stats').stats).toBe(true);
    expect(parseUxQuery('?stats=0').stats).toBe(false);
    expect(parseUxQuery('?preset=9').preset).toBeUndefined();
    expect(parseUxQuery('?preset=1.5').preset).toBeUndefined();
  });
});

describe('building card (8.3)', () => {
  it('describes a building in Korean from the layout spec', () => {
    const b = LAYOUT.buildings.find((x) => x.tags.corp) ?? LAYOUT.buildings[0]!;
    const card = buildingCard(b);
    expect(card.name).toBe(b.tags.name);
    expect(card.height).toBe(`${Math.round(b.h + b.spireH)} m`);
    expect(card.floors).toBe(`${b.floors}층`);
    expect(card.archetype).toBe(ARCHETYPE_KO[b.archetype]);
    expect(card.zone.length).toBeGreaterThan(0);
  });

  it('has a specific label for every archetype and district kind the layout uses', () => {
    for (const a of new Set(LAYOUT.buildings.map((b) => b.archetype))) {
      expect(archetypeLabel(a), a).not.toBe(ARCHETYPE_FALLBACK);
    }
    for (const z of LAYOUT.districts) {
      expect(zoneLabel({ districts: [] }, z.id, z.kind), z.kind).not.toBe(DISTRICT_FALLBACK);
      expect(z.name, z.id).not.toBe('');
    }
  });

  it('labels layout v3 archetypes and falls back for unknown ones', () => {
    expect(archetypeLabel('setbackTower')).toBe('셋백 타워');
    expect(archetypeLabel('domeArena')).toBe(ARCHETYPE_FALLBACK);
    expect(archetypeLabel('toString')).toBe(ARCHETYPE_FALLBACK);
  });

  it('falls back from zone name to district kind to a generic label', () => {
    const L = { districts: [{ ...LAYOUT.districts[0]!, id: 'z1', name: '여의도' }] };
    expect(zoneLabel(L, 'z1', 'megacore')).toBe('여의도');
    expect(zoneLabel(L, 'unknown', 'nightlife')).toBe(DISTRICT_KO.nightlife);
    expect(zoneLabel(L, 'unknown', 'spaceport')).toBe(DISTRICT_FALLBACK);
    const b = { ...LAYOUT.buildings[0]!, zoneId: 'gone', district: 'spaceport', archetype: 'x' };
    // @ts-expect-error simulates a newer layout whose kinds ux does not know yet
    const card = buildingCard(b, L);
    expect(card.zone).toBe(DISTRICT_FALLBACK);
    expect(card.archetype).toBe(ARCHETYPE_FALLBACK);
  });
});

describe('weather steps', () => {
  it('maps any rain value to the nearest of clear / rain / storm', () => {
    expect(RAIN_STEPS).toEqual([0, 0.35, 1]);
    expect(rainStep(0)).toBe(0);
    expect(rainStep(0.1)).toBe(0);
    expect(rainStep(0.4)).toBe(1);
    expect(rainStep(0.8)).toBe(2);
  });
});
