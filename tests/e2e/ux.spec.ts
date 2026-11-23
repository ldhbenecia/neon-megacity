import { expect, test, type Page } from '@playwright/test';
import { app, collectErrors, waitForCity, waitFrames } from './helpers';

type Cam = NonNullable<Window['__hangang']>;

async function cam(page: Page): Promise<ReturnType<Cam['camera']>> {
  return page.evaluate(() => {
    const r = window.__hangang;
    if (!r) throw new Error('__hangang missing (needs ?stats)');
    return r.camera();
  });
}

async function waitMode(page: Page, mode: string): Promise<void> {
  await page.waitForFunction((m) => window.__hangang?.camera().mode === m, mode, {
    timeout: 60_000,
  });
}

type Metric = 'horizontal' | 'up' | 'distance' | 'zoom';

/**
 * Waits (condition, not wall-clock) until the camera moved from `from` along a metric; this is
 * the assertion itself. `amount` is metres, except for 'zoom': the orbit distance must drop below
 * `amount` × the start distance. SwiftShader runs a few fps and dt is capped at 0.1 s, so fixed
 * timeouts under-move. On timeout the error carries the start and current camera.
 */
async function waitMoved(
  page: Page,
  from: Awaited<ReturnType<typeof cam>>,
  metric: Metric,
  amount: number,
): Promise<void> {
  const wait = page.waitForFunction(
    ({ from, metric, min }) => {
      const c = window.__hangang?.camera();
      if (!c) return false;
      const dx = c.position.x - from.position.x;
      const dy = c.position.y - from.position.y;
      const dz = c.position.z - from.position.z;
      if (metric === 'horizontal') return Math.hypot(dx, dz) > min;
      if (metric === 'up') return dy > min;
      if (metric === 'distance') return Math.hypot(dx, dy, dz) > min;
      const d0 = Math.hypot(
        from.position.x - from.target.x,
        from.position.y - from.target.y,
        from.position.z - from.target.z,
      );
      const d1 = Math.hypot(
        c.position.x - c.target.x,
        c.position.y - c.target.y,
        c.position.z - c.target.z,
      );
      return d1 < d0 * min;
    },
    { from, metric, min: amount },
    { timeout: 60_000 },
  );
  try {
    await wait;
  } catch (err) {
    const now = await cam(page).catch(() => null);
    throw new Error(
      `camera did not move ${metric} ${amount}: from ${JSON.stringify(from.position)} ` +
        `to ${JSON.stringify(now?.position)}`,
      { cause: err },
    );
  }
}

/** Holds `key` until the camera moved by `amount` along `metric` (see waitMoved), then releases. */
async function holdUntil(page: Page, key: string, metric: Metric, amount: number): Promise<void> {
  const from = await cam(page);
  await page.keyboard.down(key);
  try {
    await waitMoved(page, from, metric, amount);
  } finally {
    await page.keyboard.up(key);
  }
}

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('boot skeleton paints before JS and is removed after power-on', async ({ page }) => {
  const ctx = await page.context().browser()?.newContext();
  if (ctx) {
    const noJs = await ctx.newPage();
    await noJs.route('**/*.js', (r) => r.abort());
    await noJs.goto('./');
    await expect(noJs.locator('#boot .boot-neon')).toHaveText('한강');
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
  await page.goto(app('nogui'));
  await waitForCity(page);
  await expect(page.locator('#boot')).toHaveCount(0);
  expect(seen.length).toBeGreaterThan(3);
  expect(seen.at(-1)).toBe(100);
  expect(seen).toEqual([...seen].sort((a, b) => a - b));
  expect(errors).toEqual([]);
});

test('HUD: brand mark, clock, help sheet on ?, inline SVG favicon', async ({ page }) => {
  await page.goto(app('nogui&time=0.25'));
  await waitForCity(page);
  await expect(page.locator('.brand-name')).toHaveText(/한강\s*\/\/\s*HANGANG/);
  await expect(page.locator('#clock')).toHaveText('06:00');
  await expect(page.locator('#help')).toBeHidden();
  await page.keyboard.press('Shift+Slash');
  await expect(page.locator('#help')).toBeVisible();
  await expect(page.locator('#help')).toContainText('비행 모드');
  await page.keyboard.press('Escape');
  await expect(page.locator('#help')).toBeHidden();
  const href = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(href).toMatch(/^data:image\/svg\+xml,/);
  await page.keyboard.press('h');
  await expect(page.locator('#hud')).toHaveClass(/is-hidden/);
  await page.keyboard.press('h');
  await expect(page.locator('#hud')).not.toHaveClass(/is-hidden/);
});

test('first entry shows a controls hint that fades out', async ({ page }) => {
  await page.goto(app('nogui'));
  await waitForCity(page);
  await expect(page.locator('#hud-hint')).toBeVisible();
  await expect(page.locator('#hud-hint')).toBeHidden({ timeout: 15_000 });
});

test('lil-gui is a developer panel: hidden by default, shown with ?debug', async ({ page }) => {
  await page.goto(app());
  await waitForCity(page);
  await expect(page.locator('.lil-gui.lil-root')).toBeHidden();
  await page.goto(app('debug'));
  await waitForCity(page);
  await expect(page.locator('.lil-gui.lil-root')).toBeVisible();
});

test.describe('city controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(app('stats&cam=overview&time=0.9'));
    await waitForCity(page);
  });

  test('panel opens from the top-right button and closes with Esc', async ({ page }) => {
    const toggle = page.locator('#panel-toggle');
    await expect(page.locator('#panel')).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#panel')).toBeVisible();
    await expect(page.locator('[data-rain="0.35"]')).toHaveAttribute('aria-checked', 'true');
    await page.locator('[data-rain="1"]').click();
    await expect(page.locator('[data-rain="1"]')).toHaveAttribute('aria-checked', 'true');
    const before = await cam(page);
    const box = await page.locator('#panel').boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, -600);
    await waitFrames(page, 10);
    expect(dist((await cam(page)).position, before.position)).toBeLessThan(0.01);
    await page.keyboard.press('Escape');
    await expect(page.locator('#panel')).toBeHidden();
    await expect(toggle).toBeFocused();
  });

  test('preset chips and the cinematic switch drive the camera', async ({ page }) => {
    await page.locator('#panel-toggle').click();
    await page.locator('[data-preset="8"]').click();
    await waitMode(page, 'flight');
    await waitMode(page, 'orbit');
    await expect(page.locator('[data-preset="8"]')).toHaveAttribute('aria-current', 'true');
    await page.locator('#sw-cinematic').click();
    await waitMode(page, 'cinematic');
    await expect(page.locator('#hud-mode')).toBeVisible();
    await page.locator('#panel-toggle').click();
    await expect(page.locator('#sw-cinematic')).toHaveAttribute('aria-checked', 'true');
    await page.locator('#sw-cinematic').click();
    await waitMode(page, 'orbit');
  });

  test('timeline scrubs the clock, tick marks jump, play toggles the cycle', async ({ page }) => {
    const play = page.locator('#tl-play');
    // ?time locks the cycle: the button offers "play".
    await expect(play).toHaveAttribute('aria-pressed', 'false');
    await page.locator('.tl-ticks [data-time="0.5"]').click();
    await expect(page.locator('#clock')).toHaveText('12:00');
    await page.locator('#tl-range').fill('1110');
    await expect(page.locator('#clock')).toHaveText('18:30');
    await play.click();
    await expect(play).toHaveAttribute('aria-pressed', 'true');
  });
});

test('?hud=0 starts hidden', async ({ page }) => {
  await page.goto(app('nogui&hud=0'));
  await waitForCity(page);
  await expect(page.locator('#hud')).toHaveClass(/is-hidden/);
});

test.describe('camera rig', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(app('nogui&stats&cam=overview&time=0.0'));
    await waitForCity(page);
  });

  test('W moves camera and target forward together, E climbs', async ({ page }) => {
    const a = await cam(page);
    await holdUntil(page, 'w', 'horizontal', 25);
    await waitFrames(page, 10);
    const b = await cam(page);
    const fx = a.target.x - a.position.x;
    const fz = a.target.z - a.position.z;
    const mx = b.position.x - a.position.x;
    const mz = b.position.z - a.position.z;
    expect((fx * mx + fz * mz) / Math.hypot(fx, fz) / Math.hypot(mx, mz)).toBeGreaterThan(0.95);
    expect(dist(b.position, b.target)).toBeCloseTo(dist(a.position, a.target), -1);

    await holdUntil(page, 'e', 'up', 20);
  });

  test('wheel zooms smoothly toward the cursor', async ({ page }) => {
    const a = await cam(page);
    // Off-center cursor: the camera must drift toward that side, not only along the view axis.
    await page.mouse.move(900, 300);
    await page.mouse.wheel(0, -600);
    await waitFrames(page, 3);
    const mid = await cam(page);
    await waitMoved(page, a, 'zoom', 0.8);
    await waitFrames(page, 10);
    const b = await cam(page);
    expect(dist(b.position, mid.position)).toBeGreaterThan(1);
    expect(b.mode).toBe('orbit');
  });

  test('left drag orbits around the target', async ({ page }) => {
    const a = await cam(page);
    await page.mouse.move(800, 450);
    await page.mouse.down();
    await page.mouse.move(1000, 450, { steps: 8 });
    await page.mouse.up();
    await waitMoved(page, a, 'distance', 50);
    const b = await cam(page);
    expect(dist(b.target, a.target)).toBeLessThan(1);
    expect(b.selected).toBeNull();
  });

  test('clicking a building flies to it and shows the card; Esc clears it', async ({ page }) => {
    await page.mouse.click(800, 450);
    await waitMode(page, 'flight');
    await waitMode(page, 'orbit');
    const c = await cam(page);
    expect(c.selected).not.toBeNull();
    await expect(page.locator('#hud-card')).toBeVisible();
    await expect(page.locator('#hud-card [data-field="name"]')).not.toBeEmpty();
    await page.keyboard.press('Escape');
    await expect(page.locator('#hud-card')).toBeHidden();
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
    await holdUntil(page, 'w', 'distance', 20);
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
    // Frames, not wall time: long enough to hit the floor at any frame rate.
    await waitFrames(page, 150);
    await page.keyboard.up('Shift');
    await page.keyboard.up('q');
    const c = await cam(page);
    expect(c.position.y).toBeGreaterThanOrEqual(-1.01);
    expect(c.target.y).toBeGreaterThanOrEqual(0.99);
  });
});
