import { describe, expect, it } from 'vitest';
import { CITY, LAYOUT, sideNormal, type BuildingSpec, type Road } from '../src/city/layout';
import { GeoBuilder } from '../src/buildings/builder';
import {
  MAX_HALF_INT,
  emitBuilding,
  industrialStacks,
  roofTopKind,
} from '../src/buildings/archetypes';
import { targets, windingAgreement } from './buildings-helpers';
import {
  LOD_DISTANCES,
  lodDistancesFor,
  bandLevels,
  braceLevels,
  chunkCenter,
  chunkCount,
  chunkGrid,
  chunkIndex,
  columnOffsets,
  cylinderSegments,
  districtLitFactor,
  faceRole,
  finOffsets,
  fitCells,
  keepInLod2,
  mergeIntervals,
  sideNormalXZ,
  stairSteps,
  windowStyle,
} from '../src/buildings/params';
import {
  buildRoads,
  buildSidewalks,
  crossingHalf,
  paveRect,
  puddleData,
} from '../src/buildings/roads';
import { alleyRetaining, stair } from '../src/buildings/street';
import { rectOutline, shoelace, circleOutline } from '../src/buildings/shapes';
import { WINDOW_LIT } from '../src/core/palette';

describe('window parameters (4.1)', () => {
  it('fits whole cells to a face', () => {
    for (const w of [3, 7.3, 25, 61.2]) {
      const f = fitCells(w, 1.5);
      expect(f.count).toBeGreaterThanOrEqual(1);
      expect(f.count * f.cellW).toBeCloseTo(w, 9);
      expect(Math.abs(f.cellW - 1.5)).toBeLessThan(0.8);
    }
    expect(fitCells(0.4, 2.6).count).toBe(1);
  });

  it('uses real window sizes smaller than a floor', () => {
    const archetypes = [
      'setbackTower',
      'officeSlab',
      'sangga',
      'apartmentSlab',
      'hillHouse',
    ] as const;
    for (const a of archetypes) {
      for (const role of ['front', 'back', 'south', 'north'] as const) {
        const s = windowStyle(a, role, 1);
        expect(s.winW).toBeLessThanOrEqual(s.cellW);
        expect(s.winH).toBeLessThanOrEqual(2.6);
      }
    }
    expect(windowStyle('sangga', 'front', 0)).toMatchObject({ winW: 1.6, winH: 1.6 });
    expect(windowStyle('hillHouse', 'front', 0)).toMatchObject({ winW: 0.9, winH: 1.1 });
    expect(windowStyle('sangga', 'side', 0).winW).toBe(0);
  });

  it('district lit factors reproduce the 3.4 night ranges at the median ratio', () => {
    for (const d of ['core', 'midtown', 'sangga', 'apartment', 'hillside'] as const) {
      const r = 0.32 * districtLitFactor(d);
      expect(r).toBeGreaterThanOrEqual(WINDOW_LIT.night[d][0]);
      expect(r).toBeLessThanOrEqual(WINDOW_LIT.night[d][1]);
    }
    expect(districtLitFactor('industrial')).toBeGreaterThan(0);
  });
});

describe('facade relief', () => {
  it('places bands inside the tier, above the window start', () => {
    const ys = bandLevels(0, 120, 6, 3.6, 5);
    expect(ys.length).toBeGreaterThan(3);
    for (const y of ys) {
      expect(y).toBeGreaterThan(6);
      expect(y).toBeLessThan(120 - 3.6);
    }
    expect(bandLevels(0, 10, 6, 3.6, 5)).toEqual([]);
  });

  it('spaces fins evenly and symmetrically with margins', () => {
    const f = finOffsets(30, 2);
    expect(f.length).toBe(15);
    expect(f[0]! + f[f.length - 1]!).toBeCloseTo(0, 9);
    for (const x of f) expect(Math.abs(x)).toBeLessThanOrEqual(14);
    expect(finOffsets(1.5, 2)).toEqual([]);
  });

  it('brace bays are ~16 m and span the tier', () => {
    const ys = braceLevels(6, 300);
    expect(ys[0]).toBe(6);
    expect(ys[ys.length - 1]).toBeCloseTo(300, 9);
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThan(12);
    const cols = columnOffsets(50, 24);
    expect(cols[0]).toBe(-25);
    expect(cols[cols.length - 1]).toBe(25);
  });

  it('stairs use ~0.3 m treads', () => {
    const s = stairSteps(40, 8);
    expect(40 / s.n).toBeCloseTo(0.3, 1);
    expect(s.riser * s.n).toBeCloseTo(8, 9);
  });

  it('merges crossing intervals', () => {
    const iv = mergeIntervals(
      [
        { t: 0.5, half: 10 },
        { t: 0.55, half: 10 },
        { t: 0.9, half: 5 },
      ],
      100,
    );
    expect(iv).toHaveLength(2);
    expect(iv[0]![0]).toBeCloseTo(0.4, 9);
    expect(iv[0]![1]).toBeCloseTo(0.65, 9);
    expect(iv[1]![0]).toBeCloseTo(0.85, 9);
    expect(iv[1]![1]).toBeCloseTo(0.95, 9);
  });
});

describe('face roles and normals', () => {
  it('matches the layout side normals', () => {
    for (const r of [0, 0.3, -1.2, 2.5]) {
      for (const side of ['px', 'nx', 'pz', 'nz'] as const) {
        const a = sideNormalXZ(side, r);
        const b = sideNormal(side, r);
        expect(a.x).toBeCloseTo(b.x, 9);
        expect(a.z).toBeCloseTo(b.z, 9);
      }
    }
  });

  it('apartment long faces split into south (balcony) and north (corridor)', () => {
    for (const spec of LAYOUT.buildings
      .filter((b) => b.archetype === 'apartmentSlab')
      .slice(0, 10)) {
      const roles = (['px', 'nx', 'pz', 'nz'] as const).map((s) => faceRole(spec, s));
      expect(roles.filter((r) => r === 'south')).toHaveLength(1);
      expect(roles.filter((r) => r === 'north')).toHaveLength(1);
      expect(roles.filter((r) => r === 'gable')).toHaveLength(2);
    }
  });

  it('outlines are wound for outward wall normals', () => {
    expect(shoelace(rectOutline(10, -5, 20, 8, 0.4).pts)).toBeLessThan(0);
    expect(shoelace(rectOutline(0, 0, 20, 8, 1, 2).pts)).toBeLessThan(0);
    expect(shoelace(circleOutline(3, 4, 10, 16).pts)).toBeLessThan(0);
  });
});

describe('chunks and LOD (4.4, 4.5)', () => {
  it('maps every position on the layout map to a chunk and back', () => {
    const grid = chunkGrid(LAYOUT, CITY.chunkSize);
    const nx = chunkCount(grid.halfX, grid.size);
    const nz = chunkCount(grid.halfZ, grid.size);
    expect(nx * nz).toBeLessThanOrEqual(81);
    const corner = chunkIndex(-grid.halfX + 1, grid.halfZ - 1, grid);
    expect(corner).toEqual({ i: 0, j: nz - 1 });
    const c = chunkCenter(corner.i, corner.j, grid);
    expect(c.x).toBeCloseTo(-grid.halfX + grid.size / 2, 9);
    expect(c.z).toBeCloseTo((-grid.halfZ + (nz - 1) * grid.size + grid.halfZ) / 2, 9);
    for (const b of LAYOUT.buildings) {
      const k = chunkIndex(b.x, b.z, grid);
      expect(k.i).toBeGreaterThanOrEqual(0);
      expect(k.i).toBeLessThan(nx);
      expect(k.j).toBeGreaterThanOrEqual(0);
      expect(k.j).toBeLessThan(nz);
    }
  });

  it('splits v2 and v3 map sizes into the planned chunk counts', () => {
    expect(chunkCount(1200, 256)).toBe(9);
    expect(chunkCenter(8, 8, chunkGrid({ extentX: 2400, extentZ: 2400 }, 256)).x).toBeCloseTo(
      1024,
      9,
    );
    expect(chunkCount(2000, 400)).toBe(10);
    expect(chunkCount(1300, 400)).toBe(7);
    const grid = chunkGrid({ extentX: 4000, extentZ: 2600 }, 400);
    expect(chunkIndex(1999, 1299, grid)).toEqual({ i: 9, j: 6 });
    expect(chunkCenter(9, 6, grid).z).toBeCloseTo(1200, 9);
  });

  it('uses 380 / 1100 m LOD distances', () => {
    expect(LOD_DISTANCES).toEqual([0, 380, 1100]);
    expect([0, 1, 2].map((l) => cylinderSegments(l as 0 | 1 | 2))).toEqual([48, 16, 8]);
    expect(keepInLod2({ h: 40, archetype: 'officeSlab' })).toBe(true);
    expect(keepInLod2({ h: 20, archetype: 'sangga' })).toBe(false);
  });
});

describe('archetype geometry', () => {
  const byArchetype = new Map<string, BuildingSpec[]>();
  for (const b of LAYOUT.buildings) {
    const list = byArchetype.get(b.archetype) ?? [];
    if (list.length < 4) list.push(b);
    byArchetype.set(b.archetype, list);
  }

  it('every archetype emits outward-wound geometry in all three LOD levels', () => {
    for (const [arch, specs] of byArchetype) {
      for (const spec of specs) {
        const T = targets();
        emitBuilding(spec, T);
        industrialStacks(spec, T);
        const g0 = T.l0.build();
        const g1 = T.l1.build();
        const g2 = T.l2.build();
        expect(g0, arch).not.toBeNull();
        expect(g1, arch).not.toBeNull();
        expect(g2, arch).not.toBeNull();
        for (const g of [g0, g1, g2]) expect(windingAgreement(g!), arch).toBeGreaterThan(0.97);
        expect(T.l0.vertexCount).toBeGreaterThanOrEqual(T.l1.vertexCount);
        expect(T.l1.vertexCount).toBeGreaterThanOrEqual(T.l2.vertexCount);
      }
    }
  });

  it('opposite faces get different window seeds', () => {
    const spec = byArchetype.get('officeSlab')![0]!;
    const T = targets();
    emitBuilding(spec, T);
    const g = T.l1.build()!;
    const info = g.getAttribute('aInfo');
    const N = g.getAttribute('normal');
    const seedFor = (nx: number, nz: number): number | undefined => {
      for (let i = 0; i < info.count; i++) {
        if (Math.floor(info.getX(i) / 2) === 0) continue;
        if (Math.abs(N.getX(i) - nx) < 0.05 && Math.abs(N.getZ(i) - nz) < 0.05) return info.getY(i);
      }
      return undefined;
    };
    const px = sideNormal('px', spec.rotY);
    const a = seedFor(px.x, px.z);
    const b = seedFor(-px.x, -px.z);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b);
  });

  it('동 numbers fit the half-float attribute exactly', () => {
    for (const b of LAYOUT.buildings) {
      if (b.tags.dong !== undefined) expect(b.tags.dong).toBeLessThan(MAX_HALF_INT);
    }
  });

  it('packs facade parameters losslessly into half floats', () => {
    const spec = byArchetype.get('apartmentSlab')![0]!;
    const T = targets();
    emitBuilding(spec, T);
    const g = T.l1.build()!;
    const info = g.getAttribute('aInfo');
    const win = g.getAttribute('aWin');
    const types = new Set<number>();
    for (let i = 0; i < info.count; i++) {
      const v = info.getX(i);
      expect(Number.isInteger(v)).toBe(true);
      types.add(Math.floor(v / 2));
      expect(info.getY(i)).toBeGreaterThanOrEqual(0);
    }
    expect([...types].sort()).toEqual(expect.arrayContaining([0, 3, 4]));
    let maxCell = 0;
    for (let i = 0; i < win.count; i++) maxCell = Math.max(maxCell, win.getX(i));
    expect(maxCell).toBeGreaterThan(2);
    expect(maxCell).toBeLessThan(10);
  });

  it('stays inside its footprint (plus props) and under its top', () => {
    for (const specs of byArchetype.values()) {
      for (const spec of specs) {
        const T = targets();
        emitBuilding(spec, T);
        const g = T.l1.build()!;
        g.computeBoundingBox();
        const bb = g.boundingBox!;
        const r = Math.hypot(spec.w, spec.d) / 2 + 3;
        expect(bb.min.x).toBeGreaterThan(spec.x - r);
        expect(bb.max.x).toBeLessThan(spec.x + r);
        expect(bb.min.y).toBeGreaterThanOrEqual(spec.baseY - 1e-3);
        expect(bb.max.y).toBeLessThanOrEqual(spec.baseY + spec.h + spec.spireH + 20);
      }
    }
  });

  it('roof silhouettes are deterministic and only on tall flat-topped towers', () => {
    for (const b of LAYOUT.buildings) {
      const k = roofTopKind(b);
      expect(roofTopKind(b)).toBe(k);
      if (k !== 'flat') {
        expect(b.h).toBeGreaterThanOrEqual(90);
        expect(b.spireH).toBe(0);
      }
    }
  });
});

describe('roads and sidewalks', () => {
  it('puddle / grain texture tiles without a seam', () => {
    const N = 256;
    const d = puddleData(2077, N);
    for (const ch of [0, 1]) {
      let wrap = 0;
      let inner = 0;
      for (let y = 0; y < N; y++) {
        const at = (x: number): number => d[(y * N + x) * 4 + ch]!;
        wrap += Math.abs(at(N - 1) - at(0));
        inner += Math.abs(at(N / 2) - at(N / 2 + 1));
      }
      expect(wrap).toBeLessThan(inner * 3 + N * 2);
    }
    let puddle = 0;
    for (let i = 0; i < N * N; i++) if (d[i * 4]! > 127) puddle++;
    const cover = puddle / (N * N);
    expect(cover).toBeGreaterThan(0.03);
    expect(cover).toBeLessThan(0.35);
  });

  it('stairs and retaining walls are wound outward', () => {
    const g = new GeoBuilder(0, 0);
    for (const r of LAYOUT.roads.filter((x) => x.kind === 'stair').slice(0, 10)) stair(g, r);
    for (const r of LAYOUT.roads.filter((x) => x.district === 'hillside').slice(0, 40)) {
      alleyRetaining(g, r);
    }
    expect(windingAgreement(g.build()!)).toBeGreaterThan(0.99);
  });

  it('road and sidewalk tops face up', () => {
    expect(windingAgreement(buildRoads(LAYOUT))).toBeGreaterThan(0.99);
    expect(windingAgreement(buildSidewalks(LAYOUT))).toBeGreaterThan(0.99);
  });

  it('paves the block plus the sidewalk ring', () => {
    const block = { x: 0, z: 0, w: 100, d: 60, rotY: 0.3 };
    const r = paveRect(block, [{ x: 0, z: 0, w: 10, d: 10, rotY: 0.3 }], 4)!;
    expect(r.x1 - r.x0).toBeCloseTo(108, 6);
    expect(r.z1 - r.z0).toBeCloseTo(68, 6);
    const out = paveRect(block, [{ x: 0, z: 0, w: 120, d: 10, rotY: 0.3 }], 2)!;
    expect(out.x1).toBeCloseTo(62, 6);
    expect(paveRect(block, [], 4)).toBeNull();
  });
});

describe('road crossings', () => {
  const road = (ax: number, az: number, bx: number, bz: number, width: number): Road => ({
    id: 0,
    kind: 'street',
    a: { x: ax, z: az },
    b: { x: bx, z: bz },
    width,
    district: 'sangga',
    zoneId: 'test',
  });

  it('keeps markings clear of a perpendicular road by its half width', () => {
    expect(crossingHalf(road(0, 0, 100, 0, 10), road(50, -50, 50, 50, 12))).toBeCloseTo(7, 9);
  });

  it('widens the clear span for diagonal crossings', () => {
    const r = road(0, 0, 100, 0, 10);
    const diag = road(0, -50, 100, 50, 12);
    const s = Math.SQRT1_2;
    expect(crossingHalf(r, diag)).toBeCloseTo((6 + 5 * s) / s + 1, 9);
    expect(crossingHalf(r, diag)).toBeGreaterThan(crossingHalf(r, road(50, -50, 50, 50, 12)));
    expect(crossingHalf(r, road(0, -1, 100, 1, 12))).toBe(100);
    const shallow = road(0, -6, 100, 6.2, 30);
    const sin = 12.2 / Math.hypot(100, 12.2);
    expect(crossingHalf(road(0, 0, 400, 0, 10), shallow)).toBeCloseTo(
      (15 + 5 * Math.sqrt(1 - sin * sin)) / sin + 1,
      6,
    );
  });
});

describe('quality tiers (perf design #66)', () => {
  it('sets the LOD0 radius per tier and builds no LOD0 on low and ci', () => {
    expect(lodDistancesFor('high')).toEqual([0, 380, 1100]);
    expect(lodDistancesFor('medium')).toEqual([0, 250, 1100]);
    expect(lodDistancesFor('low')[1]).toBe(0);
    expect(lodDistancesFor('low')[2]).toBe(1100);
    expect(lodDistancesFor('ci')).toEqual([0, 0, 380]);
  });
});
