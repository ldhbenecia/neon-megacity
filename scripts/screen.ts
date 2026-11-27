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
  /** Highest mean brightness in any frame: 0 means every read came back empty (see START). */
  maxLum: number;
}

export interface ScreenCheck {
  rest: PhaseStats;
  move: PhaseStats;
  failures: string[];
}

/**
 * Black-pixel limits (% of a frame) by time of day, from Metal runs of the fixed build (#63, #64).
 * Day views are bright when healthy (≤ 13 % black), so a black rectangle stands out. Dusk street
 * views reach 27 % at rest and 48 % moving; night street and hillside views up to 76 %. At night
 * only an almost entirely black frame fails (the reported night symptom); the bug itself gave
 * 94–100 % by day and at sunset.
 */
export const BLACK_MAX = {
  day: { rest: 30, move: 50 },
  dusk: { rest: 50, move: 70 },
  night: { rest: 90, move: 90 },
} as const;
/** Any frame darker than this on average fails. */
export const LUM_MIN = 2;

export type Light = keyof typeof BLACK_MAX;

/** Night before 05:00 and after 20:00, dusk 05:00–07:00 and 17:00–20:00, day otherwise. */
export function lightAt(time: number): Light {
  const h = time * 24;
  if (h < 5 || h > 20) return 'night';
  if (h < 7 || h > 17) return 'dusk';
  return 'day';
}

/** Pure verdict, shared by the perf table and its unit test. */
export function judgeScreen(rest: PhaseStats, move: PhaseStats, light: Light): string[] {
  const out: string[] = [];
  const limits = BLACK_MAX[light];
  if (rest.frames + move.frames > 0 && Math.max(rest.maxLum, move.maxLum) === 0) {
    return ['canvas read failed: every frame was exactly 0 (sampler ran outside the render task?)'];
  }
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
// of the frame just rendered. Precondition: with preserveDrawingBuffer false that buffer is only
// valid in the same task as the render; read after compositing it is empty and every frame
// reads as 0, which judgeScreen reports as a read failure rather than a black screen.
const START = `(() => {
  const gl = document.querySelector('canvas');
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 36;
  const g = c.getContext('2d', { willReadFrequently: true });
  const acc = { rest: { frames: 0, maxBlack: 0, minLum: 255, maxLum: 0 }, move: { frames: 0, maxBlack: 0, minLum: 255, maxLum: 0 } };
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
    const lum = Math.round((sum / 2304 / 3) * 10) / 10;
    a.minLum = Math.min(a.minLum, lum);
    a.maxLum = Math.max(a.maxLum, lum);
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
