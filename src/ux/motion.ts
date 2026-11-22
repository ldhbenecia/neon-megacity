import type { BuildingSpec, Vec3 } from '../city/layout';

import { clamp } from '../city/math';

export { clamp };

export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function dampFactor(dt: number, tau: number): number {
  return tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
}

export function moveSpeed(heightAboveSurface: number, boost: boolean): number {
  return clamp(heightAboveSurface * 0.9, 12, 420) * (boost ? 3 : 1);
}

export function panSpeedFor(height: number): number {
  return clamp(0.8 + height / 300, 0.8, 2.4);
}

export interface Pose {
  position: Vec3;
  target: Vec3;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function bez(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

export interface Flight {
  from: Pose;
  to: Pose;
  c1: Vec3;
  c2: Vec3;
  duration: number;
}

export function flightDuration(distance: number): number {
  return clamp(0.9 + distance / 1500, 0.9, 2.2);
}

export function planFlight(from: Pose, to: Pose, lift = 60, minDuration = 0): Flight {
  const a = from.position;
  const b = to.position;
  const top = Math.max(a.y, b.y) + lift;
  const dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const hop = Math.hypot(b.x - a.x, b.z - a.z);
  const k = clamp(hop / 200, 0, 1);
  return {
    from,
    to,
    c1: {
      x: lerp(a.x, b.x, 1 / 3),
      y: lerp(lerp(a.y, b.y, 1 / 3), top, k),
      z: lerp(a.z, b.z, 1 / 3),
    },
    c2: {
      x: lerp(a.x, b.x, 2 / 3),
      y: lerp(lerp(a.y, b.y, 2 / 3), top, k),
      z: lerp(a.z, b.z, 2 / 3),
    },
    duration: Math.max(minDuration, flightDuration(dist)),
  };
}

export function flightPose(f: Flight, time: number, out: Pose): Pose {
  const e = easeInOutCubic(time / f.duration);
  const a = f.from.position;
  const d = f.to.position;
  out.position.x = bez(a.x, f.c1.x, f.c2.x, d.x, e);
  out.position.y = bez(a.y, f.c1.y, f.c2.y, d.y, e);
  out.position.z = bez(a.z, f.c1.z, f.c2.z, d.z, e);
  out.target.x = lerp(f.from.target.x, f.to.target.x, e);
  out.target.y = lerp(f.from.target.y, f.to.target.y, e);
  out.target.z = lerp(f.from.target.z, f.to.target.z, e);
  return out;
}

const DEG = Math.PI / 180;

export function frameBuilding(
  b: Pick<BuildingSpec, 'x' | 'z' | 'w' | 'd' | 'h' | 'baseY'>,
  camera: Vec3,
  opts: { bearingOffset?: number; elevation?: number } = {},
): Pose {
  const target = { x: b.x, y: b.baseY + b.h * 0.55, z: b.z };
  const dist = Math.max(b.w, b.d) * 2.2 + b.h * 0.45;
  let dx = camera.x - target.x;
  let dz = camera.z - target.z;
  const horiz = Math.hypot(dx, dz);
  if (horiz < 1e-6) {
    dx = 0;
    dz = 1;
  } else {
    dx /= horiz;
    dz /= horiz;
  }
  if (opts.bearingOffset) {
    const c = Math.cos(opts.bearingOffset);
    const s = Math.sin(opts.bearingOffset);
    [dx, dz] = [dx * c - dz * s, dx * s + dz * c];
  }
  const elev =
    opts.elevation ??
    clamp(Math.atan2(camera.y - target.y, Math.max(horiz, 1e-6)), 20 * DEG, 35 * DEG);
  return {
    target,
    position: {
      x: target.x + dx * Math.cos(elev) * dist,
      y: target.y + Math.sin(elev) * dist,
      z: target.z + dz * Math.cos(elev) * dist,
    },
  };
}

// Past maxPolarAngle, OrbitControls.update() silently moves the camera on the first frame.
export function fitPolar(pose: Pose, maxPolar: number, margin = 0.01): Pose {
  const { position: p, target: t } = pose;
  const horiz = Math.hypot(p.x - t.x, p.z - t.z);
  const minDrop = horiz * Math.tan(Math.PI / 2 - (maxPolar - margin));
  if (p.y - t.y >= minDrop) return pose;
  return { position: { ...p }, target: { x: t.x, y: p.y - minDrop, z: t.z } };
}

export function polarAngle(pose: Pose): number {
  const { position: p, target: t } = pose;
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  const dz = p.z - t.z;
  const len = Math.hypot(dx, dy, dz);
  return len > 0 ? Math.acos(clamp(dy / len, -1, 1)) : 0;
}
