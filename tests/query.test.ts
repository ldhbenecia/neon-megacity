import { describe, expect, it } from 'vitest';
import { CITY, LAYOUT, SKYLINE_PEAK, buildingContaining, surfaceHeight } from '../src/city/layout';
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
  streetAnchors,
  streetPose,
  streetPreset,
  type StreetAnchor,
} from '../src/core/query';

function usedAnchor(): StreetAnchor {
  const name = streetPreset()?.name;
  const anchor = streetAnchors(LAYOUT.districts).find((a) => a.name === name);
  if (!anchor) throw new Error(`no street anchor produced a clear view (got ${String(name)})`);
  return anchor;
}

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

  it('accepts the user tiers and the ci tier only', () => {
    expect(parseQuery('?quality=low').quality).toBe('low');
    expect(parseQuery('?quality=medium').quality).toBe('medium');
    expect(parseQuery('?quality=high').quality).toBe('high');
    expect(parseQuery('?quality=ci').quality).toBe('ci');
    expect(parseQuery('?quality=ultra').quality).toBeUndefined();
  });
});

describe('CAMERA_PRESETS', () => {
  it('places the street camera on the center line of an anchor-kind street, looking along it', () => {
    const anchor = usedAnchor();
    const { position, target } = CAMERA_PRESETS.street;
    const p = { x: position[0], z: position[2] };
    const tx = target[0] - position[0];
    const tz = target[2] - position[2];
    // Target lies on the same line (cross product ~ 0); the camera may sit on a crossing.
    const along = LAYOUT.roads.some((r) => {
      if (r.kind !== 'street' || r.district !== anchor.kind) return false;
      if (pointSegmentDistance(p, r.a, r.b) > 1e-6) return false;
      const dx = r.b.x - r.a.x;
      const dz = r.b.z - r.a.z;
      return Math.abs(dx * tz - dz * tx) / Math.hypot(dx, dz) / Math.hypot(tx, tz) < 1e-9;
    });
    expect(along).toBe(true);
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
    expect(streetPose([], usedAnchor())).toBeNull();
    expect(streetAnchors([])).toEqual([]);
    expect(cameraPreset('street')).not.toEqual(STREET_FALLBACK);
  });

  it('sees the street target over the terrain', () => {
    const { position: p, target: t } = CAMERA_PRESETS.street;
    for (let i = 1; i < 20; i++) {
      const f = i / 20;
      const y = p[1] + (t[1] - p[1]) * f;
      expect(surfaceHeight(p[0] + (t[0] - p[0]) * f, p[2] + (t[2] - p[2]) * f)).toBeLessThan(y);
    }
  });

  it('snaps the street preset near its anchor point', () => {
    const anchor = usedAnchor();
    const [x, , z] = cameraPreset('street').position;
    // 160 m of road ahead and a clear view can both pull it off the anchor.
    expect(Math.hypot(x - anchor.want.x, z - anchor.want.z)).toBeLessThan(400);
  });

  it('tries a nightlife zone origin before the sangga fallback point', () => {
    const origin = { x: 1, z: 2 };
    expect(
      streetAnchors([
        { kind: 'sangga', name: 's', origin: { x: 0, z: 0 } },
        { kind: 'nightlife', name: 'n', origin },
      ]),
    ).toEqual([
      { kind: 'nightlife', name: 'n', want: origin },
      { kind: 'sangga', name: 's', want: { x: -760, z: -360 } },
    ]);
  });

  it('keeps the street view inside maxPolarAngle with margin', () => {
    const { position: p, target: t } = CAMERA_PRESETS.street;
    const polar = Math.atan2(Math.hypot(t[0] - p[0], t[2] - p[2]), p[1] - t[1]);
    expect(polar).toBeLessThan(CAMERA_LIMITS.maxPolarAngle);
  });

  it('keeps the topdown preset inside maxDistance', () => {
    const [, y] = CAMERA_PRESETS.topdown.position;
    expect(y).toBeGreaterThan(Math.max(CITY.extentX, CITY.extentZ) / 2);
    expect(CAMERA_LIMITS.maxDistance).toBeGreaterThan(y);
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
