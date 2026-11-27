import { describe, expect, it } from 'vitest';
import {
  CITY,
  LAYOUT,
  MEGA_MIN_H,
  RIVER,
  RIVER_CLEARANCE,
  SAETGANG,
  SKYLINE_PEAK,
  ZONES,
  ISLANDS,
  MOUNTAINS,
  MOUNTAIN_RANGES,
  TERRAIN,
  islandAt,
  parkWidthAt,
  riverOffset,
  riverWidthAt,
  waterSignedDistance,
  allTiers,
  buildingContaining,
  buildingTop,
  buildingVolumes,
  bridgeDeckY,
  bandEdgeZ,
  MAX_DECK_THICKNESS,
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
  type Vec2,
} from '../src/city/layout';
import {
  MAX_SLENDER,
  PALACE_PLAN,
  SKY_LANE_CLEAR,
  SKY_LANE_MARGIN,
  fitScale,
} from '../src/city/generate';
import { PALACE_HALLS } from '../src/city/archetypes';
import {
  PALACE_RECT,
  TALL_GROUND,
  TALL_H,
  isForest,
  riverDistanceLowerBound,
} from '../src/city/river';
import {
  hashString,
  obbCorners,
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

describe('layout v3: determinism', () => {
  it('is deterministic for the default seed', () => {
    const again = generateLayout(CITY.seed);
    expect(again).toEqual(LAYOUT);
    expect(digest(again)).toBe(digest(LAYOUT));
  }, 60_000);

  it('matches the pinned snapshot (update deliberately when the layout changes)', () => {
    expect({
      buildings: B.length,
      roads: LAYOUT.roads.length,
      blocks: LAYOUT.blocks.length,
      slots: LAYOUT.slots.length,
      digest: digest(LAYOUT),
    }).toMatchInlineSnapshot(`
      {
        "blocks": 1415,
        "buildings": 5640,
        "digest": "7c0f728c",
        "roads": 1181,
        "slots": 3474,
      }
    `);
  });

  it('changes with the seed', () => {
    expect(generateLayout(1).buildings).not.toEqual(LAYOUT.buildings);
  }, 60_000);

  it('uses ids equal to array indices', () => {
    B.forEach((b, i) => expect(b.id).toBe(i));
    LAYOUT.roads.forEach((r, i) => expect(r.id).toBe(i));
    LAYOUT.blocks.forEach((bl, i) => {
      expect(bl.id).toBe(i);
      for (const id of bl.buildingIds) expect(B[id]!.blockId).toBe(i);
    });
  });
});

describe('layout v3: counts (SEOUL.md 7.4)', () => {
  const count = (pred: (b: BuildingSpec) => boolean) => B.filter(pred).length;

  it('has 5000..7000 buildings, a few hundred hill houses and 14..28 megatowers', () => {
    expect(B.length).toBeGreaterThanOrEqual(5000);
    expect(B.length).toBeLessThanOrEqual(7000);
    const hill = count((b) => b.archetype === 'hillHouse');
    expect(hill).toBeGreaterThanOrEqual(100);
    expect(hill).toBeLessThanOrEqual(900);
    const mega = count((b) => b.h >= MEGA_MIN_H);
    expect(mega).toBeGreaterThanOrEqual(14);
    expect(mega).toBeLessThanOrEqual(28);
  });

  it('puts the 600 m 용산 apex at the skyline peak, then 잠실 500 m and 여의도 430 m', () => {
    const sorted = [...B].sort((a, b) => b.h - a.h);
    const top = sorted[0]!;
    expect(top.h).toBe(600);
    expect(top.zoneId).toBe('yongsan');
    expect(top.tags.landmark).toBe('yongsan-apex');
    expect(Math.hypot(top.x - SKYLINE_PEAK.x, top.z - SKYLINE_PEAK.z)).toBeLessThan(260);
    const mark = (id: string) => B.find((b) => b.tags.landmark === id)!;
    expect(mark('jamsil-blade').h).toBe(500);
    expect(mark('jamsil-blade').archetype).toBe('taperTower');
    expect(sorted[1]!.tags.landmark).toBe('jamsil-blade');
    expect(mark('yeouido-gold').h).toBe(430);
    expect(mark('yeouido-gold').zoneId).toBe('yeouido');
    for (const b of B.filter((x) => x.h >= MEGA_MIN_H)) expect(b.district).toBe('megacore');
    const ids = LAYOUT.landmarks.map((l) => l.id).sort();
    expect(ids).toEqual(['jamsil-blade', 'namsan-mast', 'palace', 'yeouido-gold', 'yongsan-apex']);
  });

  it('grows each megacore into a stepped tower cluster (manager review)', () => {
    const inZone = (id: string, lo: number, hi = Infinity) =>
      B.filter((b) => b.zoneId === id && b.h >= lo && b.h < hi).length;
    expect(inZone('yongsan', 280, 599)).toBeGreaterThanOrEqual(5);
    expect(inZone('yongsan', 120, 280)).toBeGreaterThanOrEqual(12);
    expect(inZone('yeouido', 300)).toBeGreaterThanOrEqual(5);
    expect(inZone('yeouido', 120, 300)).toBeGreaterThanOrEqual(15);
    expect(inZone('jamsil', 150, 499)).toBeGreaterThanOrEqual(8);
    const apex = B.find((b) => b.tags.landmark === 'yongsan-apex')!;
    expect(Math.min(apex.w, apex.d)).toBeGreaterThanOrEqual(70);
    const blade = B.find((b) => b.tags.landmark === 'jamsil-blade')!;
    expect(Math.min(blade.w, blade.d)).toBeGreaterThanOrEqual(58);
  });

  it('keeps every building at most 10 × as tall as it is wide (√(w·d))', () => {
    for (const b of B) {
      expect(b.h / Math.sqrt(b.w * b.d), `building ${b.id}`).toBeLessThanOrEqual(MAX_SLENDER);
    }
  });

  it('has the expected infrastructure', () => {
    expect(LAYOUT.bridges.map((b) => b.name)).toEqual([
      '성산대교',
      '양화대교',
      '서강대교',
      '마포대교',
      '한강철교',
      '한강대교',
      '반포대교·잠수교',
      '동호대교',
      '성수대교',
      '청담대교',
      '올림픽대교',
    ]);
    expect(LAYOUT.highways.map((h) => h.id)).toEqual([
      'hw-river-north',
      'hw-south',
      'hw-naebu-w',
      'hw-naebu-e',
      'hw-naebu-w-ramp',
      'hw-naebu-e-ramp',
    ]);
    expect(LAYOUT.ridges.map((r) => r.radius)).toEqual([3200, 4800, 7000]);
    expect(LAYOUT.extentX).toBe(4000);
    expect(LAYOUT.extentZ).toBe(2600);
    expect(LAYOUT.namedRoads.map((r) => r.name)).toContain('테헤란로');
    expect(LAYOUT.islands.map((i) => i.id)).toEqual([
      'yeouido',
      'bamseom',
      'nodeul',
      'seorae',
      'seonyu',
    ]);
  });

  it('places street slots within the target ranges', () => {
    const n = (k: string) => LAYOUT.slots.filter((s) => s.kind === k).length;
    const within = (k: string, lo: number, hi: number) => {
      expect(n(k), k).toBeGreaterThanOrEqual(lo);
      expect(n(k), k).toBeLessThanOrEqual(hi);
    };
    within('streetLight', 1300, 2000);
    within('tree', 650, 1600);
    within('signPole', 750, 1200);
    within('pojangmacha', 60, 130);
    within('busStop', 70, 120);
    within('stairLamp', 1, 60);
  });
});

describe('layout v3: no overlaps', () => {
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
  }, 60_000);

  it('buildings keep clear of the river channel and 샛강', () => {
    for (const b of B) {
      const o = obb(b);
      // Far from any water the cheap bound already proves it.
      if (riverDistanceLowerBound(b.x, b.z) - 240 - Math.hypot(o.hw, o.hd) > RIVER_CLEARANCE) {
        if (waterSignedDistance(b.x, b.z) > 200) continue;
      }
      // Walk the footprint outline every 2 m: the bank is curved, so corners alone are not enough.
      const c = Math.cos(o.rotY);
      const sn = Math.sin(o.rotY);
      const at = (lx: number, lz: number) => ({
        x: o.x + c * lx + sn * lz,
        z: o.z - sn * lx + c * lz,
      });
      const pts: { x: number; z: number }[] = [];
      for (const [ax, az, bx, bz] of [
        [-o.hw, -o.hd, o.hw, -o.hd],
        [o.hw, -o.hd, o.hw, o.hd],
        [o.hw, o.hd, -o.hw, o.hd],
        [-o.hw, o.hd, -o.hw, -o.hd],
      ] as const) {
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
        for (let k = 0; k < n; k++)
          pts.push(at(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n));
      }
      for (const p of pts) {
        // 2 m sampling can miss up to ~0.01 m of a gentle curve between samples.
        expect(waterSignedDistance(p.x, p.z), `building ${b.id}`).toBeGreaterThanOrEqual(
          RIVER_CLEARANCE - 0.05,
        );
      }
    }
  }, 60_000);

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
        expect(waterSignedDistance(p.x, p.z)).toBeGreaterThan(0);
      }
    }
  });
});

describe('layout v3: tiers', () => {
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
          'taperTower',
        ]).toContain(b.archetype);
      }
      if (b.district === 'hillside') expect(b.archetype).toBe('hillHouse');
      if (b.district === 'palace') expect(b.archetype).toBe('palaceHall');
      if (b.district === 'palace') expect(b.h).toBeLessThanOrEqual(18);
      // Media slabs run along 테헤란로 (local x), so the screen is a long side.
      if (b.archetype === 'mediaSlab') expect(['pz', 'nz']).toContain(b.tags.mediaFace);
      if (b.archetype === 'cylinderTower')
        expect(b.tiers.every((t) => t.shape === 'cylinder')).toBe(true);
      if (b.archetype === 'apartmentSlab') {
        expect(b.tags.dong).toBeGreaterThanOrEqual(101);
        const z = ZONES.find((x) => x.id === b.zoneId)!;
        expect(b.floors).toBeGreaterThanOrEqual(Math.round(z.heights.min / 2.8) - 1);
        // A piloti ground floor (5 m) can add 2.2 m over the zone's height band.
        expect(b.h).toBeLessThanOrEqual(z.heights.tallMax + 2.2 + 1e-6);
      }
    }
  });
});

describe('layout v3: districts', () => {
  it('assigns every building to the zone under its footprint center', () => {
    for (const b of B) {
      expect(zoneAt(b.x, b.z).id).toBe(b.zoneId);
      expect(districtAt(b.x, b.z)).toBe(b.district);
    }
  });

  it('puts the Seoul districts where SEOUL.md 4.2 says', () => {
    const at = (x: number, z: number) => zoneAt(x, z).id;
    expect(at(SKYLINE_PEAK.x, SKYLINE_PEAK.z)).toBe('yongsan');
    expect(at(100, -800)).toBe('jongno');
    expect(at(-190, -800)).toBe('palace');
    expect(at(-176, -389)).toBe('namsan');
    expect(at(980, -420)).toBe('seongsu');
    expect(at(-1000, -620)).toBe('hongdae');
    expect(at(816, 490)).toBe('gangnam');
    expect(at(1650, 330)).toBe('jamsil');
    expect(at(-1100, 700)).toBe('yeongdeungpo');
    const yeouido = ISLANDS.find((i) => i.id === 'yeouido')!;
    const c = yeouido.polygon.reduce((a, p) => ({ x: a.x + p.x, z: a.z + p.z }), { x: 0, z: 0 });
    expect(at(c.x / yeouido.polygon.length, c.z / yeouido.polygon.length)).toBe('yeouido');
    expect(districtAt(0, riverZ(0))).toBe('riverside');
    for (const z of ZONES) expect(z.nameEn).toMatch(/^[A-Z][A-Z -]*$/);
  });

  it('makes the riverside band exactly the channel plus 60 m', () => {
    for (let x = -1950; x <= 1950; x += 37) {
      for (let z = -1290; z <= 1290; z += 41) {
        const inBand = riverSignedDistance(x, z) <= RIVER.bandWidth;
        expect(districtAt(x, z) === 'riverside', `${x},${z}`).toBe(inBand);
      }
    }
  });

  it('has unique zone ids and closed polygons', () => {
    expect(new Set(ZONES.map((z) => z.id)).size).toBe(ZONES.length);
    for (const z of ZONES) expect(z.polygon.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the block height ratio ≥ 3 in core, midtown and sangga blocks', () => {
    for (const bl of LAYOUT.blocks) {
      const RATIO = ['core', 'megacore', 'corridor', 'midtown', 'sangga', 'nightlife'];
      if (!RATIO.includes(bl.district) || bl.buildingIds.length < 2) continue;
      // Blocks of megatowers only have no low building to compare against.
      if (bl.buildingIds.every((id) => B[id]!.tags.corp)) continue;
      const hs = bl.buildingIds.map((id) => B[id]!.h);
      expect(Math.max(...hs) / Math.min(...hs), `block ${bl.id}`).toBeGreaterThanOrEqual(3 - 1e-9);
    }
  });
});

describe('terrain and river', () => {
  it('raises the named mountains and keeps the plain flat', () => {
    for (const m of MOUNTAINS) {
      const h = terrainHeight(m.peak.x, m.peak.z);
      expect(h, m.id).toBeGreaterThan(m.height * (1 - TERRAIN.detail) - 1e-6);
      expect(h, m.id).toBeLessThanOrEqual(m.height * (1 + TERRAIN.detail) + 1e-6);
    }
    const far = (x: number, z: number) =>
      MOUNTAINS.every((m) => Math.hypot(x - m.peak.x, z - m.peak.z) >= m.radius);
    for (let x = -2000; x <= 2000; x += 61) {
      for (let z = -1300; z <= 1300; z += 67) {
        const h = terrainHeight(x, z);
        expect(h).toBeGreaterThanOrEqual(0);
        if (far(x, z)) expect(h).toBe(0);
      }
    }
  });

  it('terrainHeight is continuous', () => {
    const step = 0.05;
    for (const m of MOUNTAINS) {
      for (let x = m.peak.x - m.radius; x <= m.peak.x + m.radius; x += 13) {
        for (let z = m.peak.z - m.radius; z <= m.peak.z + m.radius; z += 13) {
          expect(Math.abs(terrainHeight(x + step, z) - terrainHeight(x, z))).toBeLessThan(0.5);
          expect(Math.abs(terrainHeight(x, z + step) - terrainHeight(x, z))).toBeLessThan(0.5);
        }
      }
    }
  });

  it('follows the bridge control points with a centerline strictly increasing in x', () => {
    const s = LAYOUT.river.samples;
    for (let i = 1; i < s.length; i++) expect(s[i]!.x).toBeGreaterThan(s[i - 1]!.x);
    for (const br of LAYOUT.bridges) {
      // The deck crosses the centerline (abutments need not be symmetric on a bend).
      const gap = Math.min(...s.map((p) => pointSegmentDistance(p, br.a, br.b)));
      expect(gap, br.id).toBeLessThan(5);
    }
    // Widths follow SEOUL.md 3.1: wide downstream, narrowest at 잠실.
    expect(riverWidthAt(-1900)).toBeCloseTo(480, 0);
    expect(riverWidthAt(1501)).toBe(360);
  });

  it('surfaceHeight follows bank, park, water, 샛강 and islands', () => {
    const x = 600;
    const z = riverZ(x);
    const half = riverWidthAt(x) / 2;
    expect(surfaceHeight(x, z)).toBe(RIVER.waterY);
    const park = riverOffset(x, half - parkWidthAt(x) / 2);
    expect(surfaceHeight(park.x, park.z)).toBe(RIVER.parkY);
    const land = riverOffset(x, -half - 20);
    expect(surfaceHeight(land.x, land.z)).toBe(0);
    expect(riverSignedDistance(x, z)).toBeCloseTo(-half, 0);
    const sg = SAETGANG.centerline[Math.floor(SAETGANG.centerline.length / 2)]!;
    expect(surfaceHeight(sg.x, sg.z)).toBe(RIVER.waterY);
    for (const id of ['bamseom', 'nodeul'] as const) {
      const isl = ISLANDS.find((i) => i.id === id)!;
      const c = isl.polygon.reduce((a, p) => ({ x: a.x + p.x, z: a.z + p.z }), { x: 0, z: 0 });
      const p = { x: c.x / isl.polygon.length, z: c.z / isl.polygon.length };
      expect(islandAt(p.x, p.z)?.id).toBe(id);
      expect(surfaceHeight(p.x, p.z)).toBe(isl.y);
      expect(riverSignedDistance(p.x, p.z)).toBeLessThan(0);
    }
  });

  it('bridges span bank to bank and keep the approach asymmetry', () => {
    for (const br of LAYOUT.bridges) {
      const mx = (br.a.x + br.b.x) / 2;
      const span = Math.hypot(br.b.x - br.a.x, br.b.z - br.a.z);
      expect(span, br.id).toBeGreaterThan(riverWidthAt(mx) * 0.9);
      // Abutments sit exactly where the axis meets the embankment.
      expect(Math.abs(riverSignedDistance(br.a.x, br.a.z)), br.id).toBeLessThan(0.5);
      expect(Math.abs(riverSignedDistance(br.b.x, br.b.z)), br.id).toBeLessThan(0.5);
      const rampA = Math.hypot(br.a.x - br.landA.x, br.a.z - br.landA.z);
      const rampB = Math.hypot(br.b.x - br.landB.x, br.b.z - br.landB.z);
      expect(rampB).toBeGreaterThan(rampA);
      expect(deckHeightAt(LAYOUT, mx, (br.a.z + br.b.z) / 2)).toBeGreaterThanOrEqual(br.deckY);
      if (br.kind === 'truss') expect(br.spans).toBeGreaterThanOrEqual(3);
      else expect(br.spans).toBeGreaterThanOrEqual(2);
    }
  });

  it('ridges are seamless, highest in the north and carry the named peaks', () => {
    for (const r of LAYOUT.ridges) {
      expect(ridgeHeight(r, -Math.PI)).toBeCloseTo(ridgeHeight(r, Math.PI), 9);
      const top = Math.max(r.peakNorth, ...r.peaks.map((p) => p.height));
      let north = 0;
      let south = 0;
      for (let i = 0; i < 256; i++) {
        const a = (i / 256) * Math.PI * 2;
        const h = ridgeHeight(r, a);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(top);
        if (Math.sin(a) < -0.7) north = Math.max(north, h);
        if (Math.sin(a) > 0.7) south = Math.max(south, h);
      }
      expect(north).toBeGreaterThan(south);
      for (const p of r.peaks) expect(ridgeHeight(r, p.angle)).toBeGreaterThan(p.height * 0.84);
    }
  });
});

describe('layout queries', () => {
  it('buildingsInAabb matches a brute-force scan', () => {
    const q = { minX: -300, minZ: -800, maxX: 100, maxZ: -500 };
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
    const naebu = LAYOUT.highways.find((h) => h.id === 'hw-naebu-e')!;
    const p = naebu.points[2]!;
    const y = deckHeightAt(LAYOUT, p.x, p.z);
    expect(y).not.toBeNull();
    expect(y!).toBeCloseTo(26, 0);
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

describe('layout v3: water and islands', () => {
  it('keeps roads and street slots out of open water (샛강 included)', () => {
    for (const r of LAYOUT.roads) {
      const n = Math.ceil(Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z) / 4);
      for (let k = 0; k <= n; k++) {
        const x = r.a.x + ((r.b.x - r.a.x) * k) / n;
        const z = r.a.z + ((r.b.z - r.a.z) * k) / n;
        expect(surfaceHeight(x, z), `road ${r.id}`).toBeGreaterThan(RIVER.waterY + 0.5);
      }
    }
    for (const s of LAYOUT.slots) expect(s.y, s.kind).toBeGreaterThan(RIVER.waterY + 0.5);
    // At-grade highways too (elevated decks may cross water).
    for (const hw of LAYOUT.highways.filter((h) => h.kind === 'atGrade')) {
      for (const p of highwaySamples(hw, 4)) {
        if (Math.abs(p.x) > CITY.halfX || Math.abs(p.z) > CITY.halfZ) continue;
        expect(surfaceHeight(p.x, p.z), `${hw.id} at ${Math.round(p.x)}`).toBeGreaterThan(-1);
      }
    }
  }, 60_000);

  it('keeps island outlines and the 샛강 centerline free of self-intersections', () => {
    const crosses = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean => {
      const o = (p: Vec2, q: Vec2, r: Vec2) =>
        (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
      return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
    };
    const selfCrossings = (pts: readonly Vec2[], closed: boolean): number => {
      const n = pts.length;
      const segs = closed ? n : n - 1;
      let hits = 0;
      for (let i = 0; i < segs; i++) {
        for (let j = i + 2; j < segs; j++) {
          if (closed && i === 0 && j === n - 1) continue;
          if (crosses(pts[i]!, pts[(i + 1) % n]!, pts[j]!, pts[(j + 1) % n]!)) hits++;
        }
      }
      return hits;
    };
    for (const isl of ISLANDS) expect(selfCrossings(isl.polygon, true), isl.id).toBe(0);
    expect(selfCrossings(SAETGANG.centerline, false)).toBe(0);
    const c = SAETGANG.centerline;
    for (let i = 1; i < c.length; i++) expect(c[i]!.x).toBeGreaterThan(c[i - 1]!.x);
  });

  it('tags every bridge whose span crosses an island', () => {
    for (const br of LAYOUT.bridges) {
      const crossed = new Set<string>();
      for (let t = 0; t <= 1; t += 0.01) {
        const isl = islandAt(br.a.x + (br.b.x - br.a.x) * t, br.a.z + (br.b.z - br.a.z) * t);
        if (isl && isl.kind !== 'land') crossed.add(isl.id);
      }
      for (const id of crossed) expect(br.island, br.id).toBe(id);
    }
  });

  it('puts bandEdgeZ exactly on the riverside band edge', () => {
    for (let x = -1950; x <= 1950; x += 23) {
      for (const side of [-1, 1] as const) {
        const z = bandEdgeZ(x, side);
        if (Math.abs(z) > CITY.halfZ) continue;
        expect(Math.abs(riverSignedDistance(x, z) - RIVER.bandWidth), `${x}`).toBeLessThan(0.05);
      }
    }
  });

  it('keeps apartment rows at least 0.8 × their height apart', () => {
    for (const b of B.filter((x) => x.archetype === 'apartmentSlab')) {
      for (const id of buildingsInAabb(LAYOUT, b.x - 150, b.z - 150, b.x + 150, b.z + 150)) {
        const o = B[id]!;
        if (o.id <= b.id || o.archetype !== 'apartmentSlab' || o.blockId !== b.blockId) continue;
        const gap = Math.hypot(o.x - b.x, o.z - b.z) - (b.d + o.d) / 2;
        // Slabs of one block side by side (same row) are not facing each other.
        const local = toLocal(o.x - b.x, o.z - b.z, b.rotY);
        if (Math.abs(local.z) < b.d) continue;
        expect(gap, `${b.id} vs ${o.id}`).toBeGreaterThanOrEqual(0.8 * Math.max(b.h, o.h) - 1e-6);
      }
    }
  });
});

describe('layout v3: building names', () => {
  it('names buildings after their quarter', () => {
    const named = (zone: string) => B.filter((b) => b.zoneId === zone).map((b) => b.tags.name);
    expect(B.filter((b) => b.archetype === 'palaceHall').map((b) => b.tags.name)).toEqual([
      '한빛문',
      '정운전',
      '사현전',
      '평안전',
    ]);
    for (const b of B) expect(b.tags.name, b.archetype).not.toMatch(/[\u4e00-\u9fff]/u);
    expect(named('hongdae').some((n) => /전자상가|시장/u.test(n))).toBe(false);
    expect(named('seongsu').some((n) => n.includes('벽돌창고'))).toBe(false);
    expect(named('jongno').some((n) => n.includes('트레이드센터'))).toBe(false);
    expect(PALACE_PLAN.length).toBe(PALACE_HALLS.length);
    // Complexes group up to 4 neighbouring slabs of one row, numbered per strip.
    const banpo = B.filter((b) => b.zoneId === 'apt-banpo' && b.archetype === 'apartmentSlab');
    expect(banpo[0]?.tags.name).toBe('반포 1단지 101동');
    const byComplex = new Map<string, typeof B>();
    for (const b of B.filter((x) => x.archetype === 'apartmentSlab')) {
      const k = b.tags.complex as string;
      byComplex.set(k, [...(byComplex.get(k) ?? []), b]);
    }
    for (const [k, slabs] of byComplex) {
      expect(slabs.length, k).toBeLessThanOrEqual(4);
      // Same row: rows sit at bank distances 72 m apart, slabs of one row share theirs.
      const off = slabs.map((b) => riverSignedDistance(b.x, b.z));
      expect(Math.max(...off) - Math.min(...off), k).toBeLessThan(36);
    }
    for (const b of B.filter((x) => x.archetype === 'hillHouse')) {
      expect(b.tags.name).toMatch(/^[^·]+ \d+번지$/u);
    }
  });
});

describe('layout v3: mountain slopes', () => {
  // Manager criteria (terrain at 0.375 × real elevation): no face over 100 % (45°), mid slopes
  // under 60 % on average, and a gentle foot (< 15 %) where the city meets the mountain. Cells
  // belong to the nearest peak; the palace terrace (a cut, not a natural slope) is left out of
  // the foot check.
  it('keeps every mountain under 100 % slope, mid slopes under 60 %, feet under 15 %', () => {
    const owner = (x: number, z: number) =>
      MOUNTAINS.reduce((a, m) =>
        Math.hypot(x - m.peak.x, z - m.peak.z) < Math.hypot(x - a.peak.x, z - a.peak.z) ? m : a,
      );
    const terrace = (x: number, z: number) =>
      x > PALACE_RECT.x0 - 120 &&
      x < PALACE_RECT.x1 + 120 &&
      z > PALACE_RECT.z0 - 120 &&
      z < PALACE_RECT.z1 + 120;
    for (const m of MOUNTAINS) {
      let max = 0;
      let midSum = 0;
      let midN = 0;
      let foot = 0;
      for (let x = m.peak.x - m.radius; x <= m.peak.x + m.radius; x += 8) {
        for (let z = m.peak.z - m.radius; z <= m.peak.z + m.radius; z += 8) {
          if (owner(x, z) !== m) continue;
          const h = terrainHeight(x, z);
          if (h <= 0.05) continue;
          const s = Math.hypot(terrainHeight(x + 4, z) - h, terrainHeight(x, z + 4) - h) / 4;
          max = Math.max(max, s);
          const b = h / m.height;
          if (b >= 0.2 && b <= 0.8) {
            midSum += s;
            midN++;
          }
          if (b <= 0.04 && !terrace(x, z)) foot = Math.max(foot, s);
        }
      }
      expect(max, `${m.id} max`).toBeLessThanOrEqual(1);
      expect(midSum / midN, `${m.id} mid`).toBeLessThanOrEqual(0.6);
      expect(foot, `${m.id} foot`).toBeLessThanOrEqual(0.15);
    }
  }, 120_000);
});

describe('layout v3: mountain feet and the river', () => {
  // terrain splits ground cells where the ground rises over 2 m and drops cells within 40 m of the
  // water (bankReach); raised ground stays two coarse cells (2 × 24 m) beyond that, so the split
  // cells never meet the dropped waterside cells.
  it('keeps raised ground (> 2 m) at least 88 m from the water', () => {
    for (const r of MOUNTAIN_RANGES) {
      for (let x = r.x0; x <= r.x1; x += 8) {
        for (let z = r.z0; z <= r.z1; z += 8) {
          if (terrainHeight(x, z) <= 2) continue;
          expect(waterSignedDistance(x, z), `${r.ids.join('+')} ${x},${z}`).toBeGreaterThanOrEqual(
            88,
          );
        }
      }
    }
  });
});

describe('layout v3: mountains stay wooded', () => {
  it('seats every building at its lowest footprint corner (slopes get a retaining base)', () => {
    for (const b of B) {
      const corners = obbCorners(obb(b)).map((p) => terrainHeight(p.x, p.z));
      expect(b.baseY, b.id.toString()).toBeLessThanOrEqual(Math.min(...corners) + 1e-6);
    }
  });

  it("keeps 남산's summit pad clear for the mast", () => {
    const n = MOUNTAINS.find((m) => m.id === 'namsan')!;
    expect(isForest(n.peak.x, n.peak.z)).toBe(true);
    for (const b of B) expect(Math.hypot(b.x - n.peak.x, b.z - n.peak.z)).toBeGreaterThan(35);
  });

  it('builds nothing on slopes over 25 % or above the forest line', () => {
    for (const b of B) {
      const o = obb(b);
      const c = Math.cos(o.rotY);
      const sn = Math.sin(o.rotY);
      for (const [lx, lz] of [
        [0, 0],
        [-o.hw, -o.hd],
        [o.hw, -o.hd],
        [o.hw, o.hd],
        [-o.hw, o.hd],
      ] as const) {
        const x = o.x + c * lx + sn * lz;
        const z = o.z - sn * lx + c * lz;
        expect(isForest(x, z), `building ${b.id}`).toBe(false);
      }
    }
  });

  it('puts buildings over 40 m only on ground at most 20 m high', () => {
    for (const b of B.filter((x) => x.h > TALL_H)) {
      expect(terrainHeight(b.x, b.z), `building ${b.id}`).toBeLessThanOrEqual(TALL_GROUND);
    }
    for (const b of B.filter((x) => x.district === 'hillside')) {
      expect(b.floors, `building ${b.id}`).toBeLessThanOrEqual(5);
    }
  });

  it('lines the palace halls up on one axis inside a level court', () => {
    const halls = B.filter((b) => b.district === 'palace');
    expect(halls.length).toBeGreaterThanOrEqual(3);
    const cx = (PALACE_RECT.x0 + PALACE_RECT.x1) / 2;
    for (const b of halls) {
      expect(Math.abs(b.x - cx)).toBeLessThan(1);
      expect(b.archetype).toBe('palaceHall');
      expect(b.baseY).toBe(0);
    }
    const r: { x0: number; x1: number; z0: number; z1: number } = PALACE_RECT;
    for (let x = r.x0; x <= r.x1; x += 13) {
      for (let z = r.z0; z <= r.z1; z += 11) expect(terrainHeight(x, z)).toBe(0);
    }
    expect(LAYOUT.roads.filter((r) => r.zoneId === 'palace')).toHaveLength(0);
  });
});

describe('layout v3: sky lanes', () => {
  it('routes flying traffic around the clusters and over the river, clear of every tower', () => {
    const lanes = LAYOUT.skyLanes;
    expect(lanes.map((l) => l.id)).toEqual([
      'sky-yongsan-ring',
      'sky-yeouido-ring',
      'sky-gangnam-loop',
      'sky-river',
    ]);
    for (const lane of lanes) {
      expect(lane.points.length, lane.id).toBeGreaterThanOrEqual(8);
      expect(lane.altitude[1]).toBeGreaterThan(lane.altitude[0]);
      const S = lane.samples ?? [];
      expect(S.length, lane.id).toBeGreaterThan(lane.points.length);
      if (lane.closed)
        expect(Math.hypot(S[0]!.x - S.at(-1)!.x, S[0]!.z - S.at(-1)!.z)).toBeLessThan(1e-6);
      for (let i = 0; i < S.length - 1; i++) {
        expect(Math.hypot(S[i + 1]!.x - S[i]!.x, S[i + 1]!.z - S[i]!.z)).toBeLessThan(12);
      }
      for (const b of B) {
        let d = Infinity;
        for (let i = 0; i < S.length - 1; i++)
          d = Math.min(d, pointSegmentDistance(b, S[i]!, S[i + 1]!));
        if (d > SKY_LANE_CLEAR + Math.hypot(b.w, b.d) / 2) continue;
        expect(buildingTop(b) + SKY_LANE_MARGIN, `${lane.id} over ${b.id}`).toBeLessThanOrEqual(
          lane.altitude[0] + 1e-6,
        );
      }
    }
  });
});

describe('layout v3: map grid', () => {
  it('keeps the buildings chunk grid at 80 chunks or fewer (draw-call budget)', () => {
    const nx = Math.ceil(CITY.extentX / CITY.chunkSize);
    const nz = Math.ceil(CITY.extentZ / CITY.chunkSize);
    expect(CITY.chunkSize).toBe(400);
    expect(nx * nz).toBeLessThanOrEqual(80);
    expect(LAYOUT.extentX).toBe(2 * CITY.halfX);
    expect(LAYOUT.extentZ).toBe(2 * CITY.halfZ);
  });
});

describe('layout v3: highway curves', () => {
  it('never bend tighter than 3 × the deck width (decks would fold)', () => {
    for (const hw of LAYOUT.highways) {
      const s = highwaySamples(hw, 4);
      let min = Infinity;
      for (let i = 1; i < s.length - 1; i++) {
        const a = s[i - 1]!;
        const b = s[i]!;
        const c = s[i + 1]!;
        const ab = Math.hypot(b.x - a.x, b.z - a.z);
        const bc = Math.hypot(c.x - b.x, c.z - b.z);
        const ac = Math.hypot(c.x - a.x, c.z - a.z);
        const cross = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
        if (cross < 1e-9) continue;
        min = Math.min(min, (ab * bc * ac) / (2 * cross));
      }
      expect(min, hw.id).toBeGreaterThan(3 * hw.width);
    }
  });

  it('gives the 내부순환로 ramps room to leave their parent deck', () => {
    for (const hw of LAYOUT.highways.filter((h) => h.kind === 'ramp')) {
      const s = highwaySamples(hw, 4);
      let len = 0;
      for (let i = 1; i < s.length; i++)
        len += Math.hypot(s[i]!.x - s[i - 1]!.x, s[i]!.z - s[i - 1]!.z);
      expect(len, hw.id).toBeGreaterThan(200);
    }
  });

  it('keeps elevated decks above the ground (slab underside ≥ 5 m over the terrain)', () => {
    for (const hw of LAYOUT.highways.filter((h) => h.kind !== 'atGrade')) {
      for (const p of highwaySamples(hw, 6)) {
        if (Math.abs(p.x) > CITY.halfX || Math.abs(p.z) > CITY.halfZ) continue;
        const under = p.y - MAX_DECK_THICKNESS - terrainHeight(p.x, p.z);
        // Ramp ends sit on their parent deck, which this test covers anyway.
        if (hw.kind === 'ramp' && p.y < 1) continue;
        expect(under, `${hw.id} at ${Math.round(p.x)},${Math.round(p.z)}`).toBeGreaterThanOrEqual(
          5,
        );
      }
    }
  });

  it('lets ramps leave their parent decks instead of running inside another deck', () => {
    const others = LAYOUT.highways.map((h) => ({ h, s: highwaySamples(h, 6) }));
    for (const ramp of LAYOUT.highways.filter((h) => h.kind === 'ramp')) {
      const s = highwaySamples(ramp, 6);
      let len = 0;
      const total = s.reduce(
        (acc, p, i) => (i ? acc + Math.hypot(p.x - s[i - 1]!.x, p.z - s[i - 1]!.z) : 0),
        0,
      );
      let buried = 0;
      for (let i = 0; i < s.length; i++) {
        const p = s[i]!;
        if (i) len += Math.hypot(p.x - s[i - 1]!.x, p.z - s[i - 1]!.z);
        // The first and last 60 m merge with the parent deck by design.
        if (len < 60 || total - len < 60) continue;
        const inside = others.some(
          ({ h, s: o }) =>
            h !== ramp &&
            o.some(
              (q) =>
                Math.hypot(q.x - p.x, q.z - p.z) < (h.width + ramp.width) / 2 &&
                Math.abs(q.y - p.y) < 4,
            ),
        );
        if (inside) buried++;
      }
      expect(buried, ramp.id).toBe(0);
    }
  });

  it('ends every ramp on its parent decks', () => {
    const decks = LAYOUT.highways.filter((h) => h.kind !== 'ramp');
    for (const ramp of LAYOUT.highways.filter((h) => h.kind === 'ramp')) {
      const s = highwaySamples(ramp, 4);
      for (const end of [s[0]!, s[s.length - 1]!]) {
        const gap = Math.min(
          ...decks.flatMap((h) =>
            highwaySamples(h, 4).map((q) => Math.hypot(q.x - end.x, q.z - end.z)),
          ),
        );
        expect(gap, ramp.id).toBeLessThan(3);
      }
    }
  });

  it('runs the named roads around parks and over gentle ground', () => {
    for (const nr of LAYOUT.namedRoads) {
      for (let i = 0; i < nr.points.length - 1; i++) {
        const a = nr.points[i]!;
        const b = nr.points[i + 1]!;
        const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 10);
        for (let k = 0; k <= n; k++) {
          const x = a.x + ((b.x - a.x) * k) / n;
          const z = a.z + ((b.z - a.z) * k) / n;
          expect(districtAt(x, z), nr.name).not.toBe('park');
          expect(terrainHeight(x, z), nr.name).toBeLessThan(15);
        }
      }
    }
  });

  it('keeps the deck at a bridge landing despite rounding', () => {
    for (const br of LAYOUT.bridges) {
      for (const l of [br.landA, br.landB]) expect(bridgeDeckY(br, l.x, l.z), br.id).not.toBeNull();
    }
  });
});

describe('layout v3: descriptors', () => {
  it('names every bridge, zone and highway', () => {
    for (const b of LAYOUT.bridges) {
      expect(b.name).toMatch(/대교|철교/);
      expect(b.id).toMatch(/^br-/);
    }
    expect(LAYOUT.bridges.filter((b) => b.rail).map((b) => b.id)).toEqual([
      'br-hangang-rail',
      'br-dongho',
      'br-cheongdam',
    ]);
    for (const h of LAYOUT.highways) expect(h.name.length).toBeGreaterThan(0);
    for (const z of LAYOUT.districts) {
      expect(z.heights.min).toBeLessThanOrEqual(z.heights.max);
      expect(z.heights.max).toBeLessThanOrEqual(z.heights.tallMax);
    }
  });
});

describe('axis accessors (layout v3 migration)', () => {
  it('exposes per-axis half extents and per-x river widths', () => {
    expect(CITY.halfX).toBe(LAYOUT.extentX / 2);
    expect(CITY.halfZ).toBe(LAYOUT.extentZ / 2);
    RIVER.centerline.forEach((p, i) => {
      expect(riverWidthAt(p.x)).toBeCloseTo(RIVER.widths[i]!, 9);
      expect(parkWidthAt(p.x)).toBeCloseTo(RIVER.parkWidths[i]!, 9);
    });
    // Between two points the width is their linear blend.
    const a = RIVER.centerline[3]!;
    const b = RIVER.centerline[4]!;
    const mid = riverWidthAt((a.x + b.x) / 2);
    expect(mid).toBeCloseTo((RIVER.widths[3]! + RIVER.widths[4]!) / 2, 9);
  });
});
