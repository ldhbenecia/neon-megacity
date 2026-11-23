import { expect, test, type Page } from '@playwright/test';
import { app, collectErrors, waitForCity, waitFrames } from './helpers';

// Performance budget (ART_DIRECTION 11): counts only, in the low tier (no shadow / post passes),
// so this is a floor. Full-quality counts and fps are measured on real hardware.
const LIMITS = { calls: 300, triangles: 2_000_000, programs: 50 } as const;
const PRESETS = [1, 2, 3, 5] as const;
/** Timeline minutes for time 0.0, 0.78 and 0.5 (the range steps by 5 minutes). */
const TIMES = [0, 1125, 720] as const;
// Shadow refresh runs within the first frames after a change; counts are stable after that.
const SETTLE_FRAMES = 12;

type Hangang = NonNullable<Window['__hangang']>;

async function stats(page: Page): Promise<ReturnType<Hangang['stats']>> {
  return page.evaluate(() => {
    const r = window.__hangang;
    if (!r) throw new Error('__hangang missing');
    return r.stats();
  });
}

test.describe('performance budget', () => {
  test.describe.configure({ mode: 'parallel' });

  for (const preset of PRESETS) {
    test(`preset ${preset} @ times 0, 0.78, 0.5`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto(app(`nogui&stats&preset=${preset}&time=0&rain=0.35`));
      await waitForCity(page);
      for (const minutes of TIMES) {
        // Input event directly: the timeline sits inside the HUD, which may be collapsed.
        await page.evaluate((m) => {
          const input = document.getElementById('tl-range');
          if (!(input instanceof HTMLInputElement)) throw new Error('#tl-range missing');
          input.value = String(m);
          input.dispatchEvent(new Event('input'));
        }, minutes);
        await waitFrames(page, SETTLE_FRAMES);
        const s = await stats(page);
        test.info().annotations.push({
          type: 'stats',
          description: `${minutes}min ${JSON.stringify(s)}`,
        });
        expect.soft(s.calls, `calls @ ${minutes}min`).toBeLessThanOrEqual(LIMITS.calls);
        expect.soft(s.triangles, `triangles @ ${minutes}min`).toBeLessThanOrEqual(LIMITS.triangles);
        expect.soft(s.programs, `programs @ ${minutes}min`).toBeLessThanOrEqual(LIMITS.programs);
        expect.soft(s.dpr).toBeLessThanOrEqual(1.5);
      }
      expect(errors).toEqual([]);
    });
  }
});
