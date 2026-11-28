import type { Page } from '@playwright/test';

const TOOL_OFFSET = { e2e: 0, shots: 1, perf: 2 } as const;
const TOOL_ENV = { e2e: 'E2E_PORT', shots: 'SHOTS_PORT', perf: 'PERF_PORT' } as const;

/**
 * Local preview port of a tool. Several worktrees run e2e, shots and perf at once, so a fixed port
 * would let one worktree test another's build. The env variable wins; otherwise the port is
 * derived from the working directory (stable per worktree, 4200–4979). Servers bind it with
 * strictPort and are never reused, so a clash fails instead of serving the wrong build.
 */
export function localPort(tool: keyof typeof TOOL_OFFSET, cwd = process.cwd()): number {
  const env = Number(process.env[TOOL_ENV[tool]]);
  if (Number.isInteger(env) && env > 0) return env;
  let h = 0x811c9dc5;
  for (let i = 0; i < cwd.length; i++) h = Math.imul(h ^ cwd.charCodeAt(i), 0x01000193) >>> 0;
  return 4200 + (h % 260) * 3 + TOOL_OFFSET[tool];
}

export const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

/**
 * App URL in the software-GL test tier (`?quality=ci`): the tests check behavior, not pixels,
 * and SwiftShader renders the full-quality city at a few frames per second.
 */
export function app(query = ''): string {
  return `./?quality=ci${query ? `&${query}` : ''}`;
}

/** Frames to let the scene settle after boot or a time change (env-map switch, lazy PMREM bake). */
export const SETTLE_FRAMES = 12;

/** Jumps the timeline (minutes) through its input event; fails if the range snaps the value. */
export async function scrubTo(page: Page, minutes: number): Promise<void> {
  await page.evaluate((m) => {
    const input = document.getElementById('tl-range');
    if (!(input instanceof HTMLInputElement)) throw new Error('#tl-range missing');
    input.value = String(m);
    if (input.value !== String(m)) throw new Error(`#tl-range snapped ${m} to ${input.value}`);
    input.dispatchEvent(new Event('input'));
  }, minutes);
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

const WAIT_MS = process.env.CI ? 240_000 : 60_000;

export async function waitForCity(page: Page, minFrames = 3): Promise<void> {
  await page.waitForFunction(
    (n) => (window.__city?.frames ?? 0) >= n && window.__city?.powered === true,
    minFrames,
    { timeout: WAIT_MS },
  );
}

export async function frameCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__city?.frames ?? 0);
}

export async function waitFrames(page: Page, n: number): Promise<void> {
  const start = await frameCount(page);
  await page.waitForFunction((target) => (window.__city?.frames ?? 0) >= target, start + n, {
    timeout: WAIT_MS,
  });
}

export interface PixelStats {
  mean: number;
  distinct: number;
}

/**
 * Screenshots the WebGL canvas and computes luminance statistics in the page
 * (decoding the PNG with a 2D canvas avoids preserveDrawingBuffer and extra deps).
 */
export async function canvasStats(page: Page): Promise<PixelStats> {
  const png = await page
    .locator('#city-canvas')
    .screenshot({ style: '#hud, #hud-stats, .lil-gui { visibility: hidden !important; }' });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 90;
    const g = c.getContext('2d');
    if (!g) throw new Error('no 2d context');
    g.drawImage(img, 0, 0, c.width, c.height);
    const { data } = g.getImageData(0, 0, c.width, c.height);
    let sum = 0;
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const gr = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      sum += 0.2126 * r + 0.7152 * gr + 0.0722 * b;
      seen.add((r << 16) | (gr << 8) | b);
    }
    return { mean: sum / (data.length / 4), distinct: seen.size };
  }, png.toString('base64'));
}
