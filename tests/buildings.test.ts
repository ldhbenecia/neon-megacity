import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { LAYOUT, sideNormal, type Archetype, type BuildingSpec } from '../src/city/layout';
import { GeoBuilder } from '../src/buildings/builder';
import {
  MAX_HALF_INT,
  emitBuilding,
  industrialStacks,
  roofTopKind,
  type Targets,
} from '../src/buildings/archetypes';
import {
  CHUNK_SIZE,
  LOD_DISTANCES,
  bandLevels,
  braceLevels,
  chunkCenter,
  chunkIndex,
  chunksPerAxis,
  columnOffsets,
  cylinderSegments,
  districtLitFactor,
  faceRole,
  finOffsets,
  fitCells,
  keepInLod2,
  lodLevel,
  mergeIntervals,
  sideNormalXZ,
  stairSteps,
  windowStyle,
} from '../src/buildings/params';
import { buildRoads, buildSidewalks, paveRect, puddleData } from '../src/buildings/roads';
import { alleyRetaining, stair } from '../src/buildings/street';
import { rectOutline, shoelace, circleOutline } from '../src/buildings/shapes';
import { WINDOW_LIT } from '../src/core/palette';

const targets = (): Targets => ({
  l0: new GeoBuilder(0, 0),
  l1: new GeoBuilder(0, 0),
  l2: new GeoBuilder(0, 0),
});

/** Fraction of triangles whose winding agrees with their stored vertex normals. */
function windingAgreement(g: THREE.BufferGeometry): number {
  const P = g.getAttribute('position');
  const N = g.getAttribute('normal');
  const I = g.getIndex();
  if (!I) return 0;
  let ok = 0;
  let total = 0;
  for (let i = 0; i < I.count; i += 3) {
    const [a, b, c] = [I.getX(i), I.getX(i + 1), I.getX(i + 2)];
    const ux = P.getX(b) - P.getX(a);
    const uy = P.getY(b) - P.getY(a);
    const uz = P.getZ(b) - P.getZ(a);
    const vx = P.getX(c) - P.getX(a);
    const vy = P.getY(c) - P.getY(a);
    const vz = P.getZ(c) - P.getZ(a);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-6) continue;
    const sx = N.getX(a) + N.getX(b) + N.getX(c);
    const sy = N.getY(a) + N.getY(b) + N.getY(c);
    const sz = N.getZ(a) + N.getZ(b) + N.getZ(c);
    total++;
    if (nx * sx + ny * sy + nz * sz > 0) ok++;
  }
  return total ? ok / total : 0;
}

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
    const archetypes: Archetype[] = [
      'setbackTower',
      'officeSlab',
      'sangga',
      'apartmentSlab',
      'hillHouse',
    ];
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
  it('maps positions to 256 m chunks and back', () => {
    const { i, j } = chunkIndex(-1199, 1199);
    expect(i).toBe(0);
    expect(j).toBe(chunksPerAxis() - 1);
    expect(chunksPerAxis() ** 2).toBeLessThanOrEqual(81);
    const c = chunkCenter(i, j);
    expect(Math.abs(c.x - -1199)).toBeLessThanOrEqual(CHUNK_SIZE / 2);
    expect(Math.abs(chunkCenter(j, j).z - 1199)).toBeLessThanOrEqual(CHUNK_SIZE);
    // Every building lands in a valid chunk.
    for (const b of LAYOUT.buildings) {
      const k = chunkIndex(b.x, b.z);
      expect(k.i).toBeGreaterThanOrEqual(0);
      expect(k.j).toBeLessThan(chunksPerAxis());
    }
  });

  it('selects levels at 380 / 1100 m', () => {
    expect(LOD_DISTANCES).toEqual([0, 380, 1100]);
    expect(lodLevel(0)).toBe(0);
    expect(lodLevel(379)).toBe(0);
    expect(lodLevel(380)).toBe(1);
    expect(lodLevel(1099)).toBe(1);
    expect(lodLevel(5000)).toBe(2);
    expect([0, 1, 2].map((l) => cylinderSegments(l as 0 | 1 | 2))).toEqual([48, 16, 8]);
    expect(keepInLod2({ h: 40, archetype: 'officeSlab' })).toBe(true);
    expect(keepInLod2({ h: 20, archetype: 'sangga' })).toBe(false);
  });
});

describe('archetype geometry', () => {
  const byArchetype = new Map<Archetype, BuildingSpec[]>();
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
        // LOD0 is the richest level, LOD2 the coarsest.
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
    // Plain roof, apartment south and corridor faces, plus the 동 number quad in LOD0 only.
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
      // Difference across the wrap (last column → first) vs. between neighbouring columns.
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
    // A footprint poking out of the block still gets paved around.
    const out = paveRect(block, [{ x: 0, z: 0, w: 120, d: 10, rotY: 0.3 }], 2)!;
    expect(out.x1).toBeCloseTo(62, 6);
    expect(paveRect(block, [], 4)).toBeNull();
  });
});
