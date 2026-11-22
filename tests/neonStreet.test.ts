import { describe, expect, it } from 'vitest';
import { LAYOUT, deckHeightAt, highwaySamples, surfaceHeight } from '../src/city/layout';
import { buildCatalog } from '../src/neon/catalog';
import {
  bridgePaths,
  endFade,
  groundPaths,
  highwayPath,
  packPaths,
  pathPoint,
  resample,
  vehicleStreams,
  type Path,
} from '../src/neon/lanes';
import {
  LIGHT_BUDGET,
  MAX_POINT_LIGHTS,
  pickLights,
  type LightCandidate,
} from '../src/neon/lights';
import { POOL_LIFT, planStreet } from '../src/neon/streetPlan';

const cat = buildCatalog(LAYOUT);
const SIDEWALK = 0.2;
const plan = planStreet(LAYOUT, cat, SIDEWALK);

describe('neon street props', () => {
  it('light pools sit above the sidewalk top (never under it)', () => {
    expect(plan.pools.length).toBeGreaterThan(400);
    for (const l of plan.lamps.filter((k) => k.scale === 1)) {
      const ground = surfaceHeight(l.x, l.z);
      // Street lights stand on the sidewalk (riverside parks have none).
      expect(l.y).toBeGreaterThanOrEqual(ground - 1e-6);
    }
    for (const p of plan.pools) {
      expect(p.y).toBeGreaterThanOrEqual(surfaceHeight(p.x, p.z) + POOL_LIFT - 2.5);
    }
    const streetPools = plan.pools.filter((p) => p.radius === 7.5);
    for (const p of streetPools) expect(p.y).toBeGreaterThanOrEqual(SIDEWALK + POOL_LIFT - 1e-6);
  });

  it('counts follow 6.2', () => {
    const lamps = plan.lamps.filter((l) => l.scale === 1).length;
    expect(lamps).toBeGreaterThanOrEqual(400);
    expect(lamps).toBeLessThanOrEqual(650);
    expect(plan.stalls.length).toBeGreaterThanOrEqual(40);
    expect(plan.stalls.length).toBeLessThanOrEqual(70);
    expect(plan.busStops.length).toBeGreaterThanOrEqual(30);
    expect(plan.busStops.length).toBeLessThanOrEqual(50);
    expect(plan.poles.length).toBeGreaterThanOrEqual(150);
    expect(plan.poles.length).toBeLessThanOrEqual(250);
  });

  it('street light arms reach toward a road', () => {
    for (const l of plan.lamps) {
      expect(Math.hypot(l.hx - l.x, l.hz - l.z)).toBeCloseTo(2.8 * l.scale, 5);
    }
  });
});

describe('neon traffic lanes', () => {
  const paths: Path[] = [
    ...groundPaths(LAYOUT.roads, (x, z) => surfaceHeight(x, z)),
    ...bridgePaths(LAYOUT.bridges, (x, z) => deckHeightAt(LAYOUT, x, z) ?? 0),
    ...LAYOUT.highways.map((h) => highwayPath(h.id, highwaySamples(h, 6), h.closed)),
  ];
  const vehicles = vehicleStreams(paths, LAYOUT.highways);

  it('vehicles fade to zero at open path ends (no pop-in) and never on closed loops', () => {
    for (const p of paths) {
      if (p.closed) {
        expect(endFade(0, p)).toBe(1);
        expect(endFade(0.999, p)).toBe(1);
      } else {
        expect(endFade(0, p)).toBe(0);
        expect(endFade(1, p)).toBe(0);
        expect(endFade(0.5, p)).toBe(1);
      }
    }
  });

  it('highway paths follow the curve and stay on the deck', () => {
    for (const p of paths.filter((k) => k.kind === 'highway')) {
      const hw = LAYOUT.highways.find((h) => h.id === p.id)!;
      for (const u of [0.1, 0.37, 0.5, 0.81]) {
        const q = pathPoint(p, u);
        if (Math.abs(q.x) > 1150 || Math.abs(q.z) > 1150) continue;
        const deck = deckHeightAt(LAYOUT, q.x, q.z);
        expect(deck).not.toBeNull();
        if (hw.kind !== 'atGrade') expect(Math.abs(q.y - deck!)).toBeLessThan(3.5);
      }
    }
  });

  it('stream sizes follow 6.2 (ground 400–700, highway 60–120 per lane)', () => {
    const ground = vehicles.filter((v) => paths[v.path]!.kind === 'ground').length;
    expect(ground).toBeGreaterThanOrEqual(400);
    expect(ground).toBeLessThanOrEqual(700);
    const rn = paths.findIndex((p) => p.id === 'hw-river-north');
    const perLane = new Map<string, number>();
    for (const v of vehicles.filter((k) => k.path === rn)) {
      const key = `${v.dir}:${v.lane}`;
      perLane.set(key, (perLane.get(key) ?? 0) + 1);
    }
    for (const n of perLane.values()) {
      expect(n).toBeGreaterThanOrEqual(60);
      expect(n).toBeLessThanOrEqual(120);
    }
  });

  it('resample keeps endpoints and packPaths stores the sample count', () => {
    const r = resample(
      [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 0, z: 10 },
      ],
      5,
    );
    expect(r.length).toBeCloseTo(20, 6);
    expect(r.points[4]).toEqual({ x: 10, y: 0, z: 10 });
    expect(r.points[2]!.x).toBeCloseTo(10, 6);
    const data = packPaths(paths.slice(0, 2), 512);
    expect(data[3]).toBe(paths[0]!.points.length);
  });
});

describe('neon point lights', () => {
  it('never exceeds the PointLight budget', () => {
    const total = Object.values(LIGHT_BUDGET).reduce((s, n) => s + n, 0);
    expect(total).toBeLessThanOrEqual(MAX_POINT_LIGHTS);
    const cands: LightCandidate[] = Array.from({ length: 200 }, (_, i) => ({
      group: (['street', 'screen', 'stall', 'river'] as const)[i % 4]!,
      x: i,
      y: 0,
      z: 0,
      color: [1, 1, 1],
      intensity: 1,
      distance: 20,
    }));
    const picked = pickLights(cands, { x: 0, y: 0, z: 0 });
    expect(picked.length).toBe(total);
    // Nearest street candidates win.
    expect(picked.slice(0, LIGHT_BUDGET.street)).toEqual([0, 4, 8]);
  });
});
