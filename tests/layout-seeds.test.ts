// Invariants that must hold for every seed, not just the default one.
import { describe, expect, it } from 'vitest';
import {
  MEGA_MIN_H,
  RIVER_CLEARANCE,
  SAETGANG,
  ZONES,
  TEHERAN,
  buildingFaces,
  buildingsInAabb,
  riverWidthAt,
  generateLayout,
  highwaySamples,
  type Block,
  type BuildingSpec,
  type Layout,
} from '../src/city/layout';
import { NEIGHBOUR_GAP, tooSimilar } from '../src/city/generate';
import { obbOverlap, obbSegmentDistance } from '../src/city/math';
import { createRng } from '../src/core/random';

const rng = createRng(31337);
const SEEDS = [1, 42, 2077, 9999, ...Array.from({ length: 3 }, () => rng.int(1, 2 ** 31 - 1))];
const layouts = new Map<number, Layout>(SEEDS.map((s) => [s, generateLayout(s)]));

const obb = (b: BuildingSpec) => ({ x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, rotY: b.rotY });
const blockObb = (b: Block) => ({ x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, rotY: b.rotY });

describe.each(SEEDS)('seed %i', (seed) => {
  const L = layouts.get(seed)!;
  const B = L.buildings;

  it('has no overlapping buildings', () => {
    for (const b of B) {
      for (const id of buildingsInAabb(L, b.x - 60, b.z - 60, b.x + 60, b.z + 60)) {
        if (id <= b.id) continue;
        expect(obbOverlap(obb(b), obb(B[id]!)), `${b.id} vs ${id}`).toBe(false);
      }
    }
  });

  it('keeps block rectangles out of the river and the highway corridors', () => {
    const c = L.river.samples;
    const sg = SAETGANG.centerline;
    const segs = L.highways.map((hw) => ({ hw, s: highwaySamples(hw, 8) }));
    for (const bl of L.blocks) {
      const o = blockObb(bl);
      for (let i = 0; i < c.length - 1; i++) {
        const a = c[i]!;
        const e = c[i + 1]!;
        if (Math.abs(a.x - bl.x) > 900) continue;
        const half = Math.max(riverWidthAt(a.x), riverWidthAt(e.x)) / 2;
        const d = obbSegmentDistance(o, a, e);
        expect(d - half, `block ${bl.id}`).toBeGreaterThanOrEqual(RIVER_CLEARANCE - 1e-6);
      }
      for (let i = 0; i < sg.length - 1; i++) {
        const d = obbSegmentDistance(o, sg[i]!, sg[i + 1]!);
        expect(d - SAETGANG.width / 2, `block ${bl.id}`).toBeGreaterThanOrEqual(RIVER_CLEARANCE);
      }
      for (const { hw, s } of segs) {
        for (let i = 0; i < s.length - 1; i++) {
          const a = s[i]!;
          const b = s[i + 1]!;
          if (Math.min(a.x, b.x) - 400 > bl.x || Math.max(a.x, b.x) + 400 < bl.x) continue;
          if (Math.min(a.z, b.z) - 400 > bl.z || Math.max(a.z, b.z) + 400 < bl.z) continue;
          expect(obbSegmentDistance(o, a, b), `block ${bl.id} vs ${hw.id}`).toBeGreaterThanOrEqual(
            hw.corridorHalf,
          );
        }
      }
      // Every building of the block lies inside the block rectangle.
      for (const id of bl.buildingIds) {
        const b = B[id]!;
        const big = { ...o, hw: o.hw + 1e-6, hd: o.hd + 1e-6 };
        expect(obbOverlap(big, obb(b))).toBe(true);
      }
      expect(bl.w).toBeLessThanOrEqual(300);
      expect(bl.d).toBeLessThanOrEqual(300);
    }
  }, 60_000);

  it('applies the block height rules (ratio ≥ 3, touching neighbours differ > 10 %)', () => {
    for (const bl of L.blocks) {
      const RATIO = ['core', 'megacore', 'corridor', 'midtown', 'sangga', 'nightlife'];
      if (!RATIO.includes(bl.district) || bl.buildingIds.length < 2) continue;
      const bs = bl.buildingIds.map((id) => B[id]!);
      // Blocks of megatowers only have no low building to compare against.
      if (bs.every((b) => b.tags.corp)) continue;
      const hs = bs.map((b) => b.h);
      expect(Math.max(...hs) / Math.min(...hs), `block ${bl.id}`).toBeGreaterThanOrEqual(3 - 1e-9);
      for (let i = 0; i < bs.length; i++) {
        for (let j = i + 1; j < bs.length; j++) {
          const a = bs[i]!;
          const b = bs[j]!;
          if (a.h >= MEGA_MIN_H && b.h >= MEGA_MIN_H) continue;
          if (!obbOverlap(obb(a), obb(b), NEIGHBOUR_GAP)) continue;
          expect(tooSimilar(a.h, b.h), `block ${bl.id}: ${a.id} vs ${b.id}`).toBe(false);
        }
      }
    }
  });

  it('builds every megacore tower tier as planned, with podiums between the towers', () => {
    const band = (id: string, lo: number, hi: number) =>
      B.filter((b) => b.zoneId === id && b.h >= lo && b.h < hi).length;
    expect([
      band('yongsan', 600, 601),
      band('yongsan', 280, 451),
      band('yongsan', 120, 251),
    ]).toEqual([1, 6, 16]);
    expect([
      band('yeouido', 430, 431),
      band('yeouido', 300, 361),
      band('yeouido', 120, 221),
    ]).toEqual([1, 4, 18]);
    expect([band('jamsil', 500, 501), band('jamsil', 150, 301)]).toEqual([1, 10]);
    for (const id of ['yongsan', 'yeouido', 'jamsil']) {
      expect(band(id, 0, 120), `${id} podiums`).toBeGreaterThan(0);
    }
  });

  it('lines 테헤란로 with media slabs whose long side screens face the avenue', () => {
    const media = B.filter((b) => b.archetype === 'mediaSlab');
    expect(media.length).toBeGreaterThanOrEqual(6);
    expect(media.length).toBeLessThanOrEqual(10);
    const [ta, tb] = TEHERAN;
    const sides = new Set<number>();
    for (const b of media) {
      expect(b.tags.mediaFace, `building ${b.id}`).toBeDefined();
      const face = buildingFaces(b).find(
        (f) => f.stack === 0 && f.tier === 0 && f.side === b.tags.mediaFace,
      )!;
      expect(face.width, `building ${b.id}`).toBeGreaterThanOrEqual(40);
      // The screen's outward normal points at the closest point of 테헤란로.
      const ux = tb.x - ta.x;
      const uz = tb.z - ta.z;
      const t = Math.max(
        0,
        Math.min(1, ((b.x - ta.x) * ux + (b.z - ta.z) * uz) / (ux * ux + uz * uz)),
      );
      const dx = ta.x + ux * t - b.x;
      const dz = ta.z + uz * t - b.z;
      const dl = Math.hypot(dx, dz);
      expect((face.normal.x * dx + face.normal.z * dz) / dl, `building ${b.id}`).toBeGreaterThan(
        0.9,
      );
      sides.add(Math.sign(ux * (b.z - ta.z) - uz * (b.x - ta.x)));
    }
    // Both sides of the avenue get screens.
    expect(sides.size).toBe(2);
  });

  it('lines the five riverside apartment strips with slab walls', () => {
    const slabs = (id: string) =>
      B.filter((b) => b.zoneId === id && b.archetype === 'apartmentSlab').length;
    const min: Record<string, number> = {
      'apt-ichon': 5,
      'apt-banpo': 20,
      'apt-apgu': 7,
      'apt-jamsil': 7,
      'apt-gwangjin': 18,
    };
    for (const [id, n] of Object.entries(min)) expect(slabs(id), id).toBeGreaterThanOrEqual(n);
    expect(B.filter((b) => b.archetype === 'apartmentSlab').length).toBeGreaterThanOrEqual(70);
  });

  it('gives every built zone enough buildings to read as a district', () => {
    // About 80 % of the 7-seed minimum when set; 마포·공덕 must not be eaten by 용산 again.
    const min: Record<string, number> = {
      mapo: 38,
      yongsan: 20,
      yeouido: 28,
      jamsil: 22,
      // The 테헤란로 media slabs take the avenue frontage: fewer, larger towers.
      gangnam: 17,
      cheongdam: 20,
      hongdae: 60,
      itaewon: 140,
      jongno: 230,
      seongsu: 180,
      wangsimni: 160,
      seocho: 250,
      yeongdeungpo: 1200,
      'fill-north': 1600,
      'fill-south': 330,
      riverside: 20,
      palace: 4,
    };
    for (const [id, n] of Object.entries(min)) {
      expect(B.filter((b) => b.zoneId === id).length, id).toBeGreaterThanOrEqual(n);
    }
    // 청담's showroom streets (SEOUL.md 4.2): glass boxes, not just back-street offices.
    expect(B.filter((b) => b.archetype === 'showroomBox').length).toBeGreaterThanOrEqual(10);
  });

  it('keeps non-megatower heights under their zone caps (heights.tallMax)', () => {
    const cap = new Map(ZONES.map((z) => [z.id, z.heights.tallMax]));
    for (const b of B) {
      if (b.tags.corp) continue;
      // A piloti ground floor can add 2.2 m to an apartment slab.
      const extra = b.archetype === 'apartmentSlab' ? 2.2 : 0;
      expect(b.h, `building ${b.id}`).toBeLessThanOrEqual(cap.get(b.zoneId)! + extra + 1e-9);
    }
  });
});
