import { expect, test, type Page } from '@playwright/test';
import { formatClock } from '../../src/core/clock';
import { LOW_DPR } from '../../src/ux/perf';
import { SETTLE_FRAMES, app, collectErrors, scrubTo, waitForCity, waitFrames } from './helpers';

// Performance budget (ART_DIRECTION 11): counts only, headless fps means nothing.
// The view × time grid runs in the low tier (a floor: no shadow or post passes); one boot at
// full quality checks the worst view, topdown, at noon: the shadow pass runs by day (night has
// 2 more calls but no shadow pass; docs/PERF.md snapshot c546911).
// The same views as `npm run perf`: number-key presets and the ?cam= poses.
const LIMITS = { calls: 300, triangles: 2_000_000, programs: 50 } as const;
const VIEWS = [
  'preset=1',
  'preset=2',
  'preset=6',
  'preset=7',
  'cam=overview',
  'cam=topdown',
] as const;
/** Timeline minutes (the range steps by 5): 00:00, 18:45 (sunset, t = 0.781), 12:00. */
const TIMES = [0, 1125, 720] as const;

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

test.describe('performance budget', () => {
  test.describe.configure({ mode: 'parallel' });

  test('full quality: topdown @ noon', async ({ page }) => {
    const errors = collectErrors(page);
    // A manual pick: no GPU guess (SwiftShader would be 'low') and no automatic changes.
    await page.goto('./?nogui&stats&cam=topdown&time=0.5&rain=0.35&quality=high');
    await waitForCity(page);
    await waitFrames(page, SETTLE_FRAMES);
    const s = await stats(page);
    expect(s.tier).toBe('high');
    checkBudget(s, 'full noon');
    expect(errors).toEqual([]);
  });

  for (const view of VIEWS) {
    test(`low: ${view} @ ${TIMES.map(formatClock).join(', ')}`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto(app(`nogui&stats&${view}&time=0&rain=0.35`));
      await waitForCity(page);
      for (const minutes of TIMES) {
        await scrubTo(page, minutes);
        await waitFrames(page, SETTLE_FRAMES);
        const s = await stats(page);
        checkBudget(s, formatClock(minutes));
        expect.soft(s.dpr, 'ci tier DPR').toBe(LOW_DPR);
      }
      expect(errors).toEqual([]);
    });
  }
});
