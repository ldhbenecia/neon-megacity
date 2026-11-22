import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../src/city/layout';
import { CAMERA_PRESETS, parseQuery } from '../src/core/query';

describe('parseQuery', () => {
  it('returns defaults for an empty query', () => {
    expect(parseQuery('')).toEqual({ nogui: false });
  });

  it('parses and clamps numeric params', () => {
    expect(parseQuery('?time=0.5&rain=2')).toEqual({ time: 0.5, rain: 1, nogui: false });
    expect(parseQuery('?time=-1').time).toBe(0);
  });

  it('ignores invalid values', () => {
    expect(parseQuery('?time=abc&rain=&cam=nope')).toEqual({ nogui: false });
    expect(parseQuery('?cam=toString').cam).toBeUndefined();
  });

  it('accepts camera presets and the nogui flag', () => {
    expect(parseQuery('?cam=street&nogui')).toEqual({ cam: 'street', nogui: true });
  });
});

describe('CAMERA_PRESETS', () => {
  it('places the street camera on the center line of a north-south road', () => {
    const [x] = CAMERA_PRESETS.street.position;
    const road = LAYOUT.roads.find((r) => r.axis === 'z' && r.x === x);
    expect(road).toBeDefined();
    expect(CAMERA_PRESETS.street.target[0]).toBe(x);
  });
});
