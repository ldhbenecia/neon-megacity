import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../src/city/layout';
import { emitBuilding, industrialStacks } from '../src/buildings/archetypes';
import { GeoBuilder } from '../src/buildings/builder';
import { NullBuilder, lod0Job, pickLevel } from '../src/buildings/lod';

const D = [0, 380, 1100] as const;

describe('pickLevel', () => {
  it('switches out at the distance and back in only past the hysteresis band', () => {
    expect(pickLevel(100, 0, D, 0.1)).toBe(0);
    expect(pickLevel(380, 0, D, 0.1)).toBe(1);
    expect(pickLevel(360, 1, D, 0.1)).toBe(1);
    expect(pickLevel(341, 1, D, 0.1)).toBe(0);
    expect(pickLevel(1100, 1, D, 0.1)).toBe(2);
    expect(pickLevel(1000, 2, D, 0.1)).toBe(2);
    expect(pickLevel(980, 2, D, 0.1)).toBe(1);
  });

  it('never returns LOD0 when the LOD1 distance is 0 (low tier)', () => {
    expect(pickLevel(0, 1, [0, 0, 380], 0.1)).toBe(1);
    expect(pickLevel(400, 1, [0, 0, 380], 0.1)).toBe(2);
  });
});

describe('lazy LOD0', () => {
  const specs = LAYOUT.buildings.slice(0, 40);

  it('NullBuilder swallows everything', () => {
    const nb = new NullBuilder(0, 0);
    for (const spec of specs) emitBuilding(spec, { l0: nb, l1: nb, l2: nb });
    expect(nb.vertexCount).toBe(0);
    expect(nb.build()).toBeNull();
  });

  it('a sliced LOD0 job builds the same geometry as emitting LOD0 directly', () => {
    const nb = new NullBuilder(0, 0);
    const direct = new GeoBuilder(10, 20);
    for (const spec of specs) {
      emitBuilding(spec, { l0: direct, l1: nb, l2: nb });
      industrialStacks(spec, { l0: direct, l1: nb, l2: nb });
    }
    const parts = specs.map((spec) => (b: GeoBuilder) => {
      emitBuilding(spec, { l0: b, l1: nb, l2: nb });
      industrialStacks(spec, { l0: b, l1: nb, l2: nb });
    });
    const job = lod0Job(new GeoBuilder(10, 20), parts);
    let g = job.step(-Infinity);
    let slices = 1;
    while (g === undefined) {
      g = job.step(-Infinity);
      slices++;
    }
    // One part per slice, then a final call that builds.
    expect(slices).toBe(specs.length + 1);
    const a = direct.build();
    expect(g?.getAttribute('position').array).toEqual(a?.getAttribute('position').array);
    expect(g?.getIndex()?.array).toEqual(a?.getIndex()?.array);
  });
});
