import { expect, it } from 'vitest';
import { CALLS, resetCalls } from '../src/city/calls';
import { generateLayout } from '../src/city/generate';

// Upper bounds at ~1.3x the counts measured when they were set (seed 2077, cold zone cache:
// terrainHeight 258 551 (forest and mountain-foot checks on streets, lots and slots since #151;
// generation 238 vs 223 ms median against main, 1.07x), surfaceHeight 6 904, zoneExact 58 613).
// Raise them deliberately, with a timing comparison against main, if a change needs more.
it('keeps the expensive layout queries per generation bounded', () => {
  resetCalls();
  generateLayout(2077);
  expect(CALLS.terrainHeight).toBeLessThanOrEqual(336_000);
  expect(CALLS.surfaceHeight).toBeLessThanOrEqual(9_000);
  expect(CALLS.zoneExact).toBeLessThanOrEqual(76_000);
}, 120_000);
