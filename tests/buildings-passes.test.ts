import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { LAYOUT, type BuildingSpec } from '../src/city/layout';
import { GeoBuilder } from '../src/buildings/builder';
import { NullBuilder } from '../src/buildings/lod';
import { emitBuilding, industrialStacks, type Targets } from '../src/buildings/archetypes';

// Skipping a discarded level must not change the others: code skipped for a NullBuilder may not
// draw from the building rng. These compare each pass against a full emit.
const real = (): GeoBuilder => new GeoBuilder(0, 0);
const NULL = new NullBuilder(0, 0);

function emit(spec: BuildingSpec, T: Targets): Targets {
  emitBuilding(spec, T, () => true);
  industrialStacks(spec, T);
  return T;
}

function arrays(g: THREE.BufferGeometry | null): number[][] {
  if (!g) return [];
  const out = Object.values(g.attributes).map((a) => Array.from(a.array as ArrayLike<number>));
  if (g.index) out.push(Array.from(g.index.array));
  return out;
}

function sample(): BuildingSpec[] {
  const first = new Map<string, BuildingSpec>();
  for (const b of LAYOUT.buildings) if (!first.has(b.archetype)) first.set(b.archetype, b);
  return [...first.values(), ...LAYOUT.buildings.filter((_, i) => i % 97 === 0)];
}

describe('LOD passes match a full emit', () => {
  it('far pass (LOD0 discarded) builds the same LOD1 and LOD2', () => {
    for (const spec of sample()) {
      const full = emit(spec, { l0: real(), l1: real(), l2: real() });
      const far = emit(spec, { l0: NULL, l1: real(), l2: real() });
      expect(arrays(far.l1.build()), spec.archetype).toEqual(arrays(full.l1.build()));
      expect(arrays(far.l2.build()), spec.archetype).toEqual(arrays(full.l2.build()));
    }
  });

  it('near pass (LOD1 and LOD2 discarded) builds the same LOD0', () => {
    for (const spec of sample()) {
      const full = emit(spec, { l0: real(), l1: real(), l2: real() });
      const near = emit(spec, { l0: real(), l1: NULL, l2: NULL });
      expect(arrays(near.l0.build()), spec.archetype).toEqual(arrays(full.l0.build()));
    }
  });
});
