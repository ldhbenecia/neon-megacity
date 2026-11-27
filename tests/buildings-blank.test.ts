import { describe, expect, it } from 'vitest';
import { LAYOUT, sideNormal, type BuildingSpec, type Side } from '../src/city/layout';
import { emitBuilding, faceBlank } from '../src/buildings/archetypes';
import { targets } from './buildings-helpers';

const SIDES: readonly Side[] = ['px', 'nx', 'pz', 'nz'];
const street = (): boolean => false;

/** Window widths (aWin.z) of the LOD1 vertices on one side of the building's walls. */
function sideWindows(spec: BuildingSpec, side: Side): number[] {
  const T = targets();
  emitBuilding(spec, T, street);
  const g = T.l1.build()!;
  const N = g.getAttribute('normal');
  const W = g.getAttribute('aWin');
  const I = g.getAttribute('aInfo');
  const n = sideNormal(side, spec.rotY);
  const out: number[] = [];
  for (let i = 0; i < N.count; i++) {
    if (Math.abs(N.getY(i)) > 0.1) continue;
    if (N.getX(i) * n.x + N.getZ(i) * n.z < 0.97) continue;
    const type = Math.floor(I.getX(i) / 2);
    out.push(type === 0 ? 0 : W.getZ(i));
  }
  return out;
}

describe('blank faces (BuildingsApi.faces[].blank)', () => {
  const sample = (a: BuildingSpec['archetype'], n: number): BuildingSpec[] =>
    LAYOUT.buildings.filter((b) => b.archetype === a && b.tiers.length === 1).slice(0, n);

  it('every Seongsu warehouse has at least one blind brick wall', () => {
    const ws = sample('brickWarehouse', 30);
    expect(ws.length).toBeGreaterThan(0);
    for (const b of ws) expect(SIDES.some((s) => faceBlank(b, s, street))).toBe(true);
  });

  it('a blank face draws no window cells, a windowed one does', () => {
    for (const a of ['brickWarehouse', 'sangga', 'apartmentSlab', 'lowOffice'] as const) {
      for (const b of sample(a, 6)) {
        for (const side of SIDES) {
          const wins = sideWindows(b, side);
          if (wins.length === 0) continue;
          if (faceBlank(b, side, street)) expect(Math.max(...wins), `${a} ${side}`).toBe(0);
          else expect(Math.max(...wins), `${a} ${side}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('media faces', () => {
  it('a media face is not a blank sign wall', () => {
    const base = LAYOUT.buildings.find(
      (b) => b.archetype === 'officeSlab' && b.tiers.length === 1,
    )!;
    const spec: BuildingSpec = {
      ...base,
      archetype: 'mediaSlab',
      tags: { ...base.tags, mediaFace: base.front },
    };
    expect(faceBlank(spec, base.front, street)).toBe(false);
  });
});
