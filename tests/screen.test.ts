import { describe, expect, it } from 'vitest';
import { BLACK_MAX, LUM_MIN, judgeScreen, lightAt } from '../scripts/screen';

const ok = { frames: 60, maxBlack: 10, minLum: 20 };

describe('judgeScreen', () => {
  it('passes normal scenes, including dark night views', () => {
    expect(judgeScreen(ok, { ...ok, maxBlack: 16 }, 'day')).toEqual([]);
    expect(judgeScreen({ ...ok, maxBlack: 76 }, { ...ok, maxBlack: 68 }, 'night')).toEqual([]);
  });

  it('fails a black rectangle by day and a black flash while moving', () => {
    expect(judgeScreen({ ...ok, maxBlack: BLACK_MAX.day.rest + 1 }, ok, 'day')).toHaveLength(1);
    expect(judgeScreen(ok, { ...ok, maxBlack: BLACK_MAX.day.move + 1 }, 'day')).toHaveLength(1);
    expect(judgeScreen(ok, { ...ok, maxBlack: BLACK_MAX.night.move + 1 }, 'night')).toHaveLength(1);
  });

  it('fails a frame that is dark overall and a phase with no frames', () => {
    expect(judgeScreen(ok, { ...ok, minLum: LUM_MIN - 0.1 }, 'night')).toHaveLength(1);
    expect(judgeScreen({ frames: 0, maxBlack: 0, minLum: 255 }, ok, 'day')[0]).toMatch(/no frames/);
  });
});

describe('lightAt', () => {
  it('uses night limits before 05:00 and after 20:00', () => {
    expect(lightAt(0)).toBe('night');
    expect(lightAt(0.5)).toBe('day');
    expect(lightAt(0.78)).toBe('day');
    expect(lightAt(0.9)).toBe('night');
  });
});
