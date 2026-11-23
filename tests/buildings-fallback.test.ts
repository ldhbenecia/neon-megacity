import { describe, expect, it } from 'vitest';
import { LAYOUT, type Archetype, type BuildingSpec } from '../src/city/layout';
import { GeoBuilder } from '../src/buildings/builder';
import { emitBuilding, industrialStacks, type Targets } from '../src/buildings/archetypes';
import { baseArchetype, withBaseArchetype } from '../src/buildings/params';

const targets = (): Targets => ({
  l0: new GeoBuilder(0, 0),
  l1: new GeoBuilder(0, 0),
  l2: new GeoBuilder(0, 0),
});

// Archetypes a newer layout may emit before buildings has geometry for them.
const unknown = (spec: BuildingSpec, archetype: string): BuildingSpec => ({
  ...spec,
  archetype: archetype as Archetype,
});

const NEW_ARCHETYPES = [
  'taperTower',
  'mediaSlab',
  'lowOffice',
  'hanokRow',
  'palaceHall',
  'brickWarehouse',
  'showroomBox',
  'somethingElse',
];

describe('unknown archetypes fall back to a base form', () => {
  const tall = LAYOUT.buildings.find((b) => b.archetype === 'setbackTower')!;
  const low = LAYOUT.buildings.find((b) => b.archetype === 'sangga')!;

  it('maps v3 archetypes to the closest v2 form and keeps known ones', () => {
    expect(baseArchetype(unknown(tall, 'taperTower'))).toBe('setbackTower');
    expect(baseArchetype(unknown(tall, 'mediaSlab'))).toBe('officeSlab');
    expect(baseArchetype(unknown(low, 'hanokRow'))).toBe('sangga');
    expect(baseArchetype(unknown(tall, 'somethingElse'))).toBe('officeSlab');
    expect(baseArchetype(unknown(low, 'somethingElse'))).toBe('sangga');
    for (const b of LAYOUT.buildings) {
      const base = withBaseArchetype(b);
      expect(base.archetype).toBe(baseArchetype(b));
      expect({ ...base, archetype: b.archetype }).toEqual(b);
    }
  });

  it('emits geometry for every unknown archetype on low and tall specs', () => {
    for (const spec of [tall, low]) {
      for (const a of NEW_ARCHETYPES) {
        const T = targets();
        const s = unknown(spec, a);
        expect(() => {
          emitBuilding(s, T, () => true);
          industrialStacks(s, T);
        }, a).not.toThrow();
        expect(T.l0.build(), a).not.toBeNull();
        expect(T.l1.build(), a).not.toBeNull();
        expect(T.l2.build(), a).not.toBeNull();
      }
    }
  });

  it('ignores Object prototype keys and keeps palace halls free of shop fronts', () => {
    expect(baseArchetype(unknown(low, 'constructor'))).toBe('sangga');
    expect(baseArchetype(unknown(tall, 'toString'))).toBe('officeSlab');
    const hall = { ...unknown(low, 'palaceHall'), tags: { ...low.tags, storefront: false } };
    const T = targets();
    emitBuilding(hall, T, () => true);
    const info = T.l0.build()!.getAttribute('aInfo');
    for (let i = 0; i < info.count; i++) expect(info.getX(i) % 2).toBe(0);
  });

  it('handles unknown district kinds', () => {
    const T = targets();
    const s = { ...low, district: 'somewhere' } as unknown as BuildingSpec;
    emitBuilding(s, T);
    expect(T.l1.build()).not.toBeNull();
  });
});
