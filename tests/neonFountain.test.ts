import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../src/city/layout';
import {
  FOUNTAIN_JETS_PER_SIDE,
  fountainJets,
  fountainJetsFromNozzles,
} from '../src/neon/fountain';
import { laneSlots, railPaths, vehicleStreams } from '../src/neon/lanes';
import { trainCars } from '../src/neon/traffic';

describe('neon fountains (SEOUL.md 3.3)', () => {
  const jets = fountainJets(LAYOUT.bridges, LAYOUT.river.waterY);
  const fountainBridges = LAYOUT.bridges.filter((b) => b.motif === 'fountain');

  it('line both deck edges of every fountain bridge with a fixed jet count', () => {
    expect(jets).toHaveLength(fountainBridges.length * 2 * FOUNTAIN_JETS_PER_SIDE);
    expect(fountainJets(LAYOUT.bridges, LAYOUT.river.waterY, 0)).toHaveLength(0);
  });

  it('start on the deck edge between the abutments and fall to the water', () => {
    for (const br of fountainBridges) {
      const dx = br.b.x - br.a.x;
      const dz = br.b.z - br.a.z;
      const span = Math.hypot(dx, dz);
      for (const j of jets) {
        const rx = j.x - br.a.x;
        const rz = j.z - br.a.z;
        const t = (rx * dx + rz * dz) / span;
        const off = (rx * -dz + rz * dx) / span;
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t + j.len).toBeLessThanOrEqual(span + 1e-6);
        expect(Math.abs(Math.abs(off) - (br.width / 2 + 0.3))).toBeLessThan(1e-6);
        expect(Math.sign(off)).toBe(j.side);
        expect(j.y).toBe(br.deckY);
        expect(j.drop).toBeCloseTo(br.deckY - LAYOUT.river.waterY, 6);
        expect(j.reach).toBeGreaterThan(0);
        expect(Number.isFinite(j.phase)).toBe(true);
      }
    }
  });

  it('use infra nozzle lines when given, spraying to the outward side', () => {
    const nozzles = new Map([
      [
        'br-test',
        [
          { a: { x: 0, y: 15.7, z: 0 }, b: { x: 0, y: 15.7, z: 400 }, outward: { x: 1, z: 0 } },
          {
            a: { x: -30, y: 15.7, z: 0 },
            b: { x: -30, y: 15.7, z: 400 },
            outward: { x: -1, z: 0 },
          },
        ],
      ],
    ]);
    const j = fountainJetsFromNozzles(nozzles, -4);
    expect(j).toHaveLength(2 * FOUNTAIN_JETS_PER_SIDE);
    for (const k of j) {
      // Spray direction in the shader: (-along.z, along.x) * side.
      const sx = -k.alongZ * k.side;
      expect(Math.sign(sx)).toBe(k.x > -15 ? 1 : -1);
      expect(k.drop).toBeCloseTo(19.7, 6);
      expect(k.z).toBeGreaterThanOrEqual(0);
      expect(k.z + k.len).toBeLessThanOrEqual(400 + 1e-6);
    }
  });
});

describe('neon trains on infra rail tracks', () => {
  const tracks = new Map([
    [
      'br-rail',
      [
        {
          points: [
            { x: 0, y: 0, z: -100 },
            { x: 0, y: 12, z: 0 },
            { x: 0, y: 12, z: 600 },
          ],
        },
        {
          points: [
            { x: 6, y: 0, z: -100 },
            { x: 6, y: 12, z: 0 },
            { x: 6, y: 12, z: 600 },
          ],
        },
      ],
    ],
  ]);
  const paths = railPaths(tracks);

  it('make one one-way rail path per track, alternating direction', () => {
    expect(paths.map((p) => p.kind)).toEqual(['rail', 'rail']);
    expect(paths.map((p) => p.oneWay)).toEqual([1, -1]);
    expect(paths[0]!.length).toBeCloseTo(Math.hypot(100, 12) + 600, 3);
    for (const p of paths) expect(laneSlots(p, new Map())).toHaveLength(1);
  });

  it('run about one train per track crossing', () => {
    const trains = vehicleStreams(paths, []);
    expect(trains).toHaveLength(2);
    for (const t of trains) {
      expect(t.lane).toBe(0);
      const kmh = t.speed * paths[t.path]!.length * 3.6;
      expect(kmh).toBeGreaterThanOrEqual(55);
      expect(kmh).toBeLessThanOrEqual(75);
    }
  });

  it('splits every train into cars, each a car length further back on its own path point', () => {
    const trains = vehicleStreams(paths, []);
    const cars = trainCars(trains, paths);
    expect(cars.length).toBe(trains.length * 6);
    const len = paths[trains[0]!.path]!.length;
    const step = ((cars[0]!.u0 - cars[1]!.u0 + 1) % 1) * len;
    expect(step).toBeCloseTo(20, 6);
    for (const c of cars) expect(c.u0).toBeGreaterThanOrEqual(0);
  });
});
