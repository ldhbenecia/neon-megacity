import { describe, expect, it } from 'vitest';
import {
  CITY,
  DISTRICT_HEIGHT,
  LAYOUT,
  blockCenter,
  districtFor,
  generateLayout,
  type Building,
} from '../src/city/layout';

const EPS = 1e-9;
const inner = CITY.inner;

const rect = (b: Building) => ({
  x0: b.x - b.w / 2,
  x1: b.x + b.w / 2,
  z0: b.z - b.d / 2,
  z1: b.z + b.d / 2,
});

describe('layout', () => {
  it('is deterministic for the default seed', () => {
    const again = generateLayout();
    expect(again).toEqual(LAYOUT);
    // Pin counts so accidental layout changes are noticed.
    expect(LAYOUT.blocks.length).toBe(CITY.gridN * CITY.gridN);
    expect(LAYOUT.roads.length).toBe((CITY.gridN + 1) * 2);
    expect(LAYOUT.buildings.length).toBe(1095);
  });

  it('changes with the seed', () => {
    expect(generateLayout(1).buildings).not.toEqual(LAYOUT.buildings);
  });

  it('places every building inside its block inner area', () => {
    for (const b of LAYOUT.buildings) {
      const [bx, bz] = b.block;
      const c = blockCenter(bx, bz);
      const r = rect(b);
      expect(r.x0).toBeGreaterThanOrEqual(c.x - inner / 2 - EPS);
      expect(r.x1).toBeLessThanOrEqual(c.x + inner / 2 + EPS);
      expect(r.z0).toBeGreaterThanOrEqual(c.z - inner / 2 - EPS);
      expect(r.z1).toBeLessThanOrEqual(c.z + inner / 2 + EPS);
    }
  });

  it('never overlaps a road strip', () => {
    for (const b of LAYOUT.buildings) {
      const r = rect(b);
      for (const road of LAYOUT.roads) {
        const overlaps =
          road.axis === 'x'
            ? r.z1 > road.z - road.width / 2 && r.z0 < road.z + road.width / 2
            : r.x1 > road.x - road.width / 2 && r.x0 < road.x + road.width / 2;
        expect(overlaps, `building ${b.id} overlaps road`).toBe(false);
      }
    }
  });

  it('has no overlapping buildings within a block', () => {
    for (const block of LAYOUT.blocks) {
      const bs = block.buildingIds.map((id) => LAYOUT.buildings[id]!);
      for (let i = 0; i < bs.length; i++) {
        for (let j = i + 1; j < bs.length; j++) {
          const a = rect(bs[i]!);
          const b = rect(bs[j]!);
          const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
          expect(overlap, `${bs[i]!.id} vs ${bs[j]!.id}`).toBe(false);
        }
      }
    }
  });

  it('keeps heights within district ranges and matches block districts', () => {
    for (const b of LAYOUT.buildings) {
      const range = DISTRICT_HEIGHT[b.district];
      expect(b.h).toBeGreaterThanOrEqual(range.min);
      expect(b.h).toBeLessThanOrEqual(range.max);
      expect(b.district).toBe(districtFor(b.block[0], b.block[1]));
      expect(b.w).toBeGreaterThan(0);
      expect(b.d).toBeGreaterThan(0);
    }
  });

  it('uses ids equal to array indices', () => {
    LAYOUT.buildings.forEach((b, i) => expect(b.id).toBe(i));
  });

  it('assigns the center 3x3 blocks to core', () => {
    const c = (CITY.gridN - 1) / 2;
    expect(districtFor(c, c)).toBe('core');
    expect(districtFor(c + 1, c - 1)).toBe('core');
    expect(districtFor(c + 2, c)).toBe('midtown');
    expect(districtFor(0, 0)).toBe('outer');
  });
});
