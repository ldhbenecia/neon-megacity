import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT } from '../src/city/layout';

// The city worker builds the terrain geometry with three-lite (vite.config.ts) and transfers the
// arrays; the main thread wraps them again. That must equal building it on the main thread.
const bytes = (a: ArrayBufferView): Uint8Array =>
  new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
describe('geometry from the city worker', () => {
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
    // As postMessage does it: a structured clone with the buffers in the transfer list.
    const cloned = structuredClone(packed, {
      transfer: [
        ...worker.pack.packedBuffers(packed.ground),
        ...worker.pack.packedBuffers(packed.channel),
      ],
    });

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
        const got = unpacked.getAttribute(name);
        // Bytes, not numbers: toEqual would accept -0 for +0 and NaN for NaN.
        expect(bytes(got.array), `${key}.${name}`).toStrictEqual(bytes(a.array));
        expect(got.itemSize).toBe(a.itemSize);
        expect(got.normalized).toBe(a.normalized);
      }
      expect(unpacked.index && bytes(unpacked.index.array)).toStrictEqual(
        direct.index && bytes(direct.index.array),
      );
      expect(unpacked.index?.array.constructor).toBe(direct.index?.array.constructor);
      expect(unpacked.groups).toStrictEqual(direct.groups);
    }
  }, 120_000);

  it('pack keeps groups and normalized flags and refuses what it cannot carry', async () => {
    const THREE = await import('three');
    const { packGeometry, unpackGeometry } = await import('../src/core/packedGeometry');
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    g.setAttribute('w', new THREE.BufferAttribute(new Float32Array(3), 1, true));
    g.setIndex([0, 1, 2]);
    g.addGroup(0, 3, 1);
    const back = unpackGeometry(structuredClone(packGeometry(g)));
    expect(back.groups).toStrictEqual(g.groups);
    expect(back.getAttribute('w').normalized).toBe(true);
    g.setDrawRange(0, 3);
    expect(() => packGeometry(g)).toThrow(/drawRange/);
  });

  it('roads, sidewalks and the puddle mask from the worker equal the main-thread ones', async () => {
    const layout = LAYOUT;
    vi.resetModules();
    vi.doMock('three', () => import('../src/city/three-lite'));
    const w = {
      layout: await import('../src/city/layout'),
      roads: await import('../src/buildings/roads'),
      pack: await import('../src/core/packedGeometry'),
    };
    w.layout.setLayout(layout);
    const packed = {
      roads: w.pack.packGeometry(w.roads.buildRoads(layout)),
      walks: w.pack.packGeometry(w.roads.buildSidewalks(layout)),
      puddle: w.roads.puddleData(layout.seed, w.roads.PUDDLE_SIZE),
    };
    const cloned = structuredClone(packed, {
      transfer: [
        ...w.pack.packedBuffers(packed.roads),
        ...w.pack.packedBuffers(packed.walks),
        packed.puddle.buffer,
      ],
    });

    vi.doUnmock('three');
    vi.resetModules();
    const m = {
      layout: await import('../src/city/layout'),
      roads: await import('../src/buildings/roads'),
      pack: await import('../src/core/packedGeometry'),
    };
    m.layout.setLayout(layout);
    for (const [key, direct] of [
      ['roads', m.roads.buildRoads(layout)],
      ['walks', m.roads.buildSidewalks(layout)],
    ] as const) {
      const got = m.pack.unpackGeometry(cloned[key]);
      expect(Object.keys(got.attributes).sort()).toEqual(Object.keys(direct.attributes).sort());
      for (const [name, a] of Object.entries(direct.attributes)) {
        const g = got.getAttribute(name);
        expect(bytes(g.array), `${key}.${name}`).toStrictEqual(bytes(a.array));
        expect(g.itemSize).toBe(a.itemSize);
        expect(g.normalized).toBe(a.normalized);
      }
      expect(got.index?.array.constructor).toBe(direct.index?.array.constructor);
      expect(got.index && bytes(got.index.array)).toStrictEqual(
        direct.index && bytes(direct.index.array),
      );
      expect(got.groups).toStrictEqual(direct.groups);
    }
    expect(bytes(cloned.puddle)).toStrictEqual(
      bytes(m.roads.puddleData(layout.seed, m.roads.PUDDLE_SIZE)),
    );
    const tex = m.roads.puddleTexture(layout.seed, cloned.puddle);
    expect(tex.image.width).toBe(m.roads.PUDDLE_SIZE);
  }, 120_000);
});
