import { expect, test, type Page } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import { CITY } from '../../src/city/layout';
import { CAMERA_LIMITS } from '../../src/core/query';
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

/** Trackpad-like stream: many small wheel deltas in quick succession (about one second). */
async function stream(page: Page, deltaY: number, count: number): Promise<void> {
  for (let i = 0; i < count; i++) await page.mouse.wheel(0, deltaY);
}

test.describe('zoom out', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(app('nogui&stats&cam=overview&time=0'));
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
    await page.keyboard.down('Control');
    await stream(page, 2, 60);
    await page.keyboard.up('Control');
    const after = orbit(await settled(page));
    expect(after).toBeGreaterThanOrEqual(Math.min(before * 2.5, CAMERA_LIMITS.maxDistance - 1));
  });

  test('stops at the limit with the whole map in view', async ({ page }) => {
    test.setTimeout(180_000);
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
    // A zoom-in right after reaching the limit reacts at once.
    await page.mouse.wheel(0, -100);
    expect(orbit(await settled(page))).toBeLessThan(orbit(c) * 0.9);
  });
});
