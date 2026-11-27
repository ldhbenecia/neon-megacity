// Screen sanity for `npm run perf`: black-pixel share and mean brightness of the canvas at rest and
// while the camera moves. A NaN in the HDR target spreads through the bloom mips into large black
// rectangles (or whole black frames) that counts, fps and SwiftShader e2e all miss.
import type { Page } from '@playwright/test';

export interface ScreenShot {
  tag: string;
  /** Mean of R, G, B over a 64×36 downsample, 0..255. */
  lum: number;
  /** Share of downsampled pixels with R + G + B < 6, 0..100. */
  black: number;
}

export interface ScreenCheck {
  shots: ScreenShot[];
  failures: string[];
}

/** Any frame at rest with more black than this fails (night views stay well below 5 %). */
export const IDLE_BLACK_MAX = 30;
/** Any frame while moving with more black than this fails (catches whole-frame flashes). */
export const MOTION_BLACK_MAX = 50;
/** Any frame darker than this on average fails. */
export const LUM_MIN = 2;

// A string, not a function: tsx (esbuild keepNames) would inject an undefined __name helper.
const STATS = `async (b64) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const W = 64, H = 36;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  let sum = 0, black = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] + d[i + 1] + d[i + 2];
    sum += v;
    if (v < 6) black++;
  }
  return [sum / (W * H) / 3, (100 * black) / (W * H)];
}`;

async function shoot(page: Page, tag: string): Promise<ScreenShot> {
  const png = await page.screenshot({ scale: 'css' });
  const [lum, black] = await page.evaluate<number[]>(`(${STATS})('${png.toString('base64')}')`);
  return { tag, lum: Math.round((lum ?? 0) * 10) / 10, black: Math.round(black ?? 0) };
}

/** Three frames at rest, then zoom, W flight and an orbit drag, then two frames at rest. */
export async function checkScreen(page: Page): Promise<ScreenCheck> {
  const shots: ScreenShot[] = [];
  const motion = new Set<string>();
  const take = async (tag: string, moving = false): Promise<void> => {
    shots.push(await shoot(page, tag));
    if (moving) motion.add(tag);
  };
  const vp = page.viewportSize() ?? { width: 1600, height: 900 };
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  for (let i = 0; i < 3; i++) {
    await take(`idle${i}`);
    await page.waitForTimeout(300);
  }
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -500);
    await page.waitForTimeout(80);
    await take(`zoom${i}`, true);
  }
  await page.keyboard.down('KeyW');
  try {
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(200);
      await take(`fly${i}`, true);
    }
  } finally {
    await page.keyboard.up('KeyW');
  }
  await page.mouse.down();
  try {
    for (let i = 0; i < 6; i++) {
      await page.mouse.move(cx + (i + 1) * 60, cy + (i + 1) * 8);
      await take(`orbit${i}`, true);
    }
  } finally {
    await page.mouse.up();
  }
  for (let i = 0; i < 2; i++) {
    await page.waitForTimeout(500);
    await take(`rest${i}`);
  }
  const failures: string[] = [];
  for (const s of shots) {
    const max = motion.has(s.tag) ? MOTION_BLACK_MAX : IDLE_BLACK_MAX;
    if (s.black > max) failures.push(`${s.tag}: ${s.black}% black (max ${max}%)`);
    if (s.lum < LUM_MIN) failures.push(`${s.tag}: mean brightness ${s.lum} (min ${LUM_MIN})`);
  }
  return { shots, failures };
}
