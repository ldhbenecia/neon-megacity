import { describe, expect, it } from 'vitest';
import './setup-layout';
import { LABEL_FADE, labelAlpha, labelZones, placeLabels } from '../src/ux/zoneLabels';

describe('zone labels', () => {
  it('fade in only high above the ground', () => {
    expect(labelAlpha(9)).toBe(0);
    expect(labelAlpha(LABEL_FADE[0])).toBe(0);
    expect(labelAlpha((LABEL_FADE[0] + LABEL_FADE[1]) / 2)).toBeCloseTo(0.5);
    expect(labelAlpha(LABEL_FADE[1])).toBe(1);
    expect(labelAlpha(3000)).toBe(1);
  });

  it('label 8 to 10 main quarters, each once', () => {
    const zones = labelZones();
    expect(zones.length).toBeGreaterThanOrEqual(8);
    expect(zones.length).toBeLessThanOrEqual(10);
    expect(new Set(zones.map((z) => z.id)).size).toBe(zones.length);
    expect(zones.map((z) => z.name)).toEqual(expect.arrayContaining(['여의도']));
  });

  it('drop labels off screen, over a panel, or over a label placed before them', () => {
    const box = (x: number, y: number) => ({ x, y, w: 60, h: 20 });
    expect(
      placeLabels(
        [box(0, 0), box(30, 10), null, box(500, 500), box(200, 0)],
        [{ x: 480, y: 480, w: 100, h: 100 }],
      ),
    ).toEqual([true, false, false, false, true]);
  });
});
