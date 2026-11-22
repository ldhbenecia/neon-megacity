import { describe, expect, it } from 'vitest';
import { clockMinutes, formatClock } from '../src/core/clock';

describe('clock', () => {
  it('formats key times of day', () => {
    expect(formatClock(clockMinutes(0))).toBe('00:00');
    expect(formatClock(clockMinutes(0.25))).toBe('06:00');
    expect(formatClock(clockMinutes(0.5))).toBe('12:00');
    expect(formatClock(clockMinutes(0.999))).toBe('23:58');
  });

  it('wraps 1.0 and out-of-range values instead of showing 24:00', () => {
    expect(formatClock(clockMinutes(1))).toBe('00:00');
    expect(formatClock(clockMinutes(1.5))).toBe('12:00');
    expect(formatClock(clockMinutes(-0.25))).toBe('18:00');
  });
});
