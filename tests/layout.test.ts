import { describe, expect, it } from 'vitest';
import {
  CITY,
  LAYOUT,
  MEGA_MIN_H,
  RIVER,
  RIVER_CLEARANCE,
  SKYLINE_PEAK,
  ZONES,
  allTiers,
  buildingContaining,
  buildingTop,
  buildingVolumes,
  riverFrame,
  buildingFaces,
  buildingsInAabb,
  deckHeightAt,
  districtAt,
  generateLayout,
  highwaySamples,
  raycastBuildings,
  ridgeHeight,
  riverSignedDistance,
  riverZ,
  surfaceHeight,
  terrainHeight,
  zoneAt,
  type BuildingSpec,
  type Tier,
} from '../src/city/layout';
import { fitScale } from '../src/city/generate';
import {
  hashString,
  obbOverlap,
  obbSegmentDistance,
  pointSegmentDistance,
  sideNormal,
  toLocal,
} from '../src/city/math';
import { fbm1 } from '../src/city/noise';

const EPS = 1e-6;
const B = LAYOUT.buildings;

const obb = (b: BuildingSpec) => ({ x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, rotY: b.rotY });

/** Stable digest of the layout (rounded so it is robust to last-bit float noise). */
function digest(L: typeof LAYOUT): string {
  const json = JSON.stringify(L, (_k, v: unknown) =>
    typeof v === 'number' ? Math.round(v * 1000) / 1000 : v,
  );
  return hashString(json).toString(16);
}

describe('layout v2: determinism', () => {
  it('is deterministic for the default seed', () => {
    const again = generateLayout(CITY.seed);
    expect(again).toEqual(LAYOUT);
    expect(digest(again)).toBe(digest(LAYOUT));
  });

  it('matches the pinned snapshot (update deliberately when the layout changes)', () => {
    expect({
      buildings: B.length,
      roads: LAYOUT.roads.length,
      blocks: LAYOUT.blocks.length,
      slots: LAYOUT.slots.length,
      digest: digest(LAYOUT),
    }).toMatchInlineSnapshot(`
      {
        "blocks": 936,
        "buildings": 4329,
        "digest": "ed6e1dae",
        "roads": 1082,
        "slots": 1802,
      }
    `);
  });

  it('changes with the seed', () => {
    expect(generateLayout(1).buildings).not.toEqual(LAYOUT.buildings);
  });

  it('uses ids equal to array indices', () => {
    B.forEach((b, i) => expect(b.id).toBe(i));
    LAYOUT.roads.forEach((r, i) => expect(r.id).toBe(i));
    LAYOUT.blocks.forEach((bl, i) => {
      expect(bl.id).toBe(i);
      for (const id of bl.buildingIds) expect(B[id]!.blockId).toBe(i);
    });
  });
});

describe('layout v2: counts (ART_DIRECTION 2.6)', () => {
  const count = (pred: (b: BuildingSpec) => boolean) => B.filter(pred).length;

  it('has 3600..4800 buildings, 2200..3200 hill houses, 8..12 megatowers', () => {
    expect(B.length).toBeGreaterThanOrEqual(3600);
    expect(B.length).toBeLessThanOrEqual(4800);
    const hill = count((b) => b.archetype === 'hillHouse');
    expect(hill).toBeGreaterThanOrEqual(2200);
    expect(hill).toBeLessThanOrEqual(3200);
    const mega = count((b) => b.h >= MEGA_MIN_H);
    expect(mega).toBeGreaterThanOrEqual(8);
    expect(mega).toBeLessThanOrEqual(12);
  });

  it('puts the 520 m peak near the skyline anchor with two ≥ 450 m followers', () => {
    const sorted = [...B].sort((a, b) => b.h - a.h);
    const top = sorted[0]!;
    expect(top.h).toBe(520);
    expect(Math.hypot(top.x - SKYLINE_PEAK.x, top.z - SKYLINE_PEAK.z)).toBeLessThan(120);
    expect(sorted[1]!.h).toBeGreaterThanOrEqual(450);
    expect(sorted[2]!.h).toBeGreaterThanOrEqual(450);
    expect(sorted[3]!.h).toBeLessThan(450);
    expect(sorted.slice(0, 12).every((b) => b.district === 'core')).toBe(true);
  });

  it('has the expected infrastructure', () => {
    expect(LAYOUT.bridges.map((b) => b.id)).toEqual(['bridge-a', 'bridge-b', 'bridge-c']);
    expect(LAYOUT.highways.map((h) => h.id)).toEqual([
      'hw-river-north',
      'hw-ring',
      'hw-interchange-a',
      'hw-interchange-b',
      'hw-south',
    ]);
    expect(LAYOUT.ridges.map((r) => r.radius)).toEqual([2500, 4000, 6000]);
    expect(LAYOUT.river.centerline).toHaveLength(33);
  });

  it('places street slots within the 6.2 target ranges', () => {
    const n = (k: string) => LAYOUT.slots.filter((s) => s.kind === k).length;
    const within = (k: string, lo: number, hi: number) => {
      expect(n(k), k).toBeGreaterThanOrEqual(lo);
      expect(n(k), k).toBeLessThanOrEqual(hi);
    };
    within('streetLight', 400, 650);
    within('tree', 500, 900);
    within('signPole', 150, 320);
    within('pojangmacha', 40, 70);
    within('busStop', 30, 50);
    within('stairLamp', 200, 350);
  });
});

describe('layout v2: no overlaps', () => {
  it('buildings never overlap each other', () => {
    for (const b of B) {
      for (const id of buildingsInAabb(LAYOUT, b.x - 60, b.z - 60, b.x + 60, b.z + 60)) {
        if (id <= b.id) continue;
        expect(obbOverlap(obb(b), obb(B[id]!)), `${b.id} vs ${id}`).toBe(false);
      }
    }
  });

  it('buildings never overlap a road', () => {
    for (const road of LAYOUT.roads) {
      const pad = road.width / 2 + 100;
      const ids = buildingsInAabb(
        LAYOUT,
        Math.min(road.a.x, road.b.x) - pad,
        Math.min(road.a.z, road.b.z) - pad,
        Math.max(road.a.x, road.b.x) + pad,
        Math.max(road.a.z, road.b.z) + pad,
      );
      for (const id of ids) {
        const d = obbSegmentDistance(obb(B[id]!), road.a, road.b);
        expect(d, `building ${id} vs road ${road.id}`).toBeGreaterThanOrEqual(road.width / 2);
      }
    }
  });

  it('buildings keep clear of the river channel', () => {
    for (const b of B) {
      const c = LAYOUT.river.centerline;
      for (let i = 0; i < c.length - 1; i++) {
        const d = obbSegmentDistance(obb(b), c[i]!, c[i + 1]!);
        expect(d - RIVER.width / 2, `building ${b.id}`).toBeGreaterThanOrEqual(RIVER_CLEARANCE);
      }
      expect(riverSignedDistance(b.x, b.z)).toBeGreaterThanOrEqual(RIVER_CLEARANCE);
    }
  });

  it('buildings stay out of highway corridors (width + 6 m) and off pillars', () => {
    for (const hw of LAYOUT.highways) {
      const s = highwaySamples(hw, 8);
      for (let i = 0; i < s.length - 1; i++) {
        const a = s[i]!;
        const c = s[i + 1]!;
        const pad = hw.corridorHalf + 100;
        const ids = buildingsInAabb(
          LAYOUT,
          Math.min(a.x, c.x) - pad,
          Math.min(a.z, c.z) - pad,
          Math.max(a.x, c.x) + pad,
          Math.max(a.z, c.z) + pad,
        );
        for (const id of ids) {
          expect(obbSegmentDistance(obb(B[id]!), a, c), `${hw.id} vs ${id}`).toBeGreaterThanOrEqual(
            hw.corridorHalf,
          );
        }
      }
      for (const p of hw.pillars) {
        for (const id of buildingsInAabb(LAYOUT, p.x - 4, p.z - 4, p.x + 4, p.z + 4)) {
          expect(obbSegmentDistance(obb(B[id]!), p, p), `pillar vs ${id}`).toBeGreaterThan(3);
        }
      }
    }
  });

  it('buildings stay off bridges and their approaches', () => {
    for (const br of LAYOUT.bridges) {
      for (const b of B) {
        expect(obbSegmentDistance(obb(b), br.landA, br.landB)).toBeGreaterThanOrEqual(br.width / 2);
      }
    }
  });

  it('highway pillars never stand on a bridge deck or in the water', () => {
    for (const hw of LAYOUT.highways) {
      for (const p of hw.pillars) {
        for (const br of LAYOUT.bridges) {
          expect(pointSegmentDistance(p, br.landA, br.landB)).toBeGreaterThan(br.width / 2);
        }
        expect(riverSignedDistance(p.x, p.z)).toBeGreaterThan(0);
      }
    }
  });
});

describe('layout v2: tiers', () => {
  const stacks = (b: BuildingSpec): Tier[][] => (b.twin ? [b.tiers, b.twin] : [b.tiers]);

  it('stack from baseY to baseY + h and never grow upward', () => {
    for (const b of B) {
      for (const tiers of stacks(b)) {
        expect(tiers.length).toBeGreaterThan(0);
        expect(tiers[0]!.y0).toBeCloseTo(b.baseY, 9);
        expect(tiers.at(-1)!.y1).toBeCloseTo(b.baseY + b.h, 9);
        tiers.forEach((t, i) => {
          expect(t.y1, `building ${b.id}`).toBeGreaterThan(t.y0);
          if (i === 0) return;
          const prev = tiers[i - 1]!;
          expect(t.y0).toBe(prev.y1);
          expect(t.w).toBeLessThanOrEqual(prev.w + EPS);
          expect(t.d).toBeLessThanOrEqual(prev.d + EPS);
        });
      }
    }
  });

  it('keep every part inside the footprint', () => {
    for (const b of B) {
      const foot = obb(b);
      for (const t of allTiers(b)) {
        const r = { x: t.x, z: t.z, hw: t.w / 2 - EPS, hd: t.d / 2 - EPS, rotY: b.rotY };
        // Every corner of the tier lies inside the footprint rectangle.
        for (const [sx, sz] of [
          [-1, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
        ] as const) {
          const c = Math.cos(b.rotY);
          const s = Math.sin(b.rotY);
          const lx = sx * r.hw;
          const lz = sz * r.hd;
          const px = r.x + c * lx + s * lz - foot.x;
          const pz = r.z - s * lx + c * lz - foot.z;
          const ux = c * px - s * pz;
          const uz = s * px + c * pz;
          expect(Math.abs(ux)).toBeLessThanOrEqual(foot.hw + 1e-6);
          expect(Math.abs(uz)).toBeLessThanOrEqual(foot.hd + 1e-6);
        }
      }
      if (b.cantilever) {
        const body = b.tiers.at(-1)!;
        const half =
          b.cantilever.side === 'px' || b.cantilever.side === 'nx' ? body.w / 2 : body.d / 2;
        const footHalf =
          b.cantilever.side === 'px' || b.cantilever.side === 'nx' ? b.w / 2 : b.d / 2;
        expect(half + b.cantilever.out).toBeLessThanOrEqual(footHalf);
      }
    }
  });

  it('gives megatowers silhouette archetypes and other districts their own', () => {
    for (const b of B) {
      if (b.h >= MEGA_MIN_H) {
        expect([
          'setbackTower',
          'cylinderTower',
          'bracedTower',
          'cantileverTower',
          'twinTower',
        ]).toContain(b.archetype);
      }
      if (b.district === 'hillside') expect(b.archetype).toBe('hillHouse');
      if (b.archetype === 'cylinderTower')
        expect(b.tiers.every((t) => t.shape === 'cylinder')).toBe(true);
      if (b.archetype === 'apartmentSlab') {
        expect(b.tags.dong).toBeGreaterThanOrEqual(101);
        expect(b.floors).toBeGreaterThanOrEqual(15);
        expect(b.floors).toBeLessThanOrEqual(25);
      }
    }
  });
});

describe('layout v2: districts', () => {
  it('assigns every building to the zone under its footprint center', () => {
    for (const b of B) {
      expect(zoneAt(b.x, b.z).id).toBe(b.zoneId);
      expect(districtAt(b.x, b.z)).toBe(b.district);
    }
  });

  it('classifies landmarks of the map', () => {
    expect(districtAt(SKYLINE_PEAK.x, SKYLINE_PEAK.z)).toBe('core');
    expect(districtAt(800, -400)).toBe('midtown');
    expect(districtAt(-800, -400)).toBe('sangga');
    expect(districtAt(0, -900)).toBe('hillside');
    expect(districtAt(0, riverZ(0))).toBe('riverside');
    expect(districtAt(0, 900)).toBe('apartment');
    expect(districtAt(900, 900)).toBe('industrial');
    expect(districtAt(-900, 900)).toBe('sangga');
  });

  it('keeps the riverside band 60 m outside both banks', () => {
    for (let x = -1150; x <= 1150; x += 50) {
      const z = riverZ(x);
      expect(districtAt(x, z - 170)).toBe('riverside');
      expect(districtAt(x, z + 170)).toBe('riverside');
      expect(districtAt(x, z - 200)).not.toBe('riverside');
      expect(districtAt(x, z + 200)).not.toBe('riverside');
    }
  });

  it('has unique zone ids and closed polygons', () => {
    expect(new Set(ZONES.map((z) => z.id)).size).toBe(ZONES.length);
    for (const z of ZONES) expect(z.polygon.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the block height ratio ≥ 3 in core, midtown and sangga blocks', () => {
    for (const bl of LAYOUT.blocks) {
      if (!['core', 'midtown', 'sangga'].includes(bl.district) || bl.buildingIds.length < 2) {
        continue;
      }
      const hs = bl.buildingIds.map((id) => B[id]!.h);
      expect(Math.max(...hs) / Math.min(...hs), `block ${bl.id}`).toBeGreaterThanOrEqual(3 - 1e-9);
    }
  });
});

describe('terrain and river', () => {
  it('terrainHeight is 0 south of z = -650 and at most 110 m', () => {
    for (let x = -1200; x <= 1200; x += 37) {
      for (let z = -640; z <= 1200; z += 53) expect(terrainHeight(x, z)).toBe(0);
      for (let z = -1200; z <= -650; z += 11) {
        const h = terrainHeight(x, z);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(110);
      }
    }
    expect(terrainHeight(0, -1200)).toBeGreaterThan(60);
  });

  it('terrainHeight is continuous', () => {
    const step = 0.05;
    for (let x = -1200; x <= 1200; x += 13) {
      for (let z = -1200; z <= -600; z += 7) {
        expect(Math.abs(terrainHeight(x + step, z) - terrainHeight(x, z))).toBeLessThan(0.5);
        expect(Math.abs(terrainHeight(x, z + step) - terrainHeight(x, z))).toBeLessThan(0.5);
      }
    }
  });

  it('surfaceHeight follows bank, park and water levels', () => {
    const x = 0;
    const z = riverZ(x);
    expect(surfaceHeight(x, z)).toBe(RIVER.waterY);
    expect(surfaceHeight(x, z + RIVER.width / 2 - 20)).toBe(RIVER.parkY);
    expect(surfaceHeight(x, z - RIVER.width / 2 - 20)).toBe(0);
    expect(riverSignedDistance(x, z)).toBeCloseTo(-RIVER.width / 2, 0);
  });

  it('bridges are perpendicular to the river and span bank to bank', () => {
    for (const br of LAYOUT.bridges) {
      const mx = (br.a.x + br.b.x) / 2;
      const span = Math.hypot(br.b.x - br.a.x, br.b.z - br.a.z);
      expect(span).toBeCloseTo(RIVER.width, 6);
      // The midpoint is on the centerline and both abutments are on the channel edge.
      expect(Math.abs((br.a.z + br.b.z) / 2 - riverZ(mx))).toBeLessThan(1);
      expect(Math.abs(riverSignedDistance(br.a.x, br.a.z))).toBeLessThan(1);
      expect(Math.abs(riverSignedDistance(br.b.x, br.b.z))).toBeLessThan(1);
      expect(deckHeightAt(LAYOUT, mx, (br.a.z + br.b.z) / 2)).toBeGreaterThanOrEqual(br.deckY);
    }
  });

  it('ridges are seamless and highest in the north', () => {
    for (const r of LAYOUT.ridges) {
      expect(ridgeHeight(r, -Math.PI)).toBeCloseTo(ridgeHeight(r, Math.PI), 9);
      let north = 0;
      let south = 0;
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const h = ridgeHeight(r, a);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(r.peakNorth);
        if (Math.sin(a) < -0.7) north = Math.max(north, h);
        if (Math.sin(a) > 0.7) south = Math.max(south, h);
      }
      expect(north).toBeGreaterThan(south);
    }
  });
});

describe('layout queries', () => {
  it('buildingsInAabb matches a brute-force scan', () => {
    const q = { minX: -300, minZ: -500, maxX: 100, maxZ: -200 };
    const brute = B.filter((b) =>
      obbOverlap(obb(b), {
        x: (q.minX + q.maxX) / 2,
        z: (q.minZ + q.maxZ) / 2,
        hw: (q.maxX - q.minX) / 2,
        hd: (q.maxZ - q.minZ) / 2,
        rotY: 0,
      }),
    ).map((b) => b.id);
    expect(buildingsInAabb(LAYOUT, q.minX, q.minZ, q.maxX, q.maxZ)).toEqual(brute);
    expect(brute.length).toBeGreaterThan(5);
  });

  it('raycastBuildings hits a building straight below and misses the open sky', () => {
    const tall = [...B].sort((a, b) => b.h - a.h)[0]!;
    const hit = raycastBuildings(
      LAYOUT,
      { x: tall.tiers[0]!.x, y: 1000, z: tall.tiers[0]!.z },
      { x: 0, y: -1, z: 0 },
    );
    expect(hit?.id).toBe(tall.id);
    expect(hit!.t).toBeCloseTo(1000 - buildingTop(tall), 6);
    expect(raycastBuildings(LAYOUT, { x: 0, y: 900, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull();
  });

  it('buildingContaining finds the tower around a point inside it', () => {
    const b = B.find((x) => x.archetype === 'sangga')!;
    expect(buildingContaining(LAYOUT, b.tiers[0]!.x, b.baseY + 1, b.tiers[0]!.z)).toBe(b.id);
    expect(buildingContaining(LAYOUT, b.x, b.baseY + b.h + 50, b.z)).toBeNull();
  });

  it('buildingFaces point outward and mark the street front', () => {
    for (const b of B.slice(0, 400)) {
      const faces = buildingFaces(b);
      expect(faces).toHaveLength(allTiers(b).length * 4);
      expect(faces.filter((f) => f.street && f.tier === 0 && f.stack === 0)).toHaveLength(1);
      for (const f of faces) {
        const t = (f.stack === 1 ? b.twin! : b.tiers)[f.tier]!;
        const out = Math.hypot(f.center.x + f.normal.x - t.x, f.center.z + f.normal.z - t.z);
        const at = Math.hypot(f.center.x - t.x, f.center.z - t.z);
        expect(out).toBeGreaterThan(at);
        expect(f.normal.x * f.tangent.x + f.normal.z * f.tangent.z).toBeCloseTo(0, 9);
        expect(f.width).toBeGreaterThan(0);
      }
    }
  });

  it('deckHeightAt reports highway decks and nothing on open ground', () => {
    const ring = LAYOUT.highways.find((h) => h.id === 'hw-ring')!;
    const p = ring.points[2]!;
    const y = deckHeightAt(LAYOUT, p.x, p.z);
    expect(y).not.toBeNull();
    expect(y!).toBeGreaterThanOrEqual(22 - 0.5);
    expect(y!).toBeLessThanOrEqual(28 + 0.5);
    expect(deckHeightAt(LAYOUT, 900, 900)).toBeNull();
  });

  it('places slots on free ground at the surface height', () => {
    for (const s of LAYOUT.slots) {
      expect(buildingContaining(LAYOUT, s.x, s.y + 0.5, s.z)).toBeNull();
      expect(s.y).toBeCloseTo(surfaceHeight(s.x, s.z), 9);
      if (s.kind === 'pojangmacha' && districtAt(s.x, s.z) === 'riverside') {
        expect(s.y).toBe(RIVER.parkY);
      }
    }
  });

  it('buildingContaining and raycastBuildings see cantilevers, skybridges and spires', () => {
    const withCant = B.find((b) => b.cantilever)!;
    const vol = buildingVolumes(withCant);
    expect(vol.length).toBeGreaterThan(allTiers(withCant).length);
    const c = withCant.cantilever!;
    const body = withCant.tiers.at(-1)!;
    const n = sideNormal(c.side, withCant.rotY);
    const half = c.side === 'px' || c.side === 'nx' ? body.w / 2 : body.d / 2;
    const px = body.x + n.x * (half + c.out / 2);
    const pz = body.z + n.z * (half + c.out / 2);
    expect(buildingContaining(LAYOUT, px, (c.y0 + c.y1) / 2, pz)).toBe(withCant.id);
    expect(buildingContaining(LAYOUT, px, c.y1 + 1, pz)).toBeNull();

    const twin = B.find((b) => b.skybridge)!;
    const a = twin.tiers[0]!;
    const t = twin.twin![0]!;
    const sy = (twin.skybridge!.y0 + twin.skybridge!.y1) / 2;
    expect(buildingContaining(LAYOUT, (a.x + t.x) / 2, sy, (a.z + t.z) / 2)).toBe(twin.id);

    const spired = B.find((b) => b.spireH > 5)!;
    const top = spired.tiers.at(-1)!;
    expect(buildingContaining(LAYOUT, top.x, top.y1 + spired.spireH / 2, top.z)).toBe(spired.id);
  });

  it('raycastBuildings returns t = 0 from inside boxes and cylinders alike', () => {
    for (const shape of ['box', 'cylinder', 'chamfer'] as const) {
      const b = B.find((x) => x.tiers[0]!.shape === shape && x.h > 30)!;
      const t0 = b.tiers[0]!;
      const hit = raycastBuildings(
        LAYOUT,
        { x: t0.x, y: t0.y0 + 2, z: t0.z },
        { x: 1, y: 0, z: 0 },
      );
      expect(hit, shape).toEqual({ id: b.id, t: 0 });
    }
  });

  it('gives piloti apartment slabs the same floor count as their height implies', () => {
    const slabs = B.filter((b) => b.archetype === 'apartmentSlab');
    const piloti = slabs.filter((b) => b.groundFloorH === 5);
    expect(piloti.length).toBeGreaterThan(0);
    for (const b of slabs) {
      expect(b.h).toBeCloseTo(b.groundFloorH + (b.floors - 1) * b.floorH, 9);
    }
  });

  it('turns riverside pavilions toward the river', () => {
    const pav = B.filter((b) => b.archetype === 'pavilion');
    expect(pav.length).toBeGreaterThan(0);
    for (const b of pav) {
      const c = riverFrame(b.x).p;
      const n = sideNormal(b.front, b.rotY);
      expect(n.x * (c.x - b.x) + n.z * (c.z - b.z), `pavilion ${b.id}`).toBeGreaterThan(0);
    }
  });

  it('fitScale keeps a rotated, offset footprint inside its lot', () => {
    for (const rot of [-0.07, 0, 0.05]) {
      const s = fitScale(18, 22, rot, 0.4, -0.3, 19, 23);
      const w = 18 * s;
      const d = 22 * s;
      // Corners of the rotated footprint, in the lot frame.
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        const l = toLocal((sx * w) / 2, (sz * d) / 2, -rot);
        expect(Math.abs(0.4 + l.x)).toBeLessThan(19 / 2);
        expect(Math.abs(-0.3 + l.z)).toBeLessThan(23 / 2);
      }
    }
  });

  it('deckHeightAt agrees with a brute-force scan of the highway samples', () => {
    for (const hw of LAYOUT.highways) {
      const s = highwaySamples(hw, 4);
      for (let i = 0; i < s.length - 1; i += 25) {
        const p = s[i]!;
        expect(deckHeightAt(LAYOUT, p.x, p.z), hw.id).toBeGreaterThanOrEqual(p.y - 1e-6);
      }
    }
  });
});

describe('noise', () => {
  it('rejects periods larger than the lattice instead of reading zeros', () => {
    expect(() => fbm1(1.5, 7, 4, 64)).toThrow(RangeError);
    expect(() => fbm1(1.5, 7, 4, 32)).not.toThrow();
  });
});

describe('layout v3 fields on the v2 map', () => {
  it('fills v3 fields with v2 defaults', () => {
    expect(LAYOUT.extentX).toBe(LAYOUT.extent);
    expect(LAYOUT.extentZ).toBe(LAYOUT.extent);
    expect(LAYOUT.islands).toEqual([]);
    expect(LAYOUT.mountains).toEqual([]);
    expect(LAYOUT.namedRoads).toEqual([]);
    expect(LAYOUT.landmarks).toEqual([]);
    const r = LAYOUT.river;
    expect(r.widths).toHaveLength(r.centerline.length);
    expect(r.parkWidths).toHaveLength(r.centerline.length);
    expect(r.widths.every((w) => w === r.width)).toBe(true);
    expect(r.parkWidths.every((w) => w === r.parkWidth)).toBe(true);
    expect(r.samples).toEqual(r.centerline);
    expect(LAYOUT.ridges.every((g) => g.peaks.length === 0)).toBe(true);
  });

  it('gives every bridge and zone its v3 descriptors', () => {
    for (const b of LAYOUT.bridges) {
      expect(b.name.length).toBeGreaterThan(0);
      expect(b.spans).toBeGreaterThanOrEqual(1);
      expect(b.rail).toBe(false);
    }
    for (const z of LAYOUT.districts) {
      expect(z.nameEn.length).toBeGreaterThan(0);
      expect(z.heights.min).toBeLessThanOrEqual(z.heights.max);
      expect(z.heights.max).toBeLessThanOrEqual(z.heights.tallMax);
      expect(z.litScale).toBe(1);
    }
  });
});
