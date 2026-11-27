// Screen sanity for `npm run perf`: black-pixel share and mean brightness of the WebGL canvas on
// every frame, at rest and while the camera moves. A NaN in the HDR target spreads through the
// bloom mips into large black rectangles or whole black frames that counts, fps and SwiftShader
// e2e all miss; on Metal the moving case can last only 1–3 frames, so screenshots (hundreds of ms
// apart) are not enough.
import type { Page } from '@playwright/test';

export type Phase = 'rest' | 'move';

/** Worst values of one phase over all its frames. */
export interface PhaseStats {
  frames: number;
  /** Highest share of black pixels (R + G + B < 6 on a 64×36 downsample) in any frame, 0..100. */
  maxBlack: number;
  /** Lowest mean of R, G, B in any frame, 0..255. */
  minLum: number;
}

export interface ScreenCheck {
  rest: PhaseStats;
  move: PhaseStats;
  failures: string[];
}

/**
 * At rest, more black than this fails. Measured on Metal: night overview ≤ 17 %, night street
 * ~16 % (dark asphalt); SwiftShader night street 12–14 %.
 */
export const REST_BLACK_MAX = 30;
/** While moving, more black than this in any single frame fails (whole-frame flashes). */
export const MOVE_BLACK_MAX = 50;
/** Any frame darker than this on average fails. */
export const LUM_MIN = 2;

/** Pure verdict, shared by the perf table and its unit test. */
export function judgeScreen(rest: PhaseStats, move: PhaseStats): string[] {
  const out: string[] = [];
  const check = (name: Phase, s: PhaseStats, max: number): void => {
    if (s.frames === 0) out.push(`${name}: no frames sampled`);
    if (s.maxBlack > max) out.push(`${name}: a frame was ${s.maxBlack}% black (max ${max}%)`);
    if (s.minLum < LUM_MIN) {
      out.push(`${name}: a frame had mean brightness ${s.minLum} (min ${LUM_MIN})`);
    }
  };
  check('rest', rest, REST_BLACK_MAX);
  check('move', move, MOVE_BLACK_MAX);
  return out;
}

// Strings, not functions: tsx (esbuild keepNames) would inject an undefined __name helper.
// The sampler is a rAF callback queued after the app's own loop, so it reads the drawing buffer
// of the frame just rendered (still valid in the same task without preserveDrawingBuffer).
const START = `(() => {
  const gl = document.querySelector('canvas');
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 36;
  const g = c.getContext('2d', { willReadFrequently: true });
  const acc = { rest: { frames: 0, maxBlack: 0, minLum: 255 }, move: { frames: 0, maxBlack: 0, minLum: 255 } };
  window.__screen = { phase: 'rest', acc, on: true };
  const tick = () => {
    const s = window.__screen;
    if (!s.on) return;
    g.drawImage(gl, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data;
    let sum = 0, black = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] + d[i + 1] + d[i + 2];
      sum += v;
      if (v < 6) black++;
    }
    const a = s.acc[s.phase];
    a.frames++;
    a.maxBlack = Math.max(a.maxBlack, Math.round((100 * black) / 2304));
    a.minLum = Math.min(a.minLum, Math.round((sum / 2304 / 3) * 10) / 10);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

const phase = (page: Page, p: Phase): Promise<unknown> =>
  page.evaluate(`window.__screen.phase = '${p}'`);

/**
 * Rest 1 s; zoom out and back in; fly forward and back; orbit drag; rest 1 s. The path stays near
 * the preset pose, so it never parks the camera inside a wall (a dark interior is not a bug).
 */
export async function checkScreen(page: Page): Promise<ScreenCheck> {
  await page.evaluate(START);
  const vp = page.viewportSize() ?? { width: 1600, height: 900 };
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  try {
    await page.waitForTimeout(1000);
    await phase(page, 'move');
    await page.mouse.move(cx, cy);
    for (const dy of [500, 500, 500, -500, -500, -500]) {
      await page.mouse.wheel(0, dy);
      await page.waitForTimeout(120);
    }
    for (const key of ['KeyW', 'KeyS']) {
      await page.keyboard.down(key);
      try {
        await page.waitForTimeout(600);
      } finally {
        await page.keyboard.up(key);
      }
    }
    await page.mouse.down();
    try {
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(cx + i * 50, cy + i * 6);
        await page.waitForTimeout(60);
      }
    } finally {
      await page.mouse.up();
    }
    await page.waitForTimeout(300);
    await phase(page, 'rest');
    await page.waitForTimeout(1000);
  } finally {
    await page.evaluate('window.__screen.on = false');
  }
  const acc = await page.evaluate<{ rest: PhaseStats; move: PhaseStats }>('window.__screen.acc');
  return { ...acc, failures: judgeScreen(acc.rest, acc.move) };
}
