import { describe, expect, it } from 'vitest';
import { LUM_MIN, MOVE_BLACK_MAX, REST_BLACK_MAX, judgeScreen } from '../scripts/screen';

const ok = { frames: 60, maxBlack: 10, minLum: 20 };

describe('judgeScreen', () => {
  it('passes a normal night scene', () => {
    expect(judgeScreen(ok, { ...ok, maxBlack: 16 })).toEqual([]);
  });

  it('fails a black rectangle at rest and a black flash while moving', () => {
    expect(judgeScreen({ ...ok, maxBlack: REST_BLACK_MAX + 1 }, ok)).toHaveLength(1);
    expect(judgeScreen(ok, { ...ok, maxBlack: MOVE_BLACK_MAX + 1 })).toHaveLength(1);
    // The rest limit is stricter than the move limit.
    expect(judgeScreen(ok, { ...ok, maxBlack: REST_BLACK_MAX + 1 })).toEqual([]);
  });

  it('fails a frame that is dark overall and a phase with no frames', () => {
    expect(judgeScreen(ok, { ...ok, minLum: LUM_MIN - 0.1 })).toHaveLength(1);
    expect(judgeScreen({ frames: 0, maxBlack: 0, minLum: 255 }, ok)[0]).toMatch(/no frames/);
  });
});
