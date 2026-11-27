import { describe, expect, it, vi } from 'vitest';
import { CITY, LAYOUT } from '../src/city/layout';

// The worker build resolves 'three' to src/city/three-lite.ts (vite.config.ts); the generator must
// give exactly the layout it gives with the full three.js on the main thread.
describe('city worker three-lite', () => {
  it('generates the same layout as with the full three.js', async () => {
    vi.resetModules();
    vi.doMock('three', () => import('../src/city/three-lite'));
    expect(Object.keys(await import('three')).sort()).toEqual(['CatmullRomCurve3', 'Vector3']);
    const { generateLayout } = await import('../src/city/generate');
    expect(generateLayout(CITY.seed)).toStrictEqual(LAYOUT);
    vi.doUnmock('three');
  }, 60_000);

  it('exports only what the generator imports from three', async () => {
    const lite = await import('../src/city/three-lite');
    expect(Object.keys(lite).sort()).toEqual(['CatmullRomCurve3', 'Vector3']);
  });
});
