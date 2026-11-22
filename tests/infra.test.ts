import { describe, expect, it } from 'vitest';
import {
  BRIDGE_LAND,
  BRIDGE_LAND_SOUTH,
  LAYOUT,
  MIN_ROAD_CLEARANCE,
  bridgeDeckY as layoutBridgeDeckY,
  buildingsInAabb,
  deckHeightAt,
  highwayCurve,
  riverSignedDistance,
  type BuildingSpec,
} from '../src/city/layout';
import { obbOverlap, pointSegmentDistance } from '../src/city/math';
import {
  approachPierBlocksRoad,
  approachStations,
  archY,
  deckYAt,
  bridgeFrame,
  bridgePoint,
  pierStations,
  resample,
} from '../src/infra/bridges';
import { buildInfra } from '../src/infra/build';
import { infraColors } from '../src/infra/colors';
import { deckRings, hwPath, nearestOnPath, ringsCovering, runs } from '../src/infra/highways';
import { MeshData, cross, dot, frameAt, framesAlong, norm, sub, type V3 } from '../src/infra/mesh';
import type { ColumnInstance } from '../src/infra/parts';
import { pillarInstances, pillarSpecs } from '../src/infra/pillars';
import {
  DECK_THICKNESS,
  barrierEdges,
  boxEdges,
  laneOffsets,
  laneWidth,
  markingLines,
  signedArea,
  slabEdges,
  slabLoop,
} from '../src/infra/profile';

const C = infraColors();
const deckColors = { asphalt: C.asphalt, concrete: C.concrete, underside: C.underside };

const vtx = (m: MeshData, i: number): V3 => [
  m.positions[i * 3]!,
  m.positions[i * 3 + 1]!,
  m.positions[i * 3 + 2]!,
];
const nrm = (m: MeshData, i: number): V3 => [
  m.normals[i * 3]!,
  m.normals[i * 3 + 1]!,
  m.normals[i * 3 + 2]!,
];

/** Every triangle's geometric normal agrees with its vertex normal (front faces outward). */
function expectConsistentWinding(m: MeshData): void {
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
    const fn = cross(sub(vtx(m, b), vtx(m, a)), sub(vtx(m, c), vtx(m, a)));
    if (Math.hypot(...fn) < 1e-9) continue;
    expect(dot(norm(fn), nrm(m, a))).toBeGreaterThan(0.5);
  }
}

const columnObb = (c: ColumnInstance) => ({
  x: c.x,
  z: c.z,
  hw: c.w / 2,
  hd: c.d / 2,
  rotY: c.rotY,
});
const buildingObb = (b: BuildingSpec) => ({
  x: b.x,
  z: b.z,
  hw: b.w / 2,
  hd: b.d / 2,
  rotY: b.rotY,
});

describe('infra: mesh builder', () => {
  const path: V3[] = [
    [0, 10, 0],
    [10, 10, 2],
    [20, 11, 6],
    [30, 11, 14],
  ];

  it('sweeps the deck slab, barriers and boxes with outward-facing triangles', () => {
    const m = new MeshData();
    const frames = framesAlong(path);
    m.sweep(frames, slabEdges(20, deckColors));
    m.sweep(frames, barrierEdges(10, 1, C.concrete));
    m.sweep(frames, barrierEdges(-10, -1, C.concrete));
    m.sweep(frames, boxEdges(-1, 1, 0, 3, C.concrete));
    m.cap(frames[0]!, slabLoop(20), C.concrete, -1);
    m.cap(frames.at(-1)!, slabLoop(20), C.concrete, 1);
    expect(m.triangleCount).toBeGreaterThan(0);
    expectConsistentWinding(m);
  });

  it('deck top faces up and sits exactly on the path', () => {
    const m = new MeshData();
    m.sweep(framesAlong(path), slabEdges(20, deckColors).slice(0, 1));
    for (let i = 0; i < m.vertexCount; i++) expect(nrm(m, i)[1]).toBeGreaterThan(0.95);
    // First ring, both top corners: same height as the path point, ±10 m to the side.
    expect(vtx(m, 0)[1]).toBeCloseTo(10, 1);
    expect(Math.hypot(vtx(m, 0)[0] - vtx(m, 1)[0], vtx(m, 0)[2] - vtx(m, 1)[2])).toBeCloseTo(20, 5);
  });

  it('beams have outward normals in any direction', () => {
    const m = new MeshData();
    m.beam([0, 0, 0], [5, 3, 1], 1, 2, C.steel);
    m.beam([0, 0, 0], [0, 10, 0], 0.5, 0.5, C.steel);
    m.beam([0, 0, 0], [0, 0, 10], 0.5, 0.5, C.steel, [0, 1, 0]);
    expectConsistentWinding(m);
    // Outward: face normals point away from the beam axis midpoint.
    const center: V3 = [2.5, 1.5, 0.5];
    for (let t = 0; t < 36; t += 3) {
      const a = m.indices[t]!;
      expect(dot(nrm(m, a), sub(vtx(m, a), center))).toBeGreaterThan(0);
    }
  });

  it('frames keep lat horizontal and up pointing up', () => {
    const f = frameAt([0, 0, 0], norm([1, 0.2, 0]));
    expect(f.lat[1]).toBeCloseTo(0, 9);
    expect(f.up[1]).toBeGreaterThan(0.9);
    // Right of travel: heading east, right is south (+Z).
    expect(f.lat[2]).toBeCloseTo(1, 9);
  });
});

describe('infra: cross-sections and lanes', () => {
  it('profile loops are clockwise (outward normals)', () => {
    expect(signedArea(slabLoop(26))).toBeLessThan(0);
  });

  it('lanes fit inside the barriers, sorted, at a realistic width', () => {
    for (const hw of LAYOUT.highways) {
      const o = laneOffsets(hw);
      expect(o).toHaveLength(hw.lanes);
      for (let i = 1; i < o.length; i++) expect(o[i]!).toBeGreaterThan(o[i - 1]!);
      const lw = laneWidth(hw);
      expect(lw).toBeGreaterThan(3.2);
      expect(lw).toBeLessThan(4.6);
      expect(Math.abs(o[0]!) + lw / 2).toBeLessThan(hw.width / 2 - 0.5);
      // Divided roads: same number of lanes on each side of the centerline.
      if (hw.kind !== 'ramp') expect(o.filter((x) => x > 0)).toHaveLength(hw.lanes / 2);
      const lines = markingLines(hw);
      expect(lines.filter((l) => l.dashed)).toHaveLength(hw.kind === 'ramp' ? 1 : hw.lanes - 2);
    }
  });
});

describe('infra: highway decks', () => {
  const paths = LAYOUT.highways.map((hw) => hwPath(hw));

  it('main decks follow the layout curve exactly; deckHeightAt agrees', () => {
    for (const p of paths) {
      const rings = deckRings(p, paths);
      if (p.hw.kind === 'ramp') continue;
      expect(rings.every((r) => !r.hidden)).toBe(true);
      for (const r of rings.filter((_, i) => i % 25 === 0)) {
        if (Math.abs(r.p[0]) > 1200 || Math.abs(r.p[2]) > 1200) continue;
        const y = deckHeightAt(LAYOUT, r.p[0], r.p[2]);
        expect(y).not.toBeNull();
        expect(y!).toBeGreaterThanOrEqual(r.p[1] - 0.05);
      }
    }
  });

  it('ramps are hidden only at their junction ends and never rise above a parent deck', () => {
    for (const p of paths.filter((q) => q.hw.kind === 'ramp')) {
      const rings = deckRings(p, paths);
      const visible = runs(rings, (r) => !r.hidden);
      expect(visible).toHaveLength(1);
      expect(visible[0]!.length).toBeGreaterThan(rings.length * 0.6);
      const curve = highwayCurve(p.hw);
      rings.forEach((r, i) => {
        const v = curve.getPointAt(i / (rings.length - 1));
        expect(r.p[1]).toBeLessThanOrEqual(v.y + 1e-6);
      });
    }
  });

  it('ringsCovering returns every ring under an interval, ends included', () => {
    const p = paths.find((q) => q.hw.kind === 'ramp')!;
    const rings = deckRings(p, paths);
    const length = rings.at(-1)!.s;
    const under = ringsCovering(rings, 10, 16, length);
    expect(under[0]!.s).toBeLessThanOrEqual(10);
    expect(under.at(-1)!.s).toBeGreaterThanOrEqual(16);
    expect(ringsCovering(rings, 0, length, length)).toHaveLength(rings.length);
  });

  it('nearestOnPath returns 0 distance on the centerline', () => {
    const p = paths[0]!;
    const mid = p.pts[Math.floor(p.pts.length / 2)]!;
    const q = nearestOnPath(p, mid[0], mid[2]);
    expect(q.d).toBeCloseTo(0, 6);
    expect(q.y).toBeCloseTo(mid[1], 6);
  });
});

describe('infra: pillars', () => {
  const specs = pillarSpecs(LAYOUT);
  const inst = specs.map(pillarInstances);
  const raised = LAYOUT.highways.filter((hw) => hw.kind !== 'atGrade');

  it('keeps nearly every layout pillar (only junction duplicates are dropped)', () => {
    const total = raised.reduce((n, hw) => n + hw.pillars.length, 0);
    expect(specs.length).toBeGreaterThan(total * 0.9);
    expect(specs.length).toBeLessThanOrEqual(total);
    expect(specs.filter((s) => s.kind === 'Y').length).toBeGreaterThan(20);
    expect(specs.filter((s) => s.kind === 'T').length).toBeGreaterThan(40);
  });

  it('columns never touch a building footprint (0 collisions)', () => {
    let hits = 0;
    for (const { column: c } of inst) {
      const r = Math.hypot(c.w, c.d);
      for (const id of buildingsInAabb(LAYOUT, c.x - r, c.z - r, c.x + r, c.z + r)) {
        if (obbOverlap(columnObb(c), buildingObb(LAYOUT.buildings[id]!), 0)) hits++;
      }
    }
    expect(hits).toBe(0);
  });

  it('columns stand on dry ground, off bridges, and never overlap each other', () => {
    for (const { column: c } of inst) {
      expect(riverSignedDistance(c.x, c.z)).toBeGreaterThan(0);
      for (const br of LAYOUT.bridges) {
        expect(pointSegmentDistance(c, br.landA, br.landB)).toBeGreaterThan(br.width / 2);
      }
      expect(c.y1 - c.y0).toBeGreaterThan(5);
    }
    for (let i = 0; i < inst.length; i++) {
      for (let j = i + 1; j < inst.length; j++) {
        expect(obbOverlap(columnObb(inst[i]!.column), columnObb(inst[j]!.column), 0)).toBe(false);
      }
    }
  });

  it('caps and arms stay under the deck slab', () => {
    for (const [i, s] of specs.entries()) {
      const under = s.deckY - DECK_THICKNESS;
      expect(inst[i]!.column.y1).toBeLessThanOrEqual(under + 1e-6);
      for (const b of inst[i]!.beams) {
        // Top of an axis-aligned (roll 0) beam; rolled arms end at the deck underside.
        if (b.roll === 0) expect(b.center[1] + b.size[1] / 2).toBeLessThanOrEqual(under + 1e-6);
        expect(b.size[0]).toBeLessThan(s.deckW);
      }
    }
  });

  it('no column pierces another deck', () => {
    const paths = LAYOUT.highways.filter((hw) => hw.kind !== 'atGrade').map((hw) => hwPath(hw));
    for (const [i, s] of specs.entries()) {
      for (const p of paths) {
        if (p.hw.id === s.owner) continue;
        const q = nearestOnPath(p, s.x, s.z);
        if (q.d < p.hw.width / 2 + 2) {
          // Only allowed when that deck is above this pillar's own deck.
          expect(q.y - DECK_THICKNESS).toBeGreaterThan(inst[i]!.column.y1);
        }
      }
    }
  });
});

describe('infra: bridges', () => {
  it('deck profile matches the layout bridgeDeckY within 1 cm, landings included', () => {
    for (const b of LAYOUT.bridges) {
      const f = bridgeFrame(b);
      expect(f.spanHalf).toBeCloseTo(120, 6);
      // Asymmetric approaches: north lands at BRIDGE_LAND, south at BRIDGE_LAND_SOUTH.
      expect(-f.landA).toBeCloseTo(BRIDGE_LAND, 3);
      expect(f.landB).toBeCloseTo(BRIDGE_LAND_SOUTH, 3);
      for (let s = f.landA + 1; s < f.landB; s += 7) {
        const p = bridgePoint(f, s, 0, 0);
        const y = layoutBridgeDeckY(b, p[0], p[2]);
        expect(y).not.toBeNull();
        expect(Math.abs(deckYAt(b, f, s) - y!)).toBeLessThan(0.01);
        // deckHeightAt reports the highest deck (river-north passes over the approaches).
        expect(deckHeightAt(LAYOUT, p[0], p[2])!).toBeGreaterThanOrEqual(y! - 0.01);
      }
    }
  });

  it('every deck underside clears the roads and decks it crosses by MIN_ROAD_CLEARANCE', () => {
    // River-north (16 m) over the north approaches, south approach over hw-south.
    for (const b of LAYOUT.bridges) {
      const f = bridgeFrame(b);
      for (const hw of LAYOUT.highways) {
        const path = hwPath(hw);
        for (let s = f.landA; s <= f.landB; s += 1) {
          const p = bridgePoint(f, s, 0, 0);
          const q = nearestOnPath(path, p[0], p[2]);
          if (q.d > hw.width / 2) continue;
          const bridgeY = deckYAt(b, f, s);
          const [upper, lower] = q.y > bridgeY ? [q.y, bridgeY] : [bridgeY, q.y];
          expect(
            upper - DECK_THICKNESS - lower,
            `${b.id} × ${hw.id} at s ${s}`,
          ).toBeGreaterThanOrEqual(MIN_ROAD_CLEARANCE - 0.01);
        }
      }
    }
  });

  it('resample skips repeated points instead of producing NaN', () => {
    const r = resample(
      [
        [0, 0, 0],
        [0, 0, 0],
        [12, 0, 0],
        [12, 0, 0],
      ],
      6,
    );
    expect(r).toHaveLength(3);
    for (const p of r) for (const v of p) expect(Number.isFinite(v)).toBe(true);
  });

  it('arch A crowns at y 48 and gets cyan points every 6 m', () => {
    const a = LAYOUT.bridges.find((b) => b.kind === 'arch')!;
    expect(archY(60, 0, 120, a.deckY - 1, a.deckY + a.structureH)).toBeCloseTo(48, 9);
    const pts: V3[] = [];
    for (let i = 0; i <= 32; i++) pts.push([i * 4, archY(i * 4, 0, 128, 11, 48), 0]);
    const r = resample(pts, 6);
    for (let i = 1; i < r.length; i++) {
      // Chord ≤ arc step.
      expect(Math.hypot(...sub(r[i]!, r[i - 1]!))).toBeLessThanOrEqual(6 + 1e-6);
      expect(Math.hypot(...sub(r[i]!, r[i - 1]!))).toBeGreaterThan(5);
    }
  });

  it('piers stand in the channel, approach piers clear every highway deck and building', () => {
    for (const b of LAYOUT.bridges) {
      const f = bridgeFrame(b);
      for (const s of pierStations(b, f)) {
        const p = bridgePoint(f, s, 0, 0);
        expect(riverSignedDistance(p[0], p[2])).toBeLessThan(0);
      }
      for (const s of approachStations(f)) {
        const p = bridgePoint(f, s, 0, 0);
        for (const hw of LAYOUT.highways) {
          const q = nearestOnPath(hwPath(hw), p[0], p[2]);
          expect(q.d, `${b.id} approach pier vs ${hw.id}`).toBeGreaterThan(hw.width / 2 + 1);
        }
      }
    }
    const parts = buildInfra(LAYOUT, C);
    const bridgeColumns = parts.columns.filter((c) => c.owner.startsWith('bridge'));
    // Approach piers never stand on a ground road (roads may cross under the long south ramp).
    for (const c of bridgeColumns) expect(approachPierBlocksRoad(c, LAYOUT.roads)).toBe(false);
    expect(bridgeColumns.length).toBeGreaterThanOrEqual(8);
    for (const c of bridgeColumns) {
      const r = Math.hypot(c.w, c.d);
      for (const id of buildingsInAabb(LAYOUT, c.x - r, c.z - r, c.x + r, c.z + r)) {
        expect(obbOverlap(columnObb(c), buildingObb(LAYOUT.buildings[id]!), 0)).toBe(false);
      }
    }
  });
});

describe('infra: whole build', () => {
  const parts = buildInfra(LAYOUT, C);

  it('is deterministic', () => {
    const again = buildInfra(LAYOUT, C);
    expect(again.concrete.triangleCount).toBe(parts.concrete.triangleCount);
    expect(again.points.length).toBe(parts.points.length);
    expect(again.concrete.positions.slice(0, 300)).toEqual(parts.concrete.positions.slice(0, 300));
  });

  it('stays inside the triangle budget', () => {
    const merged =
      parts.concrete.triangleCount +
      parts.steel.triangleCount +
      parts.markings.triangleCount +
      parts.glow.triangleCount +
      parts.wash.triangleCount;
    // Instanced: columns 14 tris (+ caps), beams 12, points 8.
    const instanced = parts.columns.length * 28 + parts.beams.length * 12 + parts.points.length * 8;
    expect(merged + instanced).toBeLessThan(300_000);
    expect(parts.points.length).toBeGreaterThan(300);
    expect(parts.glow.triangleCount).toBeGreaterThan(0);
    expect(parts.wash.triangleCount).toBeGreaterThan(0);
  });

  it('merged geometry has consistent winding', () => {
    expectConsistentWinding(parts.concrete);
    expectConsistentWinding(parts.markings);
    expectConsistentWinding(parts.wash);
    expectConsistentWinding(parts.steel);
  });
});
