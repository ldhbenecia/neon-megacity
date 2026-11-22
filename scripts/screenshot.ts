// Captures a fixed list of deterministic screenshots for visual review.
// Usage: npm run shots -- [label] [--swiftshader] [--no-build]
// Output: screenshots/<label>/<shot>.png (gitignored). Prints absolute paths.
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { SWIFTSHADER_ARGS, collectErrors } from '../tests/e2e/helpers';

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
const label =
  args.find((a) => !a.startsWith('--')) ?? new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve('screenshots', label);
const PORT = 4174;
const ANIMATION_MS = 3000;

async function main(): Promise<void> {
  if (!flags.has('--no-build')) execSync('npx vite build', { stdio: 'inherit' });
  mkdirSync(outDir, { recursive: true });

  const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'warn' });
  const browser = await chromium.launch({
    args: flags.has('--swiftshader') ? SWIFTSHADER_ARGS : [],
  });
  const failures: string[] = [];
  try {
    for (const shot of SHOTS) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      const errors = collectErrors(page);
      await page.goto(`http://localhost:${PORT}/?nogui&${shot.query}`);
      await page.waitForFunction(() => window.__city?.ready === true, undefined, {
        timeout: 60_000,
      });
      await page.waitForTimeout(ANIMATION_MS);
      const file = resolve(outDir, `${shot.name}.png`);
      await page.screenshot({ path: file });
      console.log(file);
      if (errors.length > 0) failures.push(`${shot.name}: ${errors.join(' | ')}`);
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise<void>((done) => server.httpServer.close(() => done()));
  }
  if (failures.length > 0) {
    console.error(`console errors:\n${failures.join('\n')}`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
