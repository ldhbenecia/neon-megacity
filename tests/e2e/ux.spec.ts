import { expect, test, type Page } from '@playwright/test';
import { collectErrors, waitForCity, waitFrames } from './helpers';

// Boot skeleton, HUD and camera rig controls (ART_DIRECTION 8, 9, 10).
// Camera state is read through window.__ramha.camera(), available with ?stats.

type Cam = NonNullable<Window['__ramha']>;

async function cam(page: Page): Promise<ReturnType<Cam['camera']>> {
  return page.evaluate(() => {
    const r = window.__ramha;
    if (!r) throw new Error('__ramha missing (needs ?stats)');
    return r.camera();
  });
}

async function waitMode(page: Page, mode: string): Promise<void> {
  await page.waitForFunction((m) => window.__ramha?.camera().mode === m, mode, {
    timeout: 15_000,
  });
}

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('boot skeleton paints before JS and is removed after power-on', async ({ page }) => {
  // Without JS the static skeleton is all there is: logo, 28 skyline bars, 20-cell bar.
  const ctx = await page.context().browser()?.newContext();
  if (ctx) {
    const noJs = await ctx.newPage();
    await noJs.route('**/*.js', (r) => r.abort());
    await noJs.goto('./');
    await expect(noJs.locator('#boot .boot-neon')).toHaveText('람하');
    await expect(noJs.locator('#boot .boot-skyline > span')).toHaveCount(28);
    await expect(noJs.locator('#boot .boot-pct')).toHaveText('000%');
    await ctx.close();
  }

  const errors = collectErrors(page);
  const seen: number[] = [];
  await page.exposeFunction('__bootProgress', (p: number) => seen.push(p));
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const p = document.getElementById('boot')?.dataset.progress;
      const report = (window as unknown as { __bootProgress?: (n: number) => void }).__bootProgress;
      if (p !== undefined && report) report(Number(p));
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-progress'] });
  });
  await page.goto('./?nogui');
  await waitForCity(page);
  await expect(page.locator('#boot')).toHaveCount(0);
  // Real, monotonic progress that ends at 100.
  expect(seen.length).toBeGreaterThan(3);
  expect(seen.at(-1)).toBe(100);
  expect(seen).toEqual([...seen].sort((a, b) => a - b));
  expect(errors).toEqual([]);
});

test('HUD shows the title, clock, help and an inline SVG favicon', async ({ page }) => {
  await page.goto('./?nogui&time=0.25');
  await waitForCity(page);
  await expect(page.locator('.hud-title')).toHaveText(/RAMHA\s*\/\/\s*嵐河/);
  await expect(page.locator('#clock')).toHaveText('06:00');
  await expect(page.locator('#hud-help')).toContainText('비행 모드');
  const href = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(href).toMatch(/^data:image\/svg\+xml,/);
  await page.keyboard.press('h');
  await expect(page.locator('#hud')).toHaveClass(/is-hidden/);
  await page.keyboard.press('h');
  await expect(page.locator('#hud')).not.toHaveClass(/is-hidden/);
});

test('?hud=0 starts hidden', async ({ page }) => {
  await page.goto('./?nogui&hud=0');
  await waitForCity(page);
  await expect(page.locator('#hud')).toHaveClass(/is-hidden/);
});

test.describe('camera rig', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./?nogui&stats&cam=overview&time=0.0');
    await waitForCity(page);
  });

  test('W moves camera and target forward together, E climbs', async ({ page }) => {
    const a = await cam(page);
    await page.keyboard.down('w');
    await page.waitForTimeout(600);
    await page.keyboard.up('w');
    await page.waitForTimeout(400);
    const b = await cam(page);
    const fx = a.target.x - a.position.x;
    const fz = a.target.z - a.position.z;
    const mx = b.position.x - a.position.x;
    const mz = b.position.z - a.position.z;
    expect(Math.hypot(mx, mz)).toBeGreaterThan(20);
    expect((fx * mx + fz * mz) / Math.hypot(fx, fz) / Math.hypot(mx, mz)).toBeGreaterThan(0.95);
    // The orbit offset is preserved while translating.
    expect(dist(b.position, b.target)).toBeCloseTo(dist(a.position, a.target), -1);

    await page.keyboard.down('e');
    await page.waitForTimeout(500);
    await page.keyboard.up('e');
    await page.waitForTimeout(300);
    expect((await cam(page)).position.y).toBeGreaterThan(b.position.y + 20);
  });

  test('wheel zooms smoothly toward the cursor', async ({ page }) => {
    const a = await cam(page);
    // Off-center cursor: the camera must drift toward that side, not only along the view axis.
    await page.mouse.move(900, 300);
    await page.mouse.wheel(0, -600);
    await waitFrames(page, 3);
    const mid = await cam(page);
    await page.waitForTimeout(800);
    const b = await cam(page);
    expect(dist(b.position, b.target)).toBeLessThan(dist(a.position, a.target) * 0.8);
    // Damped: still moving a few frames after the event.
    expect(dist(b.position, mid.position)).toBeGreaterThan(1);
    expect(b.mode).toBe('orbit');
  });

  test('left drag orbits around the target', async ({ page }) => {
    const a = await cam(page);
    await page.mouse.move(800, 450);
    await page.mouse.down();
    await page.mouse.move(1000, 450, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    const b = await cam(page);
    expect(dist(b.target, a.target)).toBeLessThan(1);
    expect(dist(b.position, a.position)).toBeGreaterThan(50);
    // A drag is not a click: nothing selected.
    expect(b.selected).toBeNull();
  });

  test('clicking a building flies to it and shows the card; Esc clears it', async ({ page }) => {
    await page.mouse.click(800, 450);
    await waitMode(page, 'flight');
    await waitMode(page, 'orbit');
    const c = await cam(page);
    expect(c.selected).not.toBeNull();
    await expect(page.locator('#hud-card')).toHaveClass(/is-in/);
    await expect(page.locator('#hud-card [data-field="name"]')).not.toBeEmpty();
    await page.keyboard.press('Escape');
    await expect(page.locator('#hud-card')).not.toHaveClass(/is-in/);
    expect((await cam(page)).selected).toBeNull();
  });

  test('number keys fly to presets, R returns to preset 1', async ({ page }) => {
    await page.keyboard.press('8');
    await waitMode(page, 'flight');
    await waitMode(page, 'orbit');
    expect((await cam(page)).position.y).toBeGreaterThan(1800);
    await expect(page.locator('#hud-toast')).toContainText('탑다운');
    await page.keyboard.press('r');
    await waitMode(page, 'flight');
    await waitMode(page, 'orbit');
    const p = (await cam(page)).position;
    expect(dist(p, { x: -420, y: 38, z: 300 })).toBeLessThan(2);
  });

  test('F toggles fly mode, C toggles the cinematic and any input stops it', async ({ page }) => {
    await page.keyboard.press('f');
    await waitMode(page, 'fly');
    await expect(page.locator('#hud')).toHaveAttribute('data-mode', 'fly');
    const a = await cam(page);
    await page.keyboard.down('w');
    await page.waitForTimeout(500);
    await page.keyboard.up('w');
    expect(dist((await cam(page)).position, a.position)).toBeGreaterThan(20);
    await page.keyboard.press('f');
    await waitMode(page, 'orbit');

    await page.keyboard.press('c');
    await waitMode(page, 'cinematic');
    await waitFrames(page, 10);
    await page.keyboard.press('c');
    await waitMode(page, 'orbit');
    await page.keyboard.press('c');
    await waitMode(page, 'cinematic');
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.up();
    await waitMode(page, 'orbit');
  });

  test('camera never ends up inside the ground', async ({ page }) => {
    await page.keyboard.down('q');
    await page.keyboard.down('Shift');
    await page.waitForTimeout(2500);
    await page.keyboard.up('Shift');
    await page.keyboard.up('q');
    const c = await cam(page);
    expect(c.position.y).toBeGreaterThanOrEqual(-1.01);
    expect(c.target.y).toBeGreaterThanOrEqual(0.99);
  });
});
