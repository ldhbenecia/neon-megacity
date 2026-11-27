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
  GROUND_CAP,
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
import { LAMP_CAP, POOL_LIFT, lampBudget, planStreet } from '../src/neon/streetPlan';

/** Arterial plus street length (km): the roads that carry lights, stops and traffic. */
const roadKm =
  LAYOUT.roads
    .filter((r) => r.kind === 'arterial' || r.kind === 'street')
    .reduce((n, r) => n + Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z), 0) / 1000;

const cat = buildCatalog(LAYOUT);
const SIDEWALK = 0.2;
const plan = planStreet(LAYOUT, cat, SIDEWALK);

describe('neon street props', () => {
  it('light pools sit above the sidewalk top (never under it)', () => {
    expect(plan.pools.length).toBeGreaterThan(400);
    for (const l of plan.lamps.filter((k) => k.scale === 1)) {
      const ground = surfaceHeight(l.x, l.z);
      expect(l.y).toBeGreaterThanOrEqual(ground - 1e-6);
    }
    for (const p of plan.pools) {
      expect(p.y).toBeGreaterThanOrEqual(surfaceHeight(p.x, p.z) + POOL_LIFT - 2.5);
    }
    const streetPools = plan.pools.filter((p) => p.radius === 7.5);
    for (const p of streetPools) expect(p.y).toBeGreaterThanOrEqual(SIDEWALK + POOL_LIFT - 1e-6);
  });

  it('counts follow 6.2, scaled by road length', () => {
    const lamps = plan.lamps.filter((l) => l.scale === 1).length;
    expect(lamps).toBeLessThanOrEqual(lampBudget(LAYOUT));
    expect(lampBudget(LAYOUT)).toBeLessThanOrEqual(LAMP_CAP);
    const perKm = (n: number): number => n / roadKm;
    expect(perKm(lamps)).toBeGreaterThanOrEqual(4);
    expect(perKm(lamps)).toBeLessThanOrEqual(14);
    expect(perKm(plan.stalls.length)).toBeGreaterThanOrEqual(0.3);
    expect(perKm(plan.stalls.length)).toBeLessThanOrEqual(1.2);
    expect(perKm(plan.busStops.length)).toBeGreaterThanOrEqual(0.25);
    expect(perKm(plan.busStops.length)).toBeLessThanOrEqual(0.9);
    expect(perKm(plan.poles.length)).toBeGreaterThanOrEqual(1.5);
    expect(perKm(plan.poles.length)).toBeLessThanOrEqual(4.5);
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

  it('stream sizes follow 6.2 (ground 4–12 per road km up to the cap, highway 25–45 per lane km)', () => {
    const ground = vehicles.filter((v) => paths[v.path]!.kind === 'ground').length;
    expect(ground).toBeLessThanOrEqual(GROUND_CAP);
    expect(ground / roadKm).toBeGreaterThanOrEqual(4);
    expect(ground / roadKm).toBeLessThanOrEqual(12);
    const rn = paths.findIndex((p) => p.id === 'hw-river-north');
    const perLane = new Map<string, number>();
    for (const v of vehicles.filter((k) => k.path === rn)) {
      const key = `${v.dir}:${v.lane}`;
      perLane.set(key, (perLane.get(key) ?? 0) + 1);
    }
    const km = paths[rn]!.length / 1000;
    expect(perLane.size).toBeGreaterThan(0);
    for (const n of perLane.values()) {
      expect(n / km).toBeGreaterThanOrEqual(25);
      expect(n / km).toBeLessThanOrEqual(45);
    }
  });

  it('the ground cap also thins arterials when they alone exceed it', () => {
    const arterialLanes = vehicles.filter(
      (v) => paths[v.path]!.kind === 'ground' && paths[v.path]!.arterial,
    ).length;
    const cap = Math.floor(arterialLanes / 2);
    const few = vehicleStreams(paths, LAYOUT.highways, { groundCap: cap });
    const ground = few.filter((v) => paths[v.path]!.kind === 'ground');
    expect(ground.length).toBeLessThanOrEqual(cap);
    expect(ground.length).toBeGreaterThan(cap * 0.8);
    expect(ground.every((v) => paths[v.path]!.arterial)).toBe(true);
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
    expect(picked.slice(0, LIGHT_BUDGET.street)).toEqual([0, 4, 8]);
  });
});
