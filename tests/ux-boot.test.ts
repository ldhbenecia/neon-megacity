import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../src/city/layout';
import { AdaptiveDpr } from '../src/ux/dpr';
import { ARCHETYPE_KO, buildingCard } from '../src/ux/hud';
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

  it('ignores hitches and respects a low device ratio', () => {
    const d = new AdaptiveDpr({ max: Math.min(1, 1.5) });
    expect(d.sample(5)).toBeNull();
    expect(run(d, 40, 5)).toEqual([]);
    expect(d.dpr).toBe(1);
  });
});

describe('parseUxQuery', () => {
  it('defaults', () => {
    expect(parseUxQuery('')).toEqual({ hud: true, stats: false });
  });
  it('parses preset, hud and stats', () => {
    expect(parseUxQuery('?preset=3&hud=0&stats=1')).toEqual({ preset: 3, hud: false, stats: true });
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
});
