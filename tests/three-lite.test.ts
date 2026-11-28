import { afterEach, describe, expect, it, vi } from 'vitest';
import { CITY, LAYOUT } from '../src/city/layout';

// The worker build resolves 'three' to src/city/three-lite.ts (vite.config.ts); the generator must
// give exactly the layout it gives with the full three.js on the main thread.
describe('city worker three-lite', () => {
  afterEach(() => {
    vi.doUnmock('three');
    vi.resetModules();
  });

  it('generates the same layout as with the full three.js', async () => {
    vi.resetModules();
    vi.doMock('three', () => import('../src/city/three-lite'));
    expect(Object.keys(await import('three')).sort()).toEqual([
      'BufferAttribute',
      'BufferGeometry',
      'CatmullRomCurve3',
      'Color',
      'Float32BufferAttribute',
      'Vector3',
    ]);
    const { generateLayout } = await import('../src/city/generate');
    expect(generateLayout(CITY.seed)).toStrictEqual(LAYOUT);
  }, 60_000);

  it('exports only what the worker code (generator, terrain geometry) imports from three', async () => {
    const lite = await import('../src/city/three-lite');
    expect(Object.keys(lite).sort()).toEqual([
      'BufferAttribute',
      'BufferGeometry',
      'CatmullRomCurve3',
      'Color',
      'Float32BufferAttribute',
      'Vector3',
    ]);
  });
});
