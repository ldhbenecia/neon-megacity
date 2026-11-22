// URL query hooks for deterministic screenshots and debugging.
//   ?time=0..1   fixed time of day (pauses the cycle)
//   ?cam=<name>  preset camera pose
//   ?rain=0..1   initial rain intensity
//   ?nogui       hide the lil-gui panel

import { CITY, roadCenter } from '../city/layout';

/**
 * OrbitControls limits applied by main.ts. Every camera preset must satisfy them,
 * otherwise controls.update() silently moves the camera on the first frame.
 * The camera always looks down at (or level with) its target: polar angle is
 * measured from +Y, so maxPolarAngle just under PI/2 keeps it above the horizon.
 */
export const CAMERA_LIMITS = {
  minDistance: 20,
  maxDistance: 1800,
  maxPolarAngle: Math.PI * 0.495,
} as const;

/** The north-south avenue just east of the city center; the street preset looks down it. */
const STREET_X = roadCenter(Math.ceil(CITY.gridN / 2));

export const CAMERA_PRESETS = {
  overview: { position: [520, 300, 520], target: [0, 60, 0] },
  street: { position: [STREET_X, 5, 260], target: [STREET_X, 1, 120] },
  core: { position: [150, 110, 190], target: [0, 100, 0] },
  topdown: { position: [0, 1150, 1], target: [0, 0, 0] },
  skyline: { position: [-760, 55, 320], target: [0, 30, 0] },
} as const satisfies Record<
  string,
  { position: readonly [number, number, number]; target: readonly [number, number, number] }
>;

export type CameraPreset = keyof typeof CAMERA_PRESETS;

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
