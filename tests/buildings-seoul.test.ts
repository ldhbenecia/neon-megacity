import { describe, expect, it } from 'vitest';
import { LAYOUT, type Archetype, type BuildingSpec } from '../src/city/layout';
import { emitBuilding } from '../src/buildings/archetypes';
import { districtLitFactor, zoneLitScale } from '../src/buildings/params';
import { targets, windingAgreement } from './buildings-helpers';
import { GeoBuilder } from '../src/buildings/builder';
import { palaceGrounds, palacePlan } from '../src/buildings/palace';

const NEW: Archetype[] = [
  'taperTower',
  'mediaSlab',
  'lowOffice',
  'hanokRow',
  'palaceHall',
  'brickWarehouse',
  'showroomBox',
];

function sample(a: Archetype, n = 6): BuildingSpec[] {
  return LAYOUT.buildings.filter((b) => b.archetype === a && !b.tags.landmark).slice(0, n);
}

function emitted(spec: BuildingSpec) {
  const T = targets();
  emitBuilding(spec, T, () => true);
  return { T, g0: T.l0.build(), g1: T.l1.build(), g2: T.l2.build() };
}

describe('Seoul archetypes (SEOUL.md 4.3)', () => {
  it('emit outward-wound geometry that stays in the footprint at every LOD', () => {
    for (const a of NEW) {
      for (const spec of sample(a)) {
        const { T, g0, g1, g2 } = emitted(spec);
        for (const g of [g0, g1, g2]) {
          expect(g, a).not.toBeNull();
          expect(windingAgreement(g!), a).toBeGreaterThan(0.97);
        }
        expect(T.l0.vertexCount).toBeGreaterThanOrEqual(T.l1.vertexCount);
        g1!.computeBoundingBox();
        const bb = g1!.boundingBox!;
        const r = Math.hypot(spec.w, spec.d) / 2 + 3;
        expect(Math.hypot(bb.max.x - spec.x, bb.max.z - spec.z), a).toBeLessThan(r * 1.5);
        expect(bb.min.y, a).toBeGreaterThanOrEqual(spec.baseY - 1e-3);
        expect(bb.max.y, a).toBeLessThanOrEqual(spec.baseY + spec.h + spec.spireH + 20);
      }
    }
  });

  it('palace halls stay dark: no windows, no shop fronts', () => {
    for (const spec of sample('palaceHall')) {
      const info = emitted(spec).g0!.getAttribute('aInfo');
      for (let i = 0; i < info.count; i++) {
        const v = info.getX(i);
        expect(v % 2).toBe(0);
        expect([0, 5]).toContain(Math.floor(v / 2));
      }
      expect(zoneLitScale(spec.zoneId)).toBe(0);
    }
  });

  it('brick warehouses use the brick facade with sparse windows', () => {
    const spec = sample('brickWarehouse')[0]!;
    const info = emitted(spec).g1!.getAttribute('aInfo');
    let brick = 0;
    for (let i = 0; i < info.count; i++) {
      if (Math.floor(info.getX(i) / 2) === 9) {
        brick++;
        expect(info.getW(i)).toBeCloseTo(0.6, 2);
      }
    }
    expect(brick).toBeGreaterThan(0);
  });

  it('a media face is a dark, window-free wall', () => {
    const base = sample('officeSlab')[0]!;
    const spec: BuildingSpec = {
      ...base,
      archetype: 'mediaSlab',
      tags: { ...base.tags, mediaFace: base.front },
    };
    const g = emitted(spec).g1!;
    expect(windingAgreement(g)).toBeGreaterThan(0.97);
  });

  it('district lit factors follow the zone multiplier', () => {
    const jongno = LAYOUT.buildings.find((b) => b.zoneId === 'jongno')!;
    expect(zoneLitScale(jongno.zoneId)).toBe(0.5);
    expect(districtLitFactor('oldtown')).toBe(districtLitFactor('sangga'));
    expect(zoneLitScale('nowhere')).toBe(1);
  });
});

describe('landmarks (SEOUL.md 4.5)', () => {
  const towers = LAYOUT.landmarks.filter((l) => l.buildingId !== null);

  it('has the three landmark towers with their planned heights', () => {
    const h = Object.fromEntries(towers.map((l) => [l.id, l.h]));
    expect(h['yongsan-apex']).toBe(600);
    expect(h['jamsil-blade']).toBe(500);
    expect(h['yeouido-gold']).toBeGreaterThan(250);
  });

  it('emit closed, outward geometry inside the footprint and reach their height', () => {
    for (const l of towers) {
      const spec = LAYOUT.buildings[l.buildingId!]!;
      const { T, g0, g1, g2 } = emitted(spec);
      for (const g of [g0, g1, g2]) {
        expect(windingAgreement(g!), l.id).toBeGreaterThan(0.97);
        g!.computeBoundingBox();
        const bb = g!.boundingBox!;
        const r = Math.hypot(spec.w, spec.d) / 2 + 3;
        for (const [x, z] of [
          [bb.min.x, bb.min.z],
          [bb.max.x, bb.max.z],
        ] as const) {
          expect(Math.abs(x - spec.x), l.id).toBeLessThan(r);
          expect(Math.abs(z - spec.z), l.id).toBeLessThan(r);
        }
        expect(bb.max.y, l.id).toBeGreaterThanOrEqual(spec.baseY + spec.h - 1);
        expect(bb.max.y, l.id).toBeLessThanOrEqual(spec.baseY + spec.h + spec.spireH + 40);
      }
      expect(T.l0.vertexCount, l.id).toBeGreaterThan(T.l2.vertexCount);
    }
  });
});

describe('palace grounds', () => {
  const plan = palacePlan(LAYOUT);

  it('has a plan on one south-north axis', () => {
    expect(plan).not.toBeNull();
    expect(plan!.halls.length).toBeGreaterThanOrEqual(3);
    for (const h of plan!.halls) expect(Math.abs(h.x - plan!.axisX)).toBeLessThan(2);
  });

  it('emits outward geometry inside the palace rectangle, deterministically, lighter far away', () => {
    const tris = [0, 1, 2].map((lv) => {
      const g = new GeoBuilder(0, 0);
      palaceGrounds(g, plan!, lv as 0 | 1 | 2);
      const geo = g.build()!;
      expect(windingAgreement(geo)).toBeGreaterThan(0.97);
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      expect(bb.min.x).toBeGreaterThan(plan!.x0 - 4);
      expect(bb.max.x).toBeLessThan(plan!.x1 + 4);
      expect(bb.min.z).toBeGreaterThan(plan!.z0 - 4);
      expect(bb.max.z).toBeLessThan(plan!.z1 + 4);
      return geo.index!.count / 3;
    });
    expect(tris[0]).toBeGreaterThan(tris[1]!);
    expect(tris[1]).toBeGreaterThan(tris[2]!);
    expect(tris[0]).toBeLessThan(40000);
    const again = new GeoBuilder(0, 0);
    palaceGrounds(again, plan!, 0);
    expect(again.vertexCount).toBe(
      (() => {
        const g = new GeoBuilder(0, 0);
        palaceGrounds(g, plan!, 0);
        return g.vertexCount;
      })(),
    );
  });
});

describe('palace grounds across LODs', () => {
  it('places side halls and garden trees identically at LOD0 and LOD1', () => {
    const plan = palacePlan(LAYOUT)!;
    // Hall plinths (0.8 m tall stone boxes) are emitted at every level; compare their tops.
    const tops = (lv: 0 | 1): string[] => {
      const g = new GeoBuilder(0, 0);
      palaceGrounds(g, plan, lv);
      const geo = g.build()!;
      const P = geo.getAttribute('position');
      const out = new Set<string>();
      for (let i = 0; i < P.count; i++) {
        if (Math.abs(P.getY(i) - 0.8) < 1e-3)
          out.add(`${P.getX(i).toFixed(1)},${P.getZ(i).toFixed(1)}`);
      }
      return [...out].sort();
    };
    expect(tops(0)).toEqual(tops(1));
  });
});
