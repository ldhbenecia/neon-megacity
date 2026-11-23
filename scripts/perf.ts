// Usage: npm run perf -- [label] [--swiftshader] [--no-build] [--quality=low] [--frames=240]
//   [--only=<substring>]
// Boots the production build in headless Chromium on the real GPU (Metal ANGLE) for each scenario
// and prints a markdown table (docs/PERF.md) plus perf-results/<label>.json.
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { preview } from 'vite';
import { SWIFTSHADER_ARGS, collectErrors } from '../tests/e2e/helpers';
import { bundleGzip } from './bundle';

const PRESETS = [
  [1, '강변 히어로'],
  [2, '코어 상공'],
  [3, '등불가 거리'],
  [5, '별계단동'],
  [8, '탑다운'],
] as const;
const TIMES = [
  [0.0, 'night'],
  [0.78, 'sunset'],
  [0.5, 'noon'],
] as const;
const BUDGET = { calls: 300, triangles: 2_000_000, programs: 50, textures: 40, gpuMB: 320 };

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const opt = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const KNOWN = ['--swiftshader', '--no-build', '--quality=', '--frames=', '--only='];
const unknown = [...flags].filter(
  (f) => !KNOWN.some((k) => (k.endsWith('=') ? f.startsWith(k) : f === k)),
);
const positional = args.filter((a) => !a.startsWith('--'));
// `--only 탑다운` (space instead of =) would otherwise turn the value into the label.
if (unknown.length || positional.length > 1) {
  console.error(
    `usage: npm run perf -- [label] ${KNOWN.map((k) => (k.endsWith('=') ? `[${k}…]` : `[${k}]`)).join(' ')}`,
  );
  process.exit(2);
}
const swiftshader = flags.has('--swiftshader');
const quality = opt('quality');
const frames = Number(opt('frames') ?? 240);
if (!Number.isInteger(frames) || frames <= 0) {
  console.error(`--frames must be a positive integer, got ${opt('frames')}`);
  process.exit(2);
}
const only = opt('only');
const label = (positional[0] ?? new Date().toISOString()).replace(/[^\p{L}\p{N}_.-]+/gu, '-');
const PORT = 4175;
const expectedDpr = quality === 'low' ? 0.5 : 1.5;
const BASE = `http://localhost:${PORT}/`;
// 1600×900 at DPR 2 (a retina laptop): the app caps it to 1.5.
const VIEWPORT = { width: 1600, height: 900 };
const GPU_ARGS = [
  '--use-angle=metal',
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  // Unthrottled rAF: the frame interval is then the real cost, not the 60 Hz vsync.
  '--disable-gpu-vsync',
  '--disable-frame-rate-limit',
];

type Hangang = NonNullable<Window['__hangang']>;

interface Result {
  name: string;
  query: string;
  boot: Record<string, number>;
  frame: { mean: number; p50: number; p95: number; fps: number };
  stats: { calls: number; triangles: number; programs: number; textures: number; dpr: number };
  memory: ReturnType<Hangang['memory']>;
  cpu: NonNullable<Window['__city']>['cpu'];
  errors: string[];
}

async function measure(browser: Browser, name: string, query: string): Promise<Result> {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const errors = collectErrors(page);
  await page.goto(`${BASE}?${query}`);
  await page.waitForFunction(() => window.__city?.powered === true, undefined, {
    timeout: swiftshader ? 600_000 : 120_000,
  });
  const result = await page.evaluate(async (n) => {
    // No named helpers in here: tsx (esbuild keepNames) would reference an undefined __name.
    for (let i = 0; i < 60; i++) await new Promise<number>((r) => requestAnimationFrame(r));
    const deltas: number[] = [];
    let last = await new Promise<number>((r) => requestAnimationFrame(r));
    for (let i = 0; i < n; i++) {
      const now = await new Promise<number>((r) => requestAnimationFrame(r));
      deltas.push(now - last);
      last = now;
    }
    const marks = performance.getEntriesByType('mark').filter((m) => m.name.startsWith('boot:'));
    const boot: Record<string, number> = {};
    marks.forEach((m, i) => {
      const end = marks[i + 1]?.startTime;
      if (end !== undefined) boot[m.name.slice(5)] = end - m.startTime;
    });
    boot.interactive = marks.at(-1)?.startTime ?? 0;
    const r = window.__hangang;
    if (!r) throw new Error('__hangang missing (needs ?stats)');
    return { deltas, boot, stats: r.stats(), memory: r.memory(), cpu: window.__city?.cpu ?? {} };
  }, frames);
  await page.close();
  const sorted = [...result.deltas].sort((a, b) => a - b);
  const q = (p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    name,
    query,
    boot: result.boot,
    frame: { mean, p50: q(0.5), p95: q(0.95), fps: 1000 / mean },
    stats: result.stats,
    memory: result.memory,
    cpu: result.cpu,
    errors,
  };
}

const mb = (b: number): string => (b / 1024 / 1024).toFixed(1);
const ms = (v: number | undefined): string => (v === undefined ? '-' : v.toFixed(0));
const warn = (bad: boolean): string => (bad ? ' ⚠' : '');

function table(results: Result[]): string {
  const rows = [
    '| scenario | frame ms (mean / p95) | fps | dpr | calls | tris | programs | textures | geo MB | tex MB | canvas MB | update ms |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of results) {
    const s = r.stats;
    const cpu = Object.values(r.cpu).reduce((a, b) => a + b, 0);
    rows.push(
      `| ${r.name} | ${r.frame.mean.toFixed(1)} / ${r.frame.p95.toFixed(1)} | ${r.frame.fps.toFixed(0)} | ` +
        // Adaptive DPR may have stepped down during the run: the numbers are then not at 1.5.
        `${s.dpr}${warn(s.dpr !== expectedDpr)} | ` +
        `${s.calls}${warn(s.calls > BUDGET.calls)} | ${(s.triangles / 1e6).toFixed(2)} M${warn(s.triangles > BUDGET.triangles)} | ` +
        `${s.programs}${warn(s.programs > BUDGET.programs)} | ${s.textures}${warn(s.textures > BUDGET.textures)} | ` +
        `${mb(r.memory.geometryBytes)} | ${mb(r.memory.textureBytes)} | ` +
        `${mb(r.memory.framebufferBytes)} (×${r.memory.samples}) | ${cpu.toFixed(2)} |`,
    );
  }
  const stages = [...new Set(results.flatMap((r) => Object.keys(r.boot)))];
  rows.push('', `| scenario | ${stages.join(' | ')} |`, `| --- |${' --- |'.repeat(stages.length)}`);
  for (const r of results)
    rows.push(`| ${r.name} | ${stages.map((k) => ms(r.boot[k])).join(' | ')} |`);
  const mods = [...new Set(results.flatMap((r) => Object.keys(r.cpu)))];
  rows.push(
    '',
    `| scenario (update ms) | ${mods.join(' | ')} |`,
    `| --- |${' --- |'.repeat(mods.length)}`,
  );
  for (const r of results)
    rows.push(`| ${r.name} | ${mods.map((k) => (r.cpu[k] ?? 0).toFixed(3)).join(' | ')} |`);
  return rows.join('\n');
}

async function main(): Promise<void> {
  if (!flags.has('--no-build')) {
    const { BASE_PATH: _unused, ...env } = process.env;
    execSync('npx vite build', { stdio: 'inherit', env });
  }
  // base './' as in dev and e2e: BASE below has no BASE_PATH prefix.
  const server = await preview({
    base: './',
    preview: { port: PORT, strictPort: true },
    logLevel: 'warn',
  });
  const browser = await chromium.launch({ args: swiftshader ? SWIFTSHADER_ARGS : GPU_ARGS });
  const results: Result[] = [];
  try {
    // Blank page, not the app: booting the city here would warm the shader cache for scenario 1.
    const probe = await browser.newPage();
    const gpu = await probe.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });
    await probe.close();
    console.log(`GPU: ${gpu}`);
    for (const [preset, pname] of PRESETS) {
      for (const [time, tname] of TIMES) {
        const name = `${preset} ${pname} · ${tname}`;
        if (only && !name.includes(only)) continue;
        const query = `nogui&stats&preset=${preset}&time=${time}&rain=0.35${quality ? `&quality=${quality}` : ''}`;
        const r = await measure(browser, name, query);
        console.log(
          `${name}: ${r.frame.mean.toFixed(1)} ms, ${r.stats.calls} calls, ` +
            `${(r.stats.triangles / 1e6).toFixed(2)} M tris, boot ${ms(r.boot.interactive)} ms` +
            (r.errors.length ? `, ${r.errors.length} errors` : ''),
        );
        results.push(r);
      }
    }
    const bundle = bundleGzip();
    const md = `GPU: ${gpu}\n\n${table(results)}\n\nJS gzip: ${bundle
      .map((b) => `${b.file} ${(b.gzip / 1024).toFixed(1)} KB`)
      .join(', ')}`;
    console.log(`\n${md}`);
    mkdirSync('perf-results', { recursive: true });
    writeFileSync(
      resolve('perf-results', `${label}.json`),
      JSON.stringify({ gpu, swiftshader, quality, frames, results, bundle }, null, 2),
    );
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
