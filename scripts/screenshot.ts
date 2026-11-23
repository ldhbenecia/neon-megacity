// Usage: npm run shots -- [label] [--swiftshader] [--no-build] [--only=<substring>]
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { preview } from 'vite';
import { SWIFTSHADER_ARGS, collectErrors, waitFrames } from '../tests/e2e/helpers';

const SHOTS = [
  { name: 'night-overview', query: 'time=0.0&cam=overview&rain=0.4' },
  { name: 'night-street', query: 'time=0.0&cam=street&rain=0.5' },
  { name: 'night-core-closeup', query: 'time=0.95&cam=core&rain=0.3' },
  { name: 'night-topdown', query: 'time=0.02&cam=topdown&rain=0.2' },
  { name: 'sunset-skyline', query: 'time=0.74&cam=skyline&rain=0' },
  { name: 'noon-overview', query: 'time=0.5&cam=overview&rain=0' },
  { name: 'heavy-rain-street', query: 'time=0.92&cam=street&rain=1' },
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
    args: flags.has('--swiftshader') ? SWIFTSHADER_ARGS : [],
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
      await page.screenshot({ path: file });
      console.log(file);
      if (errors.length > 0) failures.push(`${shot.name}: ${errors.join(' | ')}`);
      await page.close();
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
