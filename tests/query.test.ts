import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../src/city/layout';
import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CAMERA_LIMITS, CAMERA_PRESETS, type CameraPreset, parseQuery } from '../src/core/query';

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
  it('places the street camera on the center line of a north-south road', () => {
    const [x] = CAMERA_PRESETS.street.position;
    const road = LAYOUT.roads.find((r) => r.axis === 'z' && r.x === x);
    expect(road).toBeDefined();
    expect(CAMERA_PRESETS.street.target[0]).toBe(x);
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
