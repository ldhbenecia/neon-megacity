import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT } from '../src/city/layout';

// The city worker builds the terrain geometry with three-lite (vite.config.ts) and transfers the
// arrays; the main thread wraps them again. That must equal building it on the main thread.
describe('terrain geometry from the city worker', () => {
  afterEach(() => {
    vi.doUnmock('three');
    vi.resetModules();
  });

  it('packed in the worker and unpacked equals buildGround / buildChannel on the main thread', async () => {
    const layout = LAYOUT;
    vi.resetModules();
    vi.doMock('three', () => import('../src/city/three-lite'));
    const worker = {
      layout: await import('../src/city/layout'),
      ground: await import('../src/terrain/ground'),
      pack: await import('../src/core/packedGeometry'),
    };
    worker.layout.setLayout(layout);
    const packed = {
      ground: worker.pack.packGeometry(worker.ground.buildGround()),
      channel: worker.pack.packGeometry(worker.ground.buildChannel()),
    };
    const cloned = structuredClone(packed);

    vi.doUnmock('three');
    vi.resetModules();
    const main = {
      layout: await import('../src/city/layout'),
      ground: await import('../src/terrain/ground'),
      pack: await import('../src/core/packedGeometry'),
    };
    main.layout.setLayout(layout);
    for (const [key, build] of [
      ['ground', main.ground.buildGround],
      ['channel', main.ground.buildChannel],
    ] as const) {
      const direct = build();
      const unpacked = main.pack.unpackGeometry(cloned[key]);
      expect(Object.keys(unpacked.attributes).sort()).toEqual(
        Object.keys(direct.attributes).sort(),
      );
      for (const [name, a] of Object.entries(direct.attributes)) {
        expect(unpacked.getAttribute(name).array, `${key}.${name}`).toEqual(a.array);
        expect(unpacked.getAttribute(name).itemSize).toBe(a.itemSize);
      }
      expect(unpacked.index?.array).toEqual(direct.index?.array);
    }
  }, 120_000);
});
