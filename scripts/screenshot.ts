// Usage: npm run shots -- [label] [--swiftshader|--gpu] [--no-build] [--only=<substring>] [--burst]
//   [--black-limit=<percent>]
// Every city shot prints its mean luminance and near-black pixel ratio; a ratio above the limit
// (default 60 %, looser for dark night shots) fails the run. --burst also shoots frame by frame while zooming, flying and
// orbiting, which is where transient black rectangles and collision misses show up.
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { preview } from 'vite';
import { SWIFTSHADER_ARGS, collectErrors, waitFrames } from '../tests/e2e/helpers';

/** `limit` overrides --black-limit for shots that are legitimately mostly dark. */
const SHOTS: { name: string; query: string; limit?: number }[] = [
  { name: 'night-overview', query: 'time=0.0&cam=overview&rain=0.4' },
  { name: 'night-street', query: 'time=0.0&cam=street&rain=0.5' },
  { name: 'night-core-closeup', query: 'time=0.95&cam=core&rain=0.3' },
  { name: 'night-topdown', query: 'time=0.02&cam=topdown&rain=0.2', limit: 90 },
  { name: 'sunset-skyline', query: 'time=0.74&cam=skyline&rain=0' },
  { name: 'noon-overview', query: 'time=0.5&cam=overview&rain=0' },
  { name: 'noon-street', query: 'time=0.5&cam=street&rain=0' },
  { name: 'sunset-overview', query: 'time=0.74&cam=overview&rain=0' },
  { name: 'heavy-rain-street', query: 'time=0.92&cam=street&rain=1', limit: 85 },
];

// Night limits are looser: a dark facade or highway underside seen up close reaches ~70 %,
// while the NaN rectangles this exists to catch cover 92-97 %.
const BURST_SCENES: { name: string; query: string; limit?: number }[] = [
  { name: 'burst-noon-overview', query: 'time=0.5&cam=overview&rain=0' },
  { name: 'burst-night-overview', query: 'time=0.0&cam=overview&rain=0.4', limit: 80 },
  { name: 'burst-night-street', query: 'time=0.0&cam=street&rain=0', limit: 80 },
];

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length);
const label =
  args.find((a) => !a.startsWith('--')) ?? new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve('screenshots', label);
const PORT = 4174;
const BASE = `http://localhost:${PORT}/`;
const ANIMATION_MS = 3000;
const VIEWPORT = { width: 1600, height: 900 };
const BLACK_LIMIT = Number(
  args.find((a) => a.startsWith('--black-limit='))?.slice('--black-limit='.length) ?? 60,
);
if (!Number.isFinite(BLACK_LIMIT)) throw new Error('--black-limit needs a number (percent)');
// Real GPU where one is known to exist (macOS, or --gpu): SwiftShader hides driver-specific
// shader faults such as NaN from pow(). Headless Linux and containers keep software GL.
const GPU = flags.has('--gpu') || (process.platform === 'darwin' && !flags.has('--swiftshader'));
const GPU_ARGS =
  process.platform === 'darwin'
    ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
    : ['--enable-gpu', '--ignore-gpu-blocklist'];

interface Luma {
  /** Mean of (r + g + b) / 3, 0..255. */
  mean: number;
  /** Percent of pixels with r + g + b < 6 on a 160 x 90 downsample. */
  black: number;
}

async function measure(page: Page, png: Buffer): Promise<Luma> {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const W = 160;
    const H = 90;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    if (!g) throw new Error('2d context unavailable');
    g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    let sum = 0;
    let black = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0);
      sum += v;
      if (v < 6) black++;
    }
    return { mean: sum / (W * H) / 3, black: (black / (W * H)) * 100 };
  }, png.toString('base64'));
}

const fmt = (l: Luma): string => `L=${l.mean.toFixed(1)} black=${l.black.toFixed(0)}%`;

/** Shoots while the camera moves; returns failure lines (black frames, camera inside buildings). */
async function burst(
  browser: Browser,
  scene: { name: string; query: string; limit?: number },
): Promise<string[]> {
  const limit = scene.limit ?? BLACK_LIMIT;
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors = collectErrors(page);
  await page.goto(`${BASE}?nogui&stats&${scene.query}`);
  await waitPowered(page);
  await page.evaluate(() => window.__hangang?.resetInside());
  const log: string[] = [];
  const bad: string[] = [];
  const snap = async (tag: string, keep = false): Promise<void> => {
    const png = await page.screenshot();
    const l = await measure(page, png);
    log.push(`${tag}:${l.black.toFixed(0)}`);
    if (l.black > limit) bad.push(`${tag} ${fmt(l)}`);
    if (keep || l.black > limit) {
      writeFileSync(resolve(outDir, `${scene.name}-${tag}.png`), png);
    }
  };
  for (let i = 0; i < 3; i++) {
    await waitFrames(page, 2);
    await snap(`idle${i}`, i === 0);
  }
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  // One continuous scroll (a screenshot between notches would split it into separate gestures),
  // then frames while the zoom eases in.
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -500);
  for (let i = 0; i < 8; i++) {
    await waitFrames(page, 2);
    await snap(`zoom${i}`);
  }
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 500);
    await waitFrames(page, 2);
    await snap(`out${i}`);
  }
  await page.keyboard.down('w');
  for (let i = 0; i < 8; i++) {
    await waitFrames(page, 2);
    await snap(`fly${i}`);
  }
  await page.keyboard.up('w');
  await page.mouse.down();
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(VIEWPORT.width / 2 + i * 60, VIEWPORT.height / 2 + i * 8);
    await waitFrames(page, 1);
    await snap(`orbit${i}`);
  }
  await page.mouse.up();
  // Rest: what the user sees after letting go (the rig opens a blocked view within ~1 s).
  for (let i = 0; i < 3; i++) {
    await waitFrames(page, 30);
    await snap(`rest${i}`, i === 2);
  }
  const inside = await page.evaluate(() => window.__hangang?.inside() ?? { frames: 0, last: null });
  await page.close();
  console.log(`${scene.name} black% ${log.join(' ')} inside=${inside.frames}`);
  const out = bad.map((b) => `${scene.name}: black frame ${b}`);
  if (inside.frames > 0) {
    out.push(
      `${scene.name}: camera inside building ${String(inside.last)} for ${inside.frames} frames`,
    );
  }
  if (errors.length > 0) out.push(`${scene.name}: ${errors.join(' | ')}`);
  return out;
}

async function waitPowered(page: Page): Promise<void> {
  await page.waitForFunction(
    () => window.__city?.powered === true && window.__city.lod0Pending === 0,
    undefined,
    {
      timeout: 90_000,
    },
  );
}

async function bootSkeleton(browser: Browser, file: string): Promise<void> {
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.route('**/*.js', (route) => route.abort());
  await page.goto(BASE);
  await page.waitForTimeout(3200);
  await page.screenshot({ path: file });
  await page.close();
}

async function bootProgress(browser: Browser, file: string): Promise<void> {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 12 });
  await page.goto(`${BASE}?nogui&time=0.0`);
  await page.waitForFunction(
    () => {
      const p = Number(document.getElementById('boot')?.dataset.progress ?? 0);
      return p >= 30 && p < 90;
    },
    undefined,
    { timeout: 60_000, polling: 16 },
  );
  await page.screenshot({ path: file });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.close();
}

async function hudPanel(browser: Browser, file: string): Promise<void> {
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(`${BASE}?time=0.0`);
  await waitPowered(page);
  await page.screenshot({ path: file.replace('.png', '-hint.png') });
  await page.click('#panel-toggle');
  await page.waitForTimeout(300);
  await page.screenshot({ path: file });
  await page.close();
}

async function hudMobile(browser: Browser, file: string): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(`${BASE}?time=0.78&cam=overview`);
  await waitPowered(page);
  await page.screenshot({ path: file.replace('.png', '-closed.png') });
  await page.click('#panel-toggle');
  await page.waitForTimeout(300);
  await page.screenshot({ path: file });
  await context.close();
}

async function hudSelected(browser: Browser, file: string): Promise<void> {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors = collectErrors(page);
  await page.goto(`${BASE}?stats&time=0.0&cam=overview`);
  await waitPowered(page);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  // The fly-to can outlast 10 s on heavy frames; the card only opens once it lands.
  await page.waitForFunction(
    () => {
      const cam = window.__hangang?.camera();
      return (
        cam?.selected != null &&
        cam.mode === 'orbit' &&
        window.__city?.lod0Pending === 0 &&
        document.getElementById('hud-card')?.hidden === false
      );
    },
    undefined,
    { timeout: 60_000 },
  );
  // The card slide-in is a CSS transition (wall clock), so wait for it rather than for frames.
  await page
    .locator('#hud-card')
    .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await waitFrames(page, 2);
  await page.screenshot({ path: file });
  await page.close();
  if (errors.length > 0) throw new Error(errors.join(' | '));
}

async function main(): Promise<void> {
  if (!flags.has('--no-build')) execSync('npx vite build', { stdio: 'inherit' });
  mkdirSync(outDir, { recursive: true });

  const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'warn' });
  const browser = await chromium.launch({
    args: GPU ? GPU_ARGS : SWIFTSHADER_ARGS,
  });
  const failures: string[] = [];
  const want = (name: string): boolean => !only || name.includes(only);
  try {
    for (const shot of SHOTS) {
      if (!want(shot.name)) continue;
      const page = await browser.newPage({ viewport: VIEWPORT });
      const errors = collectErrors(page);
      await page.goto(`${BASE}?nogui&${shot.query}`);
      await waitPowered(page);
      await page.waitForTimeout(ANIMATION_MS);
      const file = resolve(outDir, `${shot.name}.png`);
      const l = await measure(page, await page.screenshot({ path: file }));
      console.log(`${file}  ${fmt(l)}`);
      const limit = shot.limit ?? BLACK_LIMIT;
      if (l.black > limit) failures.push(`${shot.name}: black ${fmt(l)} > ${limit}%`);
      if (errors.length > 0) failures.push(`${shot.name}: ${errors.join(' | ')}`);
      await page.close();
    }
    if (flags.has('--burst')) {
      for (const scene of BURST_SCENES) {
        if (!want(scene.name)) continue;
        try {
          failures.push(...(await burst(browser, scene)));
        } catch (err) {
          failures.push(`${scene.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    const ux: [string, (b: Browser, f: string) => Promise<void>][] = [
      ['ux-boot-skeleton', bootSkeleton],
      ['ux-boot-progress', bootProgress],
      ['ux-hud-selected', hudSelected],
      ['ux-hud-panel', hudPanel],
      ['ux-hud-mobile', hudMobile],
    ];
    for (const [name, run] of ux) {
      if (!want(name)) continue;
      const file = resolve(outDir, `${name}.png`);
      try {
        await run(browser, file);
        console.log(file);
      } catch (err) {
        // Left-open pages close with the browser; keep going so one miss doesn't drop the rest.
        failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await browser.close();
    await new Promise<void>((done) => server.httpServer.close(() => done()));
  }
  if (failures.length > 0) {
    console.error(`failures:\n${failures.join('\n')}`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
