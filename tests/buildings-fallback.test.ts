import { describe, expect, it } from 'vitest';
import { LAYOUT, type Archetype, type BuildingSpec } from '../src/city/layout';
import { emitBuilding, industrialStacks } from '../src/buildings/archetypes';
import { baseArchetype, districtLitFactor, withBaseArchetype } from '../src/buildings/params';
import { targets } from './buildings-helpers';

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

  it('keeps known archetypes and maps unknown ones by height', () => {
    expect(baseArchetype(unknown(tall, 'taperTower'))).toBe('taperTower');
    expect(baseArchetype(unknown(low, 'hanokRow'))).toBe('hanokRow');
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

describe('v3 district kinds light like their v2 counterpart', () => {
  it('gives v3 kinds the window lighting of their base kind', () => {
    expect(districtLitFactor('megacore')).toBe(districtLitFactor('core'));
    expect(districtLitFactor('corridor')).toBe(districtLitFactor('core'));
    expect(districtLitFactor('oldtown')).toBe(districtLitFactor('sangga'));
    expect(districtLitFactor('megacore')).toBeGreaterThan(districtLitFactor('industrial'));
  });

  it('keeps the palace and parks dark', () => {
    expect(districtLitFactor('palace')).toBe(0);
    expect(districtLitFactor('park')).toBe(0);
  });
});
