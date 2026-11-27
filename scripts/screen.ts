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
 * Black-pixel limits (% of a frame) by time of day. Day and sunset views are bright when healthy
 * (Metal: 1–3 % black), so a black rectangle stands out. Night views are legitimately dark
 * (Metal, fixed build: up to 76 % at rest on the hillside preset, 68 % while moving), so at night
 * only an almost entirely black frame fails: the reported night symptom is whole black frames.
 */
export const BLACK_MAX = {
  day: { rest: 30, move: 50 },
  night: { rest: 90, move: 90 },
} as const;
/** Any frame darker than this on average fails. */
export const LUM_MIN = 2;

export type Light = keyof typeof BLACK_MAX;

/** Night limits for time of day (0..1) before 05:00 or after 20:00, day limits otherwise. */
export function lightAt(time: number): Light {
  return time < 5 / 24 || time > 20 / 24 ? 'night' : 'day';
}

/** Pure verdict, shared by the perf table and its unit test. */
export function judgeScreen(rest: PhaseStats, move: PhaseStats, light: Light): string[] {
  const out: string[] = [];
  const limits = BLACK_MAX[light];
  const check = (name: Phase, s: PhaseStats, max: number): void => {
    if (s.frames === 0) out.push(`${name}: no frames sampled`);
    if (s.maxBlack > max) out.push(`${name}: a frame was ${s.maxBlack}% black (max ${max}%)`);
    if (s.minLum < LUM_MIN) {
      out.push(`${name}: a frame had mean brightness ${s.minLum} (min ${LUM_MIN})`);
    }
  };
  check('rest', rest, limits.rest);
  check('move', move, limits.move);
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
 * Rest 1 s; zoom out and back in; fly forward and back; a small orbit drag; rest 1 s. The path
 * stays near the preset pose: wide orbits at street level swing the camera against unlit walls,
 * which are legitimately black at night.
 */
export async function checkScreen(page: Page, light: Light): Promise<ScreenCheck> {
  await page.evaluate(START);
  const vp = page.viewportSize() ?? { width: 1600, height: 900 };
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  try {
    await page.waitForTimeout(1000);
    await phase(page, 'move');
    await page.mouse.move(cx, cy);
    for (const dy of [400, 400, -400, -400]) {
      await page.mouse.wheel(0, dy);
      await page.waitForTimeout(120);
    }
    for (const key of ['KeyW', 'KeyS']) {
      await page.keyboard.down(key);
      try {
        await page.waitForTimeout(400);
      } finally {
        await page.keyboard.up(key);
      }
    }
    await page.mouse.down();
    try {
      for (let i = 1; i <= 6; i++) {
        await page.mouse.move(cx + i * 25, cy + i * 3);
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
  return { ...acc, failures: judgeScreen(acc.rest, acc.move, light) };
}
