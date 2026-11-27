import { expect, test, type Page } from '@playwright/test';
import { app, waitForCity, waitFrames } from './helpers';

// Floating HUD surfaces that must never cover each other. The toast is left out on purpose:
// it is a short-lived announcement drawn above everything.
const SURFACES = [
  '.hud-brand',
  '#panel-toggle',
  '#panel',
  '#hud-card',
  '#timeline',
  '#help',
  '#hud-hint',
  '.touch-pad',
  '#hud-stats',
] as const;

interface Box {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

async function settle(page: Page): Promise<void> {
  // HUD transitions run on wall-clock CSS time, not frames.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect instanceof KeyframeEffect && a.effect.target instanceof Element)
        .filter((a) => (a.effect as KeyframeEffect).target!.closest('#hud'))
        .map((a) => a.finished),
    ),
  );
  await waitFrames(page, 2);
}

async function visibleBoxes(page: Page): Promise<Box[]> {
  return page.evaluate((selectors) => {
    const out: Box[] = [];
    for (const sel of selectors) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) continue;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.05) {
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      out.push({ name: sel, x: r.left, y: r.top, w: r.width, h: r.height });
    }
    return out;
  }, SURFACES);
}

async function expectNoOverlap(page: Page, step: string): Promise<void> {
  await settle(page);
  const boxes = await visibleBoxes(page);
  const vw = page.viewportSize()!;
  for (const b of boxes) {
    expect(b.x, `${step}: ${b.name} off the left edge`).toBeGreaterThanOrEqual(-0.5);
    expect(b.y, `${step}: ${b.name} off the top edge`).toBeGreaterThanOrEqual(-0.5);
    expect(b.x + b.w, `${step}: ${b.name} off the right edge`).toBeLessThanOrEqual(vw.width + 0.5);
    expect(b.y + b.h, `${step}: ${b.name} off the bottom edge`).toBeLessThanOrEqual(
      vw.height + 0.5,
    );
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      expect(
        ix > 1 && iy > 1,
        `${step}: ${a.name} overlaps ${b.name} ${JSON.stringify([a, b])}`,
      ).toBe(false);
    }
  }
}

async function selectBuilding(page: Page): Promise<void> {
  const at = await page.evaluate(() => window.__hangang?.buildingPoint() ?? null);
  expect(at, 'no building under an uncovered canvas point').not.toBeNull();
  await page.mouse.click(at!.x, at!.y);
  await page.waitForFunction(
    () =>
      window.__hangang?.camera().mode === 'orbit' &&
      document.getElementById('hud-card')?.hidden === false,
    undefined,
    { timeout: 90_000 },
  );
}

async function waitMode(page: Page, mode: string): Promise<void> {
  await page.waitForFunction((m) => window.__hangang?.camera().mode === m, mode, {
    timeout: 90_000,
  });
}

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, touch: true },
  { name: 'phone landscape', width: 844, height: 390, touch: true },
  { name: 'tablet', width: 768, height: 1024, touch: true },
  { name: 'laptop', width: 1280, height: 720, touch: false },
  { name: 'desktop', width: 1600, height: 900, touch: false },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`floating HUD at ${vp.width}x${vp.height} (${vp.name})`, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.touch,
      isMobile: vp.touch,
    });

    test('panel, building card, help and timeline never cover each other', async ({ page }) => {
      test.setTimeout(240_000);
      await page.goto(app('nogui&stats&cam=overview&time=0'));
      await waitForCity(page);
      await expectNoOverlap(page, 'start');

      await page.click('#panel-toggle');
      await expect(page.locator('#panel')).toBeVisible();
      await expectNoOverlap(page, 'panel open');

      await selectBuilding(page);
      await expectNoOverlap(page, 'building selected');

      await page.click('#panel-toggle');
      await expect(page.locator('#panel')).toBeVisible();
      await expectNoOverlap(page, 'panel reopened with a selection');

      await page.click('#open-help');
      await expect(page.locator('#help')).toBeVisible();
      await expectNoOverlap(page, 'help open');

      await page.keyboard.press('Escape');
      await expect(page.locator('#help')).toBeHidden();
      await expectNoOverlap(page, 'help closed');
    });

    test('keyboard paths keep the same rules and Esc closes the topmost surface', async ({
      page,
    }) => {
      test.setTimeout(300_000);
      await page.goto(app('nogui&stats&cam=overview&time=0'));
      await waitForCity(page);
      const panel = page.locator('#panel');
      const help = page.locator('#help');
      const card = page.locator('#hud-card');

      await page.click('#panel-toggle');
      await page.keyboard.press('?');
      await expect(help).toBeVisible();
      await expect(panel).toBeHidden();
      await expectNoOverlap(page, '? over the panel');
      await page.click('#panel-toggle');
      await expect(panel).toBeVisible();
      await expect(help).toBeHidden();
      await expectNoOverlap(page, 'panel toggle over help');
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();

      await selectBuilding(page);
      await page.keyboard.press('?');
      await expect(help).toBeVisible();
      await expectNoOverlap(page, '? with a card');
      await page.keyboard.press('Escape');
      await expect(help).toBeHidden();
      await expect(card).toBeVisible();
      await page.click('#panel-toggle');
      await expectNoOverlap(page, 'panel with a card');
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(card).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(card).toBeHidden();

      await page.keyboard.press('3');
      await waitMode(page, 'flight');
      await waitMode(page, 'orbit');
      await expectNoOverlap(page, 'preset key');
      await page.keyboard.press('c');
      await waitMode(page, 'cinematic');
      await expectNoOverlap(page, 'cinematic');
      await page.keyboard.press('c');
      await page.keyboard.press('f');
      await waitMode(page, 'fly');
      await expectNoOverlap(page, 'fly mode');
      await page.keyboard.press('Escape');
      await waitMode(page, 'orbit');
    });
  });
}

for (const touch of [true, false]) {
  test.describe(`title row on ${touch ? 'touch' : 'mouse'} screens`, () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: touch, isMobile: touch });

    test('never reaches the panel toggle and never cuts the mode label', async ({ page }) => {
      test.setTimeout(240_000);
      // 용산 국제업무지구 is the longest zone name; fly mode adds its label to the same row.
      await page.goto(app('nogui&stats&district=yongsan&time=0'));
      await waitForCity(page);
      await expect(page.locator('#hud-district')).toHaveText('용산 국제업무지구');
      await page.keyboard.press('f');
      await waitMode(page, 'fly');
      for (const vp of [{ width: 320, height: 640 }, ...VIEWPORTS]) {
        const at = `${vp.width}x${vp.height}`;
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await expectNoOverlap(page, `title row at ${at}`);
        const row = await page.evaluate(() => {
          const brand = document.querySelector<HTMLElement>('.hud-brand')!;
          const toggle = document.getElementById('panel-toggle')!.getBoundingClientRect();
          const right = (id: string): number => {
            const el = document.getElementById(id);
            return el && !el.hidden ? el.getBoundingClientRect().right : 0;
          };
          return {
            overflow: brand.scrollWidth - brand.clientWidth,
            mode: right('hud-mode'),
            exit: right('hud-mode-exit'),
            toggle: toggle.left,
          };
        });
        expect(row.overflow, `title row overflows at ${at}`).toBeLessThanOrEqual(0.5);
        expect(row.mode, `mode label reaches the toggle at ${at}`).toBeLessThan(row.toggle);
        expect(row.exit, `× reaches the toggle at ${at}`).toBeLessThan(row.toggle);
      }
      const exit = page.locator('#hud-mode-exit');
      if (touch) {
        await expect(exit).toBeVisible();
        await exit.click();
        await waitMode(page, 'orbit');
      } else {
        await expect(exit).toBeHidden();
      }
    });
  });
}
