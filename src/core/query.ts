// URL query hooks for deterministic screenshots and debugging.
//   ?time=0..1   fixed time of day (pauses the cycle)
//   ?cam=<name>  preset camera pose
//   ?rain=0..1   initial rain intensity
//   ?nogui       hide the lil-gui panel

import { LAYOUT, type Road } from '../city/layout';

/**
 * OrbitControls limits applied by main.ts. Every camera preset must satisfy them,
 * otherwise controls.update() silently moves the camera on the first frame.
 * The camera always looks down at (or level with) its target: polar angle is
 * measured from +Y, so maxPolarAngle just under PI/2 keeps it above the horizon.
 * maxDistance covers the 2400 m map from the topdown preset (ART_DIRECTION 8.1: 2600).
 */
export const CAMERA_LIMITS = {
  minDistance: 20,
  maxDistance: 2600,
  maxPolarAngle: Math.PI * 0.495,
} as const;

export interface CameraPose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
}
type Pose = CameraPose;

/** Used when no suitable street exists (e.g. a different layout seed): 8.4 preset 3 as written. */
export const STREET_FALLBACK: CameraPose = { position: [-760, 6, -360], target: [-700, 1, -470] };

/**
 * Eye-level shot down a sangga street, snapped onto the road center line nearest to
 * ART_DIRECTION 8.4 preset 3 so it stays on a road whatever the grid angle or zone ids are.
 */
export function streetPose(roads: readonly Road[]): Pose | null {
  const want = { x: -760, z: -360 };
  let best: { road: Road; t: number; d: number } | null = null;
  for (const road of roads) {
    if (road.district !== 'sangga' || road.kind !== 'street') continue;
    const dx = road.b.x - road.a.x;
    const dz = road.b.z - road.a.z;
    const len2 = dx * dx + dz * dz;
    const t = Math.min(
      1,
      Math.max(0, ((want.x - road.a.x) * dx + (want.z - road.a.z) * dz) / len2),
    );
    const d = Math.hypot(road.a.x + dx * t - want.x, road.a.z + dz * t - want.z);
    if (Math.sqrt(len2) > 300 && (!best || d < best.d)) best = { road, t, d };
  }
  if (!best) return null;
  const { road } = best;
  const dx = road.b.x - road.a.x;
  const dz = road.b.z - road.a.z;
  const len = Math.hypot(dx, dz);
  // Keep 160 m of road ahead of the camera.
  const t = Math.min(best.t, 1 - 160 / len);
  const px = road.a.x + dx * t;
  const pz = road.a.z + dz * t;
  return {
    position: [px, 5, pz],
    target: [px + (dx / len) * 140, 1, pz + (dz / len) * 140],
  };
}

let streetCache: Pose | undefined;

export const CAMERA_PRESETS = {
  /** ART_DIRECTION 8.4 preset 2 (코어 상공). */
  overview: { position: [520, 420, 380], target: [-40, 120, -360] },
  /** Computed lazily from the layout on first access; falls back to STREET_FALLBACK. */
  get street(): Pose {
    streetCache ??= streetPose(LAYOUT.roads) ?? STREET_FALLBACK;
    return streetCache;
  },
  /** Between the megatowers around the skyline peak (-60, -380). */
  core: { position: [180, 220, -120], target: [-60, 160, -380] },
  /** 8.4 preset 8. */
  topdown: { position: [0, 1900, 1], target: [0, 0, 0] },
  /** 8.4 preset 1 (강변 히어로), target lowered to satisfy the polar limit. */
  skyline: { position: [-420, 38, 300], target: [-60, 20, -300] },
} as const satisfies Record<string, Pose>;

export type CameraPreset = keyof typeof CAMERA_PRESETS;

/** Pose of a named preset (preferred accessor; the street pose is resolved lazily). */
export function cameraPreset(name: CameraPreset): CameraPose {
  return CAMERA_PRESETS[name];
}

export interface QueryOptions {
  time?: number;
  cam?: CameraPreset;
  rain?: number;
  nogui: boolean;
}

function unit(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(1, Math.max(0, n));
}

function isPreset(value: string | null): value is CameraPreset {
  return value !== null && Object.hasOwn(CAMERA_PRESETS, value);
}

export function parseQuery(search: string): QueryOptions {
  const params = new URLSearchParams(search);
  const opts: QueryOptions = { nogui: params.has('nogui') };
  const time = unit(params.get('time'));
  if (time !== undefined) opts.time = time;
  const rain = unit(params.get('rain'));
  if (rain !== undefined) opts.rain = rain;
  const cam = params.get('cam');
  if (isPreset(cam)) opts.cam = cam;
  return opts;
}
