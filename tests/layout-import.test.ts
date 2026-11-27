import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// src/boot.ts evaluates the app while the city worker still generates the layout, so no module may
// read LAYOUT while it is evaluated. A fresh module registry has LAYOUT unset. src/main.ts itself
// needs the DOM; its top level is covered by the e2e boot (smoke).
const MODULES = [
  '../src/lighting/index',
  '../src/terrain/index',
  '../src/buildings/index',
  '../src/infra/index',
  '../src/neon/index',
  '../src/atmosphere/index',
  '../src/ux/index',
  '../src/core/query',
  '../src/core/gl',
  '../src/core/palette',
  '../src/ux/gui',
  '../src/ux/quality',
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

describe('app modules before setLayout', () => {
  it('LAYOUT is unset in a fresh module registry', async () => {
    vi.resetModules();
    const { LAYOUT } = await import('../src/city/layout');
    expect(LAYOUT).toBeUndefined();
  });

  for (const path of MODULES) {
    it(`${path} does not read LAYOUT while it is evaluated`, async () => {
      vi.resetModules();
      await expect(import(path)).resolves.toBeDefined();
    }, 60_000);
  }

  it('no module copies LAYOUT into a top-level binding (it would stay undefined)', () => {
    const bad = sources('src')
      .filter((f) => !f.endsWith(join('city', 'layout.ts')))
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .map((line, i) => ({ f, i, line }))
          .filter(({ line }) => /^(export\s+)?(const|let|var)\s[^=]*=\s*LAYOUT\b/.test(line)),
      )
      .map(({ f, i, line }) => `${f}:${i + 1} ${line.trim()}`);
    expect(bad).toEqual([]);
  });
});
