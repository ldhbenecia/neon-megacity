import { expect, test, type Page } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import { CITY } from '../../src/city/layout';
import { CAMERA_LIMITS, CAMERA_RING } from '../../src/core/query';
import { app, waitForCity, waitFrames } from './helpers';

type Cam = ReturnType<NonNullable<Window['__hangang']>['camera']>;

async function cam(page: Page): Promise<Cam> {
  return page.evaluate(() => window.__hangang!.camera());
}

const orbit = (c: Cam): number =>
  Math.hypot(c.position.x - c.target.x, c.position.y - c.target.y, c.position.z - c.target.z);

/** Waits until the damped zoom has come to rest. */
async function settled(page: Page): Promise<Cam> {
  let prev = orbit(await cam(page));
  for (let i = 0; i < 40; i++) {
    await waitFrames(page, 5);
    const c = await cam(page);
    if (Math.abs(orbit(c) - prev) < prev * 0.002) return c;
    prev = orbit(c);
  }
  return cam(page);
}

/**
 * Trackpad-like stream: many small wheel deltas in one burst. Dispatched in the page because a
 * page.mouse.wheel round trip costs seconds under software GL (CI).
 */
async function stream(
  page: Page,
  deltaY: number,
  count: number,
  ctrlKey = false,
  at = { fx: 0.5, fy: 0.5 },
): Promise<void> {
  await page.evaluate(
    ({ deltaY, count, ctrlKey, at }) => {
      const canvas = document.querySelector('#app canvas')!;
      const r = canvas.getBoundingClientRect();
      for (let i = 0; i < count; i++) {
        canvas.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY,
            ctrlKey,
            clientX: r.left + r.width * at.fx,
            clientY: r.top + r.height * at.fy,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    },
    { deltaY, count, ctrlKey, at },
  );
}

test.describe('zoom out', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(app('nogui&stats&preset=1&time=0'));
    await waitForCity(page);
    const vp = page.viewportSize()!;
    await page.mouse.move(vp.width / 2, vp.height / 2);
  });

  test('a mouse notch keeps its step (~1.27x)', async ({ page }) => {
    const before = orbit(await cam(page));
    await page.mouse.wheel(0, 100);
    const ratio = orbit(await settled(page)) / before;
    expect(ratio).toBeGreaterThan(1.15);
    expect(ratio).toBeLessThan(1.4);
  });

  test('a one-second two-finger scroll pulls back at least 2.5x', async ({ page }) => {
    test.setTimeout(180_000);
    const before = orbit(await cam(page));
    await stream(page, 8, 60);
    const after = orbit(await settled(page));
    expect(after).toBeGreaterThanOrEqual(Math.min(before * 2.5, CAMERA_LIMITS.maxDistance - 1));
  });

  test('a one-second pinch (ctrl + wheel) pulls back at least 2.5x', async ({ page }) => {
    test.setTimeout(180_000);
    const before = orbit(await cam(page));
    await stream(page, 2, 60, true);
    const after = orbit(await settled(page));
    expect(after).toBeGreaterThanOrEqual(Math.min(before * 2.5, CAMERA_LIMITS.maxDistance - 1));
  });

  test('a low zoom-out stops at the ridge ring around the orbit target, cursor anywhere', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const before = await cam(page);
    await stream(page, 600, 20, false, { fx: 0.97, fy: 0.9 });
    const c = await settled(page);
    expect(Math.hypot(c.position.x, c.position.z)).toBeLessThanOrEqual(CAMERA_RING + 1);
    expect(Math.hypot(c.target.x - before.target.x, c.target.z - before.target.z)).toBeLessThan(1);
    expect(orbit(c)).toBeGreaterThan(orbit(before));
    // A zoom-in right after reaching the limit reacts at once.
    await page.mouse.wheel(0, -100);
    expect(orbit(await settled(page))).toBeLessThan(orbit(c) * 0.9);
  });
});

test('from above, zoom-out reaches the limit with the whole map in view', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(app('nogui&stats&cam=topdown&time=0'));
  await waitForCity(page);
  await stream(page, 600, 20);
  const c = await settled(page);
  expect(orbit(c)).toBeGreaterThan(CAMERA_LIMITS.maxDistance * 0.97);
  expect(orbit(c)).toBeLessThanOrEqual(CAMERA_LIMITS.maxDistance + 1);
  const vp = page.viewportSize()!;
  const camera = new PerspectiveCamera(c.fov, vp.width / vp.height, 0.5, 20000);
  camera.position.set(c.position.x, c.position.y, c.position.z);
  camera.lookAt(c.target.x, c.target.y, c.target.z);
  camera.updateMatrixWorld();
  const hx = CITY.extentX / 2;
  const hz = CITY.extentZ / 2;
  for (const [x, z] of [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ] as const) {
    const p = new Vector3(x, 0, z).project(camera);
    expect(Math.abs(p.x), `corner ${x},${z} x`).toBeLessThanOrEqual(1);
    expect(Math.abs(p.y), `corner ${x},${z} y`).toBeLessThanOrEqual(1);
  }
});
