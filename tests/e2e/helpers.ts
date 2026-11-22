import type { Page } from '@playwright/test';

/** Collects console errors and uncaught page errors for the lifetime of the page. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

export async function waitForCity(page: Page, minFrames = 30): Promise<void> {
  await page.waitForFunction((n) => (window.__city?.frames ?? 0) >= n, minFrames, {
    timeout: 45_000,
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
  // Hide HTML overlays so only WebGL output is measured.
  const png = await page
    .locator('canvas')
    .first()
    .screenshot({ style: '#hud, .lil-gui { visibility: hidden !important; }' });
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
