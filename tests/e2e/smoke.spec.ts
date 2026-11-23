import { expect, test } from '@playwright/test';
import {
  SETTLE_FRAMES,
  app,
  canvasStats,
  collectErrors,
  scrubTo,
  waitForCity,
  waitFrames,
} from './helpers';

// Lighting draws the sky dome, so even with the other modules still stubbed the frame has a
// time-of-day gradient. Flip back to false only if nothing renders at all.
const MODULES_RENDER = true;

test('loads with zero console errors and renders frames', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(app());
  await waitForCity(page);
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.lil-gui').first()).toBeAttached();
  await expect(page.locator('#clock')).toHaveText(/^\d{2}:\d{2}$/);
  expect(errors).toEqual([]);
});

test('?nogui hides the control panel', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(app('nogui&cam=street&time=0.5&rain=0'));
  await waitForCity(page);
  await expect(page.locator('.lil-gui.lil-root')).toBeHidden();
  await expect(page.locator('#clock')).toHaveText('12:00');
  expect(errors).toEqual([]);
});

test('canvas is not blank', async ({ page }) => {
  test.fixme(!MODULES_RENDER, 'stub modules render an empty scene');
  await page.goto(app('nogui&cam=overview&time=0.9'));
  await waitForCity(page);
  const stats = await canvasStats(page);
  expect(stats.distinct).toBeGreaterThan(50);
});

test('noon is brighter than midnight', async ({ page }) => {
  test.fixme(!MODULES_RENDER, 'stub modules render an empty scene');
  // Booted at noon (checks the ?time=0.5 boot path renders a lit frame), then scrubbed to midnight.
  await page.goto(app('nogui&cam=overview&time=0.5'));
  await waitForCity(page);
  const noon = await canvasStats(page);
  await scrubTo(page, 0);
  await waitFrames(page, SETTLE_FRAMES);
  const night = await canvasStats(page);
  expect(noon.mean).toBeGreaterThan(night.mean + 10);
});
