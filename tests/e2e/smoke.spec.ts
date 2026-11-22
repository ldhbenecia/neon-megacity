import { expect, test } from '@playwright/test';
import { canvasStats, collectErrors, waitForCity } from './helpers';

// The feature modules are still placeholder stubs that add nothing to the scene,
// so the frame is uniformly black. These visual checks are switched on by the
// lighting module PR, which is the first one that renders anything.
const MODULES_RENDER = false;

test('loads with zero console errors and renders frames', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await waitForCity(page);
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.lil-gui').first()).toBeAttached();
  await expect(page.locator('#clock')).toHaveText(/^\d{2}:\d{2}$/);
  expect(errors).toEqual([]);
});

test('?nogui hides the control panel', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./?nogui&cam=street&time=0.5&rain=0');
  await waitForCity(page);
  await expect(page.locator('.lil-gui.lil-root')).toBeHidden();
  await expect(page.locator('#clock')).toHaveText('12:00');
  expect(errors).toEqual([]);
});

test('canvas is not blank', async ({ page }) => {
  test.fixme(!MODULES_RENDER, 'stub modules render an empty scene');
  await page.goto('./?nogui&cam=overview&time=0.9');
  await waitForCity(page);
  const stats = await canvasStats(page);
  expect(stats.distinct).toBeGreaterThan(50);
});

test('noon is brighter than midnight', async ({ page }) => {
  test.fixme(!MODULES_RENDER, 'stub modules render an empty scene');
  await page.goto('./?nogui&cam=overview&time=0.0');
  await waitForCity(page);
  const night = await canvasStats(page);
  await page.goto('./?nogui&cam=overview&time=0.5');
  await waitForCity(page);
  const noon = await canvasStats(page);
  expect(noon.mean).toBeGreaterThan(night.mean + 10);
});
