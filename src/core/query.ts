// URL query hooks for deterministic screenshots and debugging.
//   ?time=0..1   fixed time of day (pauses the cycle)
//   ?cam=<name>  preset camera pose
//   ?rain=0..1   initial rain intensity
//   ?nogui       hide the lil-gui panel
//   ?quality=low software-GL mode for CI (see Quality)

import {
  CITY,
  LAYOUT,
  SKYLINE_PEAK,
  surfaceHeight,
  type DistrictZone,
  type Road,
  type Vec2,
} from '../city/layout';
import type { Quality } from './types';

type Tuple = readonly [number, number, number];

export interface CameraPose {
  readonly position: Tuple;
  readonly target: Tuple;
}
type Pose = CameraPose;

/** Map-relative presets: the same framing whichever layout version is loaded. */
const TOPDOWN_Y = CITY.extent / 2 + 700;

/**
 * OrbitControls limits applied by main.ts. Every camera preset must satisfy them,
 * otherwise controls.update() silently moves the camera on the first frame.
 * The camera always looks down at (or level with) its target: polar angle is
 * measured from +Y, so maxPolarAngle just under PI/2 keeps it above the horizon.
 * maxDistance leaves 700 m of zoom-out beyond the topdown preset (v2: 2600).
 */
export const CAMERA_LIMITS = {
  minDistance: 20,
  maxDistance: TOPDOWN_Y + 700,
  maxPolarAngle: Math.PI * 0.495,
} as const;

/** Used when no suitable street exists (e.g. a different layout seed): 8.4 preset 3 as written. */
export const STREET_FALLBACK: CameraPose = { position: [-760, 6, -360], target: [-700, 1, -470] };

export interface StreetAnchor {
  kind: string;
  want: Vec2;
}

/**
 * Where the eye-level street preset goes: a nightlife zone's grid origin (layout v3, 홍대),
 * otherwise the sangga point of ART_DIRECTION 8.4 preset 3 (layout v2, 등불가).
 */
export function streetAnchor(
  zones: readonly Pick<DistrictZone, 'kind' | 'origin'>[],
): StreetAnchor | null {
  const night = zones.find((z) => z.kind === 'nightlife');
  if (night) return { kind: 'nightlife', want: night.origin };
  if (zones.some((z) => z.kind === 'sangga')) return { kind: 'sangga', want: { x: -760, z: -360 } };
  return null;
}

/** Eye-level shot snapped onto the center line of the `anchor.kind` street nearest to `anchor.want`. */
export function streetPose(roads: readonly Road[], anchor: StreetAnchor | null): Pose | null {
  if (!anchor) return null;
  const { want } = anchor;
  let best: { road: Road; t: number; d: number } | null = null;
  for (const road of roads) {
    if (road.district !== anchor.kind || road.kind !== 'street') continue;
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
  const len = Math.hypot(road.b.x - road.a.x, road.b.z - road.a.z);
  const look = (from: Vec2, to: Vec2, t: number): Pose => {
    const ux = (to.x - from.x) / len;
    const uz = (to.z - from.z) / len;
    // Keep 160 m of road ahead of the camera.
    const s = Math.min(t, 1 - 160 / len) * len;
    const px = from.x + ux * s;
    const pz = from.z + uz * s;
    const tx = px + ux * 140;
    const tz = pz + uz * 140;
    return {
      position: [px, surfaceHeight(px, pz) + 5, pz],
      target: [tx, surfaceHeight(tx, tz) + 1, tz],
    };
  };
  const ahead = look(road.a, road.b, best.t);
  // Looking up a hill street would break maxPolarAngle, so face downhill instead.
  if (ahead.target[1] < ahead.position[1]) return ahead;
  return look(road.b, road.a, 1 - best.t);
}

/** Offsets from SKYLINE_PEAK; on layout v2 these reproduce ART_DIRECTION 8.4 exactly. */
const fromPeak = (position: Tuple, target: Tuple): Pose => {
  const { x, z } = SKYLINE_PEAK;
  return {
    position: [x + position[0], position[1], z + position[2]],
    target: [x + target[0], target[1], z + target[2]],
  };
};

let streetCache: Pose | undefined;

export const CAMERA_PRESETS = {
  /** ART_DIRECTION 8.4 preset 2 (코어 상공). */
  overview: fromPeak([580, 420, 760], [20, 120, 20]),
  /** Computed lazily from the layout on first access; falls back to STREET_FALLBACK. */
  get street(): Pose {
    streetCache ??= streetPose(LAYOUT.roads, streetAnchor(LAYOUT.districts)) ?? STREET_FALLBACK;
    return streetCache;
  },
  /** Between the megatowers around the skyline peak. */
  core: fromPeak([240, 220, 260], [0, 160, 0]),
  /** 8.4 preset 8. */
  topdown: { position: [0, TOPDOWN_Y, 1], target: [0, 0, 0] },
  /** 8.4 preset 1 (강변 히어로), target lowered to satisfy the polar limit. */
  skyline: fromPeak([-360, 38, 680], [0, 20, 80]),
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
  quality?: Quality;
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
  const quality = params.get('quality');
  if (quality === 'low' || quality === 'high') opts.quality = quality;
  return opts;
}
