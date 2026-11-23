import { describe, expect, it } from 'vitest';
import {
  LAYOUT,
  buildingContaining,
  buildingFaces,
  toLocal,
  type BuildingFace,
  type BuildingSpec,
} from '../src/city/layout';
import { buildCatalog } from '../src/neon/catalog';
import { EDGE_IN, TIER_MARGIN, insideFace, placeSigns, type FlatSign } from '../src/neon/placement';
import { buildingSolids, firstHit, solidsOverlap, type Solid } from '../src/neon/solids';

const faces = LAYOUT.buildings.map((b) => buildingFaces(b));
const cat = buildCatalog(LAYOUT);
const P = placeSigns(LAYOUT, faces, cat);
const EPS = 1e-6;

const face = (b: number, fi: number): BuildingFace => faces[b]![fi]!;
const spec = (id: number): BuildingSpec => LAYOUT.buildings[id]!;

const planeDist = (f: BuildingFace, x: number, z: number): number =>
  (x - f.center.x) * f.normal.x + (z - f.center.z) * f.normal.z;
const faceU = (f: BuildingFace, x: number, z: number): number =>
  (x - f.center.x) * f.tangent.x + (z - f.center.z) * f.tangent.z;

function quadPoints(s: FlatSign): [number, number, number][] {
  const tx = -s.nz;
  const tz = s.nx;
  const pts: [number, number, number][] = [];
  for (const a of [-0.5, 0, 0.5]) {
    for (const v of [-0.5, 0, 0.5]) {
      pts.push([s.x + tx * a * s.w + s.nx * 0.02, s.y + v * s.h, s.z + tz * a * s.w + s.nz * 0.02]);
    }
  }
  return pts;
}

describe('neon sign placement: zero penetration (5.1)', () => {
  it('wall signs stay inside one tier face with the 2 m / 1 m margins', () => {
    const wall = P.flats.filter((s) => s.face >= 0);
    expect(wall.length).toBeGreaterThan(1000);
    for (const s of wall) {
      const f = face(s.building, s.face);
      expect(insideFace(f, s.u0, s.u1, s.y0, s.y1)).toBe(true);
      expect(s.y0).toBeGreaterThanOrEqual(f.y0 + TIER_MARGIN - EPS);
      expect(s.y1).toBeLessThanOrEqual(f.y1 - TIER_MARGIN + EPS);
      expect(Math.abs(s.u0)).toBeLessThanOrEqual(f.width / 2 - EDGE_IN + EPS);
      expect(Math.abs(s.u1)).toBeLessThanOrEqual(f.width / 2 - EDGE_IN + EPS);
      expect(s.y - s.h / 2).toBeCloseTo(s.y0, 6);
      expect(s.y + s.h / 2).toBeCloseTo(s.y1, 6);
    }
  });

  it('no sign volume cuts into any building solid (tiers, twin, cantilever, skybridge, neighbours)', () => {
    const vols: Solid[] = [
      ...P.flats.map((s) => s.vol).filter((v): v is Solid => v !== null),
      ...P.tubes.map((t) => t.vol),
      ...P.screens.map((s) => s.vol),
    ];
    let hits = 0;
    for (const v of vols) if (firstHit(LAYOUT, v)) hits++;
    expect(hits).toBe(0);
  });

  it('no sign point lies inside a building (independent check with buildingContaining)', () => {
    let inside = 0;
    for (const s of P.flats) {
      for (const [x, y, z] of quadPoints(s))
        if (buildingContaining(LAYOUT, x, y, z) !== null) inside++;
    }
    for (const t of P.tubes) {
      for (const y of [t.y0, (t.y0 + t.y1) / 2, t.y1]) {
        if (buildingContaining(LAYOUT, t.x, y, t.z) !== null) inside++;
      }
    }
    for (const s of P.screens) {
      for (const a of [-0.5, 0, 0.5]) {
        for (const v of [-0.5, 0, 0.5]) {
          const x = s.x - s.nz * a * s.w + s.nx * 0.02;
          const z = s.z + s.nx * a * s.w + s.nz * 0.02;
          if (buildingContaining(LAYOUT, x, s.y + v * s.h, z) !== null) inside++;
        }
      }
    }
    expect(inside).toBe(0);
  });

  it('wall signs are attached to their wall (not floating)', () => {
    for (const s of P.flats.filter((k) => k.face >= 0)) {
      const f = face(s.building, s.face);
      const d = planeDist(f, s.x, s.z);
      if (s.kind === 'blade') {
        expect(d - s.w / 2).toBeGreaterThan(0);
        expect(d - s.w / 2).toBeLessThanOrEqual(0.3);
        expect(Math.abs(s.nx * f.tangent.x + s.nz * f.tangent.z)).toBeCloseTo(1, 6);
      } else {
        expect(d).toBeGreaterThan(0);
        expect(d).toBeLessThanOrEqual(0.5);
        expect(s.nx * f.normal.x + s.nz * f.normal.z).toBeCloseTo(1, 6);
        expect(faceU(f, s.x, s.z)).toBeCloseTo((s.u0 + s.u1) / 2, 6);
      }
    }
    for (const t of P.tubes) {
      const f = face(t.building, t.face);
      const d = planeDist(f, t.x, t.z);
      expect(d - t.radius).toBeGreaterThan(0);
      expect(d - t.radius).toBeLessThanOrEqual(0.3);
    }
  });

  it('signs on the same face never overlap', () => {
    const byFace = new Map<string, { u0: number; u1: number; y0: number; y1: number }[]>();
    const rects = [
      ...P.flats.filter((s) => s.face >= 0),
      ...P.tubes.map((t) => {
        const f = face(t.building, t.face);
        const u = faceU(f, t.x, t.z);
        return { ...t, u0: u - t.radius, u1: u + t.radius };
      }),
      ...P.screens,
    ];
    for (const r of rects) {
      const key = `${r.building}:${r.face}`;
      const list = byFace.get(key) ?? [];
      for (const o of list) {
        const hit = r.u0 < o.u1 && o.u0 < r.u1 && r.y0 < o.y1 && o.y0 < r.y1;
        expect(hit).toBe(false);
      }
      list.push(r);
      byFace.set(key, list);
    }
  });

  it('tubes stay within one tier height range', () => {
    for (const t of P.tubes) {
      const f = face(t.building, t.face);
      expect(t.y0).toBeGreaterThanOrEqual(f.y0 + TIER_MARGIN - EPS);
      expect(t.y1).toBeLessThanOrEqual(f.y1 - TIER_MARGIN + EPS);
      expect(t.y1 - t.y0).toBeGreaterThanOrEqual(10 - EPS);
      expect(t.y1 - t.y0).toBeLessThanOrEqual(60 + EPS);
    }
  });

  it('roof crowns and crosses stand on the roof of the top tier', () => {
    const roofOk = (b: BuildingSpec, x: number, z: number): boolean => {
      const t = b.tiers[b.tiers.length - 1]!;
      const l = toLocal(x - t.x, z - t.z, b.rotY);
      return Math.abs(l.x) <= t.w / 2 && Math.abs(l.z) <= t.d / 2;
    };
    for (const s of P.flats.filter((k) => k.kind === 'crown')) {
      const b = spec(s.building);
      const top = b.tiers[b.tiers.length - 1]!;
      expect(s.y0).toBeCloseTo(top.y1 + 0.6, 6);
      expect(roofOk(b, s.x, s.z)).toBe(true);
      expect(firstHit(LAYOUT, s.vol!)).toBeNull();
    }
    expect(P.crosses.length).toBeGreaterThan(100);
    for (const c of P.crosses) {
      const b = spec(c.building);
      expect(b.tags.cross).toBe(true);
      expect(c.roofY).toBeCloseTo(b.tiers[b.tiers.length - 1]!.y1, 6);
      expect(roofOk(b, c.x, c.z)).toBe(true);
      expect(c.h).toBeGreaterThanOrEqual(4);
      expect(c.h).toBeLessThanOrEqual(8);
      expect(c.poleH).toBeGreaterThanOrEqual(3);
      expect(c.poleH).toBeLessThanOrEqual(6);
    }
  });

  it('giant screens follow 5.1 (15–24, ≤ 2 per tower, 25–75% height, ≤ 85% tier, ratio ≥ 3)', () => {
    expect(P.screens.length).toBeGreaterThanOrEqual(15);
    expect(P.screens.length).toBeLessThanOrEqual(24);
    const per = new Map<number, number>();
    for (const s of P.screens) {
      per.set(s.building, (per.get(s.building) ?? 0) + 1);
      const b = spec(s.building);
      const f = face(s.building, s.face);
      expect(s.h / s.w).toBeGreaterThanOrEqual(3 - EPS);
      expect(s.w).toBeGreaterThanOrEqual(12 - EPS);
      expect(s.w).toBeLessThanOrEqual(28 + EPS);
      expect(s.h).toBeGreaterThanOrEqual(60 - EPS);
      expect(s.h).toBeLessThanOrEqual(150 + EPS);
      expect(s.h).toBeLessThanOrEqual((f.y1 - f.y0) * 0.85 + EPS);
      expect(s.y0).toBeGreaterThanOrEqual(b.baseY + b.h * 0.25 - EPS);
      expect(s.y1).toBeLessThanOrEqual(b.baseY + b.h * 0.75 + EPS);
      expect(insideFace(f, s.u0, s.u1, s.y0, s.y1)).toBe(true);
    }
    for (const n of per.values()) expect(n).toBeLessThanOrEqual(2);
  });

  it('ring billboards wrap cylinder towers without touching other solids', () => {
    expect(P.rings.length).toBeGreaterThanOrEqual(8);
    expect(P.rings.length).toBeLessThanOrEqual(14);
    const per = new Map<number, number[]>();
    for (const r of P.rings) {
      const b = spec(r.building);
      const t = b.tiers[0]!;
      expect(t.shape).toBe('cylinder');
      expect(r.radius).toBeCloseTo(t.w / 2 + 3, 6);
      expect(r.y - r.h / 2).toBeGreaterThanOrEqual(b.baseY + b.h * 0.3 - EPS);
      expect(r.y + r.h / 2).toBeLessThanOrEqual(b.baseY + b.h * 0.6 + EPS);
      const ys = per.get(r.building) ?? [];
      for (const y of ys) expect(Math.abs(y - r.y)).toBeGreaterThanOrEqual(25 - EPS);
      ys.push(r.y);
      per.set(r.building, ys);
      const shell: Solid = {
        kind: 'cyl',
        x: r.x,
        z: r.z,
        hw: r.radius,
        hd: r.radius,
        rotY: 0,
        y0: r.y - r.h / 2,
        y1: r.y + r.h / 2,
        building: -1,
        tier: -10,
        stack: 0,
      };
      for (const id of LAYOUT.buildings.map((k) => k.id)) {
        const other = spec(id);
        if (Math.hypot(other.x - r.x, other.z - r.z) > r.radius + 120) continue;
        for (const s of buildingSolids(other)) {
          if (s.building === r.building && s.tier === 0 && s.stack === 0) continue;
          expect(solidsOverlap(shell, s)).toBe(false);
        }
      }
    }
  });

  it('holograms float clear of buildings', () => {
    expect(P.holos.length).toBeGreaterThan(10);
    for (const h of P.holos) {
      const v: Solid = {
        kind: 'cyl',
        x: h.x,
        z: h.z,
        hw: h.size / 2,
        hd: h.size / 2,
        rotY: 0,
        y0: h.y - h.size / 2,
        y1: h.y + h.size / 2,
        building: -1,
        tier: -10,
        stack: 0,
      };
      expect(firstHit(LAYOUT, v)).toBeNull();
    }
  });

  it('is deterministic and inside the 5.1 budget', () => {
    const again = placeSigns(LAYOUT, faces, cat);
    expect(again.flats.length).toBe(P.flats.length);
    expect(again.flats[123]).toEqual(P.flats[123]);
    const total =
      P.flats.length +
      P.tubes.length +
      P.crosses.length +
      P.screens.length +
      P.rings.length +
      P.holos.length;
    expect(total).toBeGreaterThanOrEqual(2500);
    expect(total).toBeLessThanOrEqual(8000);
    const moving =
      P.flats.filter((s) => s.anim !== 0).length + P.tubes.filter((t) => t.anim !== 0).length;
    expect(moving / (P.flats.length + P.tubes.length)).toBeLessThanOrEqual(0.1);
  });

  it('apartment crowns show their own complex name', () => {
    const crowns = P.flats.filter((s) => s.kind === 'crown' && spec(s.building).tags.complex);
    expect(crowns.length).toBeGreaterThan(0);
    for (const s of crowns) expect(cat.cells[s.cell]?.key).toBe(spec(s.building).tags.complex);
  });
});

describe('neon solids', () => {
  it('touching boxes do not count as overlap; penetrating ones do', () => {
    const a: Solid = {
      kind: 'box',
      x: 0,
      z: 0,
      hw: 1,
      hd: 1,
      rotY: 0.3,
      y0: 0,
      y1: 2,
      building: 0,
      tier: 0,
      stack: 0,
    };
    const touch: Solid = { ...a, x: 2 * Math.cos(0.3), z: -2 * Math.sin(0.3) };
    const cut: Solid = { ...a, x: 1.5 * Math.cos(0.3), z: -1.5 * Math.sin(0.3) };
    const above: Solid = { ...cut, y0: 2, y1: 3 };
    expect(solidsOverlap(a, touch)).toBe(false);
    expect(solidsOverlap(a, cut)).toBe(true);
    expect(solidsOverlap(a, above)).toBe(false);
    const cyl: Solid = { ...a, kind: 'cyl', x: 1.8, z: 0, hw: 1, hd: 1, rotY: 0 };
    const box0: Solid = { ...a, rotY: 0 };
    expect(solidsOverlap(box0, cyl)).toBe(true);
    expect(solidsOverlap(box0, { ...cyl, x: 1.9 })).toBe(true);
    expect(solidsOverlap(box0, { ...cyl, x: 3 })).toBe(false);
  });

  it('cantilever masses and skybridges are solids', () => {
    const cant = LAYOUT.buildings.find((b) => b.cantilever);
    const twin = LAYOUT.buildings.find((b) => b.skybridge);
    if (cant) expect(buildingSolids(cant).some((s) => s.tier === -1)).toBe(true);
    if (twin) expect(buildingSolids(twin).some((s) => s.tier === -2)).toBe(true);
  });
});
