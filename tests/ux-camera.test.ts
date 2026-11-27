import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LAYOUT, SKYLINE_PEAK, buildingContaining } from '../src/city/layout';
import { CAMERA_LIMITS } from '../src/core/query';
import { createRng } from '../src/core/random';
import { buildingVolumes, toWorld } from '../src/city/layout';
import {
  cameraFloor,
  frameBuildingClear,
  pick,
  raycastSurface,
  resolveCollision,
  standoff,
} from '../src/ux/collision';
import {
  dampFactor,
  easeInOutCubic,
  fitPolar,
  flightDuration,
  flightPose,
  frameBuilding,
  moveSpeed,
  planFlight,
  polarAngle,
  type Pose,
} from '../src/ux/motion';
import { CINEMATIC_ORDER, cinematicKeys, rigPresets } from '../src/ux/presets';
import { raycastBuildings } from '../src/city/layout';

const pose = (p: [number, number, number], t: [number, number, number]): Pose => ({
  position: { x: p[0], y: p[1], z: p[2] },
  target: { x: t[0], y: t[1], z: t[2] },
});

describe('motion', () => {
  it('eases from 0 to 1 symmetrically', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1);
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });

  it('damps frame-rate independently', () => {
    const twoHalf = 1 - (1 - dampFactor(1 / 120, 0.25)) ** 2;
    expect(twoHalf).toBeCloseTo(dampFactor(1 / 60, 0.25), 10);
  });

  it('scales keyboard speed with height (8.2)', () => {
    expect(moveSpeed(0, false)).toBe(12);
    expect(moveSpeed(100, false)).toBe(90);
    expect(moveSpeed(5000, false)).toBe(420);
    expect(moveSpeed(100, true)).toBe(270);
  });

  it('times flights by distance (8.3)', () => {
    expect(flightDuration(0)).toBe(0.9);
    expect(flightDuration(750)).toBeCloseTo(1.4);
    expect(flightDuration(1e5)).toBe(2.2);
  });

  it('arcs over the higher end point and lands exactly', () => {
    const a = pose([0, 50, 0], [0, 0, -100]);
    const b = pose([900, 120, 0], [900, 60, -100]);
    const f = planFlight(a, b);
    expect(f.c1.y).toBeCloseTo(180);
    expect(f.c2.y).toBeCloseTo(180);
    const out = pose([0, 0, 0], [0, 0, 0]);
    flightPose(f, 0, out);
    expect(out.position).toEqual(a.position);
    flightPose(f, f.duration / 2, out);
    expect(out.position.y).toBeGreaterThan(120);
    flightPose(f, f.duration, out);
    expect(out.position.x).toBeCloseTo(900);
    expect(out.target.y).toBeCloseTo(60);
  });

  it('frames a building keeping the bearing, elevation 20..35°', () => {
    const b = { x: 100, z: 0, w: 40, d: 30, h: 200, baseY: 0 };
    const p = frameBuilding(b, { x: 100, y: 5, z: 500 });
    expect(p.target.x).toBe(100);
    expect(p.target.y).toBeCloseTo(110);
    expect(p.target.z).toBe(0);
    const dist = Math.hypot(
      p.position.x - p.target.x,
      p.position.y - p.target.y,
      p.position.z - p.target.z,
    );
    expect(dist).toBeCloseTo(40 * 2.2 + 200 * 0.45);
    expect(p.position.x).toBeCloseTo(100); // same bearing (+Z)
    const elev = Math.asin((p.position.y - p.target.y) / dist);
    expect(elev).toBeCloseTo((20 * Math.PI) / 180);
    const high = frameBuilding(b, { x: 100, y: 3000, z: 1 });
    const e2 = Math.atan2(high.position.y - high.target.y, Math.abs(high.position.z));
    expect(e2).toBeCloseTo((35 * Math.PI) / 180);
  });

  it('fitPolar lowers the target only when needed', () => {
    const ok = pose([0, 100, 0], [0, 0, -100]);
    expect(fitPolar(ok, CAMERA_LIMITS.maxPolarAngle)).toBe(ok);
    // Looking slightly up (target above the camera) exceeds the limit.
    const up = pose([0, 10, 0], [0, 30, -500]);
    expect(polarAngle(up)).toBeGreaterThan(CAMERA_LIMITS.maxPolarAngle);
    const fixed = fitPolar(up, CAMERA_LIMITS.maxPolarAngle);
    expect(polarAngle(fixed)).toBeLessThan(CAMERA_LIMITS.maxPolarAngle);
    expect(fixed.target.x).toBe(0);
    expect(fixed.target.z).toBe(-500);
  });
});

describe('collision', () => {
  const tall = LAYOUT.buildings.reduce((a, b) => (b.h > a.h ? b : a));

  it('pushes a camera inside a building out past the nearest face', () => {
    const t = tall.tiers[0]!;
    const inside = { x: t.x, y: (t.y0 + t.y1) / 2, z: t.z };
    expect(buildingContaining(LAYOUT, inside.x, inside.y, inside.z)).toBe(tall.id);
    const out = resolveCollision(LAYOUT, inside);
    expect(out).not.toBeNull();
    expect(buildingContaining(LAYOUT, out!.x, out!.y, out!.z)).toBeNull();
    // Running it again on the result is a no-op (stable, no jitter).
    expect(resolveCollision(LAYOUT, out!)).toBeNull();
  });

  it('keeps a height-scaled standoff of 3..25 m', () => {
    for (const b of LAYOUT.buildings) {
      expect(standoff(b)).toBeGreaterThanOrEqual(3);
      expect(standoff(b)).toBeLessThanOrEqual(25);
    }
    expect(standoff(tall)).toBe(25);
  });

  it('never leaves the camera inside a building and settles in one call', () => {
    const rng = createRng(7);
    let checked = 0;
    for (const b of LAYOUT.buildings) {
      if (rng.next() > 0.08) continue;
      for (const v of buildingVolumes(b)) {
        const w = toWorld((rng.next() - 0.5) * v.w, (rng.next() - 0.5) * v.d, b.rotY);
        const p = { x: v.x + w.x, y: v.y0 + (v.y1 - v.y0) * rng.next(), z: v.z + w.z };
        const out = resolveCollision(LAYOUT, p) ?? p;
        expect(buildingContaining(LAYOUT, out.x, out.y, out.z), JSON.stringify(p)).toBeNull();
        expect(resolveCollision(LAYOUT, out), JSON.stringify(p)).toBeNull();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('pushes a camera resting on a setback roof out of the tier above it', () => {
    const b = LAYOUT.buildings.find((x) => {
      const v = buildingVolumes(x);
      return v.length > 2 && v[1]!.shape !== 'cylinder' && v[1]!.w < v[0]!.w - 4;
    })!;
    const [low, up] = buildingVolumes(b) as [
      ReturnType<typeof buildingVolumes>[number],
      ReturnType<typeof buildingVolumes>[number],
    ];
    const w = toWorld(up.w / 2 - 0.5, 0, b.rotY);
    const p = { x: up.x + w.x, y: low.y1 + standoff(b), z: up.z + w.z };
    expect(buildingContaining(LAYOUT, p.x, p.y, p.z)).toBe(b.id);
    const out = resolveCollision(LAYOUT, p);
    expect(out).not.toBeNull();
    expect(buildingContaining(LAYOUT, out!.x, out!.y, out!.z)).toBeNull();
  });

  it('keeps the wall margin and pushes a roof-skimming camera up', () => {
    const top = tall.tiers[tall.tiers.length - 1]!;
    const skim = { x: top.x, y: top.y1 + 0.5, z: top.z };
    const out = resolveCollision(LAYOUT, skim);
    expect(out?.y).toBeCloseTo(top.y1 + standoff(tall));
  });

  it('leaves free space alone', () => {
    expect(resolveCollision(LAYOUT, { x: 0, y: 1500, z: 0 })).toBeNull();
  });

  it('clamps above ground and above the river surface', () => {
    expect(cameraFloor(5000, 5000)).toBeGreaterThanOrEqual(2);
    const r = LAYOUT.river.centerline[16]!;
    expect(cameraFloor(r.x, r.z)).toBeCloseTo(LAYOUT.river.waterY + 3);
  });

  it('raycasts the ground and picks buildings in front of it', () => {
    const t = raycastSurface({ x: 0, y: 100, z: 2000 }, { x: 0, y: -1, z: 0 });
    expect(t).toBeCloseTo(100 - cameraFloor(0, 2000) + 2, 1);
    expect(raycastSurface({ x: 0, y: 100, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull();
    const t0 = tall.tiers[0]!;
    const from = { x: t0.x + t0.w + 60, y: t0.y0 + 20, z: t0.z };
    const dir = { x: -1, y: 0, z: 0 };
    const hit = pick(LAYOUT, from, dir);
    expect(hit?.kind).toBe('building');
  });
});

describe('rig presets (8.4)', () => {
  const presets = rigPresets();

  it('defines 8 presets and a closed cinematic loop over 7 of them', () => {
    expect(presets.map((p) => p.key)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(CINEMATIC_ORDER).size).toBe(7);
  });

  it.each(presets.map((p) => [p.key, p] as const))(
    'preset %i is outside buildings and above the floor',
    (_k, p) => {
      const { x, y, z } = p.position;
      expect(buildingContaining(LAYOUT, x, y, z)).toBeNull();
      expect(y).toBeGreaterThanOrEqual(cameraFloor(x, z) - 1e-9);
    },
  );

  // Presets 1, 3 and 7 sit near the polar limit; keep them inside it.
  it.each(presets.map((p) => [p.key, p] as const))(
    'preset %i satisfies the orbit limits and is not moved by OrbitControls.update()',
    (_k, p) => {
      expect(polarAngle(p)).toBeLessThanOrEqual(CAMERA_LIMITS.maxPolarAngle);
      const camera = new PerspectiveCamera();
      const controls = new OrbitControls(camera);
      Object.assign(controls, CAMERA_LIMITS);
      const pos = new Vector3(p.position.x, p.position.y, p.position.z);
      camera.position.copy(pos);
      controls.target.set(p.target.x, p.target.y, p.target.z);
      const d = camera.position.distanceTo(controls.target);
      expect(d).toBeGreaterThanOrEqual(CAMERA_LIMITS.minDistance);
      expect(d).toBeLessThanOrEqual(CAMERA_LIMITS.maxDistance);
      controls.update();
      expect(camera.position.distanceTo(pos)).toBeLessThan(1e-6);
    },
  );
});

describe('framing and cinematic keys', () => {
  it('frames core towers with a clear line of sight from outside every building', () => {
    const P = SKYLINE_PEAK;
    const core = LAYOUT.buildings
      .filter((b) => b.h > 120 && Math.hypot(b.x - P.x, b.z - P.z) < 400)
      .slice(0, 12);
    expect(core.length).toBeGreaterThan(3);
    let clear = 0;
    for (const b of core) {
      const pose = frameBuildingClear(LAYOUT, b, { x: P.x + 580, y: 420, z: P.z + 760 });
      const p = pose.position;
      expect(buildingContaining(LAYOUT, p.x, p.y, p.z)).toBeNull();
      const dir = { x: pose.target.x - p.x, y: pose.target.y - p.y, z: pose.target.z - p.z };
      if (raycastBuildings(LAYOUT, p, dir)?.id === b.id) clear++;
    }
    expect(clear).toBe(core.length);
  });

  it('lifts a midpoint between every pair of presets', () => {
    const presets = rigPresets();
    const { positions, targets } = cinematicKeys(presets.slice(0, 3));
    expect(positions).toHaveLength(6);
    expect(targets).toHaveLength(6);
    for (let i = 1; i < 6; i += 2) expect(positions[i]!.y).toBeGreaterThanOrEqual(160);
  });
});
