// Rig camera presets 1-8 (ART_DIRECTION 8.4) and the cinematic tour order (8.5).
// Every pose goes through `fitPolar` (orbit polar limit) and `resolveCollision`, and is
// unit tested in tests/ux-camera.test.ts. The `?cam=` presets are read only through
// `camPose` (via `cameraPreset()`, which computes the street pose lazily).
import { LAYOUT, highwayCurve, type Layout, type Vec3 } from '../city/layout';
import { CAMERA_LIMITS, cameraPreset, type CameraPreset } from '../core/query';
import { cameraFloor, resolveCollision, targetFloor } from './collision';
import { fitPolar, type Pose } from './motion';

export interface RigPreset extends Pose {
  key: number;
  name: string;
}

type Tuple = readonly [number, number, number];
const v = (a: Tuple): Vec3 => ({ x: a[0], y: a[1], z: a[2] });

/** `?cam=` preset as a Pose. */
export function camPose(name: CameraPreset): Pose {
  const p = cameraPreset(name);
  return { position: v(p.position), target: v(p.target) };
}

/** Polar fit + wall / ground clearance, the invariants every preset must hold. */
export function safePose(L: Layout, pose: Pose): Pose {
  const p = { ...pose.position };
  p.y = Math.max(p.y, cameraFloor(p.x, p.z));
  const position = resolveCollision(L, p) ?? p;
  const fitted = fitPolar({ position, target: { ...pose.target } }, CAMERA_LIMITS.maxPolarAngle);
  const t = fitted.target;
  const floor = targetFloor(t.x, t.z);
  if (t.y >= floor) return fitted;
  // Lowering went underground: pull the target closer along the same bearing instead.
  const dx = t.x - position.x;
  const dz = t.z - position.z;
  const horiz = Math.hypot(dx, dz);
  const slope = (position.y - t.y) / horiz;
  const reach = Math.max(CAMERA_LIMITS.minDistance, (position.y - floor) / slope);
  const k = Math.min(1, reach / horiz);
  return { position, target: { x: position.x + dx * k, y: floor, z: position.z + dz * k } };
}

/** 8.4 preset 4: hw-ring at t = 0.1, 8 m over the deck, looking 120 m ahead. */
function highwayPose(L: Layout): Pose {
  const hw = L.highways.find((h) => h.id === 'hw-ring') ?? L.highways[0];
  if (!hw) return camPose('overview');
  const curve = highwayCurve(hw);
  const len = curve.getLength();
  const u0 = 0.1;
  const u1 = (u0 + 120 / len) % 1;
  const a = curve.getPointAt(u0);
  const b = curve.getPointAt(u1);
  return { position: { x: a.x, y: a.y + 8, z: a.z }, target: { x: b.x, y: b.y + 1, z: b.z } };
}

/** 8.4 preset 7: middle of bridge-b, looking north at the core. */
function bridgePose(L: Layout): Pose {
  const br = L.bridges.find((b) => b.id === 'bridge-b') ?? L.bridges[0];
  if (!br) return camPose('overview');
  const cx = (br.a.x + br.b.x) / 2;
  const cz = (br.a.z + br.b.z) / 2;
  return {
    position: { x: cx, y: br.deckY + 4, z: cz },
    target: { x: cx, y: br.deckY, z: -400 },
  };
}

function build(L: Layout): RigPreset[] {
  const raw: [string, Pose][] = [
    ['강변 히어로', camPose('skyline')],
    ['코어 상공', camPose('overview')],
    ['등불가 거리', camPose('street')],
    ['고가도로', highwayPose(L)],
    ['별계단동', { position: v([-300, 140, -980]), target: v([-60, 80, -200]) }],
    ['새빛마을', { position: v([150, 70, 980]), target: v([60, 40, 700]) }],
    ['다리 위', bridgePose(L)],
    ['탑다운', camPose('topdown')],
  ];
  return raw.map(([name, pose], i) => ({ key: i + 1, name, ...safePose(L, pose) }));
}

let cache: RigPreset[] | null = null;
/** The 8 presets, built on first use from the shared layout. */
export function rigPresets(): readonly RigPreset[] {
  cache ??= build(LAYOUT);
  return cache;
}

export function rigPreset(key: number): RigPreset {
  const list = rigPresets();
  return list[Math.min(list.length, Math.max(1, Math.round(key))) - 1] as RigPreset;
}

/** 8.5 tour order (closed loop). */
export const CINEMATIC_ORDER = [1, 5, 2, 7, 4, 3, 6] as const;

/** Default preset (R key, boot). */
export const DEFAULT_PRESET = 1;

/**
 * 8.5 key frames: every preset plus a lifted midpoint between neighbours, so the loop swoops
 * over the rooftops instead of cutting through blocks (street-level presets included).
 */
export function cinematicKeys(presets: readonly Pose[]): { positions: Vec3[]; targets: Vec3[] } {
  const positions: Vec3[] = [];
  const targets: Vec3[] = [];
  presets.forEach((a, i) => {
    const b = presets[(i + 1) % presets.length] as Pose;
    positions.push(a.position);
    targets.push(a.target);
    positions.push({
      x: (a.position.x + b.position.x) / 2,
      y: Math.max(160, Math.max(a.position.y, b.position.y) + 80),
      z: (a.position.z + b.position.z) / 2,
    });
    targets.push({
      x: (a.target.x + b.target.x) / 2,
      y: (a.target.y + b.target.y) / 2,
      z: (a.target.z + b.target.z) / 2,
    });
  });
  return { positions, targets };
}
