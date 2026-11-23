import { describe, expect, it } from 'vitest';
import { LAYOUT, SKYLINE_PEAK, buildingContaining, surfaceHeight } from '../src/city/layout';
import { pointSegmentDistance } from '../src/city/math';
import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  CAMERA_LIMITS,
  CAMERA_PRESETS,
  STREET_FALLBACK,
  type CameraPreset,
  cameraPreset,
  parseQuery,
  streetPose,
} from '../src/core/query';

describe('parseQuery', () => {
  it('returns defaults for an empty query', () => {
    expect(parseQuery('')).toEqual({ nogui: false });
  });

  it('parses and clamps numeric params', () => {
    expect(parseQuery('?time=0.5&rain=2')).toEqual({ time: 0.5, rain: 1, nogui: false });
    expect(parseQuery('?time=-1').time).toBe(0);
  });

  it('ignores invalid values', () => {
    expect(parseQuery('?time=abc&rain=&cam=nope')).toEqual({ nogui: false });
    expect(parseQuery('?cam=toString').cam).toBeUndefined();
  });

  it('accepts camera presets and the nogui flag', () => {
    expect(parseQuery('?cam=street&nogui')).toEqual({ cam: 'street', nogui: true });
  });
});

describe('CAMERA_PRESETS', () => {
  it('places the street camera on the center line of a sangga street, looking along it', () => {
    const { position, target } = CAMERA_PRESETS.street;
    const p = { x: position[0], z: position[2] };
    const road = LAYOUT.roads.find(
      (r) =>
        r.kind === 'street' && r.zoneId === 'sangga-n' && pointSegmentDistance(p, r.a, r.b) < 1e-6,
    );
    expect(road).toBeDefined();
    const dx = road!.b.x - road!.a.x;
    const dz = road!.b.z - road!.a.z;
    const tx = target[0] - position[0];
    const tz = target[2] - position[2];
    // Target lies on the same line (cross product ~ 0).
    expect(Math.abs(dx * tz - dz * tx) / Math.hypot(dx, dz) / Math.hypot(tx, tz)).toBeLessThan(
      1e-9,
    );
  });

  it('keeps every preset camera outside buildings and above the ground', () => {
    for (const name of Object.keys(CAMERA_PRESETS) as CameraPreset[]) {
      const [x, y, z] = CAMERA_PRESETS[name].position;
      expect(buildingContaining(LAYOUT, x, y, z), name).toBeNull();
      expect(y, name).toBeGreaterThan(surfaceHeight(x, z) + 2);
    }
  });

  it('frames the skyline peak from the core and overview presets', () => {
    for (const name of ['core', 'overview', 'skyline'] as const) {
      const [tx, , tz] = CAMERA_PRESETS[name].target;
      expect(Math.hypot(tx - SKYLINE_PEAK.x, tz - SKYLINE_PEAK.z), name).toBeLessThan(120);
    }
  });

  it('exposes every preset through cameraPreset() and falls back without a street', () => {
    for (const name of Object.keys(CAMERA_PRESETS) as CameraPreset[]) {
      expect(cameraPreset(name)).toEqual(CAMERA_PRESETS[name]);
    }
    expect(streetPose([])).toBeNull();
    expect(cameraPreset('street')).not.toEqual(STREET_FALLBACK);
  });

  it('snaps the street preset near ART_DIRECTION 8.4 preset 3', () => {
    const [x, , z] = cameraPreset('street').position;
    expect(
      Math.hypot(x - STREET_FALLBACK.position[0], z - STREET_FALLBACK.position[2]),
    ).toBeLessThan(150);
  });

  const names = Object.keys(CAMERA_PRESETS) as CameraPreset[];

  it.each(names)('%s stays within the orbit limits', (name) => {
    const { position, target } = CAMERA_PRESETS[name];
    const offset = new Vector3(...position).sub(new Vector3(...target));
    const polar = Math.acos(offset.y / offset.length());
    expect(polar).toBeLessThanOrEqual(CAMERA_LIMITS.maxPolarAngle);
    expect(offset.length()).toBeGreaterThanOrEqual(CAMERA_LIMITS.minDistance);
    expect(offset.length()).toBeLessThanOrEqual(CAMERA_LIMITS.maxDistance);
  });

  it.each(names)('%s is not moved by OrbitControls.update()', (name) => {
    const { position, target } = CAMERA_PRESETS[name];
    const camera = new PerspectiveCamera();
    const controls = new OrbitControls(camera);
    Object.assign(controls, CAMERA_LIMITS);
    camera.position.fromArray(position);
    controls.target.fromArray(target);
    controls.update();
    expect(camera.position.distanceTo(new Vector3(...position))).toBeLessThan(1e-6);
  });
});
