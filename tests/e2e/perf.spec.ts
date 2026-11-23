import { expect, test, type Page } from '@playwright/test';
import { app, collectErrors, waitForCity, waitFrames } from './helpers';

// Performance budget (ART_DIRECTION 11): counts only, headless fps means nothing.
// The preset × time grid runs in the low tier (a floor: no shadow or post passes); one boot at
// full quality checks the scene that is worst for the budget (noon, shadow pass included).
const LIMITS = { calls: 300, triangles: 2_000_000, programs: 50 } as const;
const PRESETS = [1, 2, 3, 5] as const;
/** Timeline minutes (the range steps by 5): 00:00, 18:45 (sunset, t = 0.781), 12:00. */
const TIMES = [0, 1125, 720] as const;
// Enough for the lazy PMREM bake and env key switch after a time change.
const SETTLE_FRAMES = 12;
const LOW_DPR = 0.5;

type Hangang = NonNullable<Window['__hangang']>;
type Stats = ReturnType<Hangang['stats']>;

async function stats(page: Page): Promise<Stats> {
  return page.evaluate(() => {
    const r = window.__hangang;
    if (!r) throw new Error('__hangang missing');
    return r.stats();
  });
}

function checkBudget(s: Stats, label: string): void {
  test.info().annotations.push({ type: 'stats', description: `${label} ${JSON.stringify(s)}` });
  expect.soft(s.calls, `calls @ ${label}`).toBeLessThanOrEqual(LIMITS.calls);
  expect.soft(s.triangles, `triangles @ ${label}`).toBeLessThanOrEqual(LIMITS.triangles);
  expect.soft(s.programs, `programs @ ${label}`).toBeLessThanOrEqual(LIMITS.programs);
}

const clock = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

test.describe('performance budget', () => {
  test.describe.configure({ mode: 'parallel' });

  test('full quality: preset 2 @ noon', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./?nogui&stats&preset=2&time=0.5&rain=0.35');
    await waitForCity(page);
    await waitFrames(page, SETTLE_FRAMES);
    checkBudget(await stats(page), 'full noon');
    expect(errors).toEqual([]);
  });

  for (const preset of PRESETS) {
    test(`low: preset ${preset} @ ${TIMES.map(clock).join(', ')}`, async ({ page }) => {
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
        checkBudget(s, clock(minutes));
        expect.soft(s.dpr, 'low tier DPR').toBe(LOW_DPR);
      }
      expect(errors).toEqual([]);
    });
  }
});
