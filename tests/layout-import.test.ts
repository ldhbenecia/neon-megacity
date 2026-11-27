import { describe, expect, it, vi } from 'vitest';

// src/boot.ts evaluates the app while the city worker still generates the layout, so no module may
// read LAYOUT while it is evaluated. A fresh module registry has LAYOUT unset.
const MODULES = [
  '../src/lighting/index',
  '../src/terrain/index',
  '../src/buildings/index',
  '../src/infra/index',
  '../src/neon/index',
  '../src/atmosphere/index',
  '../src/ux/index',
  '../src/core/query',
];

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
});
