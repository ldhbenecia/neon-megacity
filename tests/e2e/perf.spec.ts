import { expect, test } from '@playwright/test';
import { collectErrors, waitForCity, waitFrames } from './helpers';

// Performance budget (ART_DIRECTION 11): counts only. Headless SwiftShader fps means nothing,
// so fps is measured by hand on real hardware and written in the PR body.
const LIMITS = { calls: 300, triangles: 2_000_000, programs: 50 } as const;
const PRESETS = [1, 2, 3, 5] as const;
const TIMES = [0.0, 0.78, 0.5] as const;

test.describe('performance budget', () => {
  test.describe.configure({ mode: 'parallel' });

  for (const preset of PRESETS) {
    for (const time of TIMES) {
      test(`preset ${preset} @ time ${time}`, async ({ page }) => {
        test.setTimeout(150_000);
        const errors = collectErrors(page);
        await page.goto(`./?nogui&stats&preset=${preset}&time=${time}&rain=0.35`);
        await waitForCity(page);
        await waitFrames(page, 120);
        const s = await page.evaluate(() => {
          const r = window.__hangang;
          if (!r) throw new Error('__hangang missing');
          return r.stats();
        });
        test.info().annotations.push({ type: 'stats', description: JSON.stringify(s) });
        expect(s.calls).toBeLessThanOrEqual(LIMITS.calls);
        expect(s.triangles).toBeLessThanOrEqual(LIMITS.triangles);
        expect(s.programs).toBeLessThanOrEqual(LIMITS.programs);
        expect(s.dpr).toBeLessThanOrEqual(1.5);
        expect(errors).toEqual([]);
      });
    }
  }
});
