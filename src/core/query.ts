// URL query hooks for deterministic screenshots and debugging.
//   ?time=0..1   fixed time of day (pauses the cycle)
//   ?cam=<name>  preset camera pose
//   ?rain=0..1   initial rain intensity
//   ?nogui       hide the lil-gui panel
//   ?quality=low|high  render tier (low: software GL for CI, see Quality)

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
// CITY.extent is the longer side of the map on every layout version.
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
  /** Zone display name, used for the rig preset label. */
  name: string;
  want: Vec2;
}

/**
 * Where the eye-level street preset may go, in order of preference: a nightlife zone's grid
 * origin (layout v3, 홍대), then the sangga point of ART_DIRECTION 8.4 preset 3 (v2, 등불가).
 */
export function streetAnchors(
  zones: readonly Pick<DistrictZone, 'kind' | 'name' | 'origin'>[],
): StreetAnchor[] {
  const out: StreetAnchor[] = [];
  const night = zones.find((z) => z.kind === 'nightlife');
  if (night) out.push({ kind: 'nightlife', name: night.name, want: night.origin });
  const sangga = zones.find((z) => z.kind === 'sangga');
  if (sangga) out.push({ kind: 'sangga', name: sangga.name, want: { x: -760, z: -360 } });
  return out;
}

function streetLook(road: Road, t: number, reverse: boolean): Pose {
  const from = reverse ? road.b : road.a;
  const to = reverse ? road.a : road.b;
  const len = Math.hypot(to.x - from.x, to.z - from.z);
  const ux = (to.x - from.x) / len;
  const uz = (to.z - from.z) / len;
  // Keep 160 m of road ahead of the camera.
  const s = Math.min(reverse ? 1 - t : t, 1 - 160 / len) * len;
  const px = from.x + ux * s;
  const pz = from.z + uz * s;
  const tx = px + ux * 140;
  const tz = pz + uz * 140;
  return {
    position: [px, surfaceHeight(px, pz) + 5, pz],
    target: [tx, surfaceHeight(tx, tz) + 1, tz],
  };
}

const MIN_DROP = Math.tan(Math.PI / 2 - CAMERA_LIMITS.maxPolarAngle) * 1.1;

/** Inside maxPolarAngle (with margin) and no terrain crest hides the target. */
function streetViewClear({ position: p, target: t }: Pose): boolean {
  if (p[1] - t[1] < Math.hypot(t[0] - p[0], t[2] - p[2]) * MIN_DROP) return false;
  for (let i = 1; i < 20; i++) {
    const f = i / 20;
    const y = p[1] + (t[1] - p[1]) * f;
    if (surfaceHeight(p[0] + (t[0] - p[0]) * f, p[2] + (t[2] - p[2]) * f) > y - 0.5) return false;
  }
  return true;
}

/**
 * Eye-level shot on the center line of an `anchor.kind` street: the nearest street to
 * `anchor.want` whose view (either direction) is clear of hills.
 */
export function streetPose(roads: readonly Road[], anchor: StreetAnchor): Pose | null {
  const { want } = anchor;
  const candidates: { road: Road; t: number; d: number }[] = [];
  for (const road of roads) {
    if (road.district !== anchor.kind || road.kind !== 'street') continue;
    const dx = road.b.x - road.a.x;
    const dz = road.b.z - road.a.z;
    const len2 = dx * dx + dz * dz;
    if (Math.sqrt(len2) <= 300) continue;
    const t = Math.min(
      1,
      Math.max(0, ((want.x - road.a.x) * dx + (want.z - road.a.z) * dz) / len2),
    );
    const d = Math.hypot(road.a.x + dx * t - want.x, road.a.z + dz * t - want.z);
    candidates.push({ road, t, d });
  }
  candidates.sort((x, y) => x.d - y.d);
  for (const { road, t } of candidates) {
    for (const reverse of [false, true]) {
      const pose = streetLook(road, t, reverse);
      if (streetViewClear(pose)) return pose;
    }
  }
  return null;
}

let streetCache: { pose: Pose; name: string } | null | undefined;

/** First anchor with a clear street view, or null (the preset then uses STREET_FALLBACK). */
export function streetPreset(): { pose: Pose; name: string } | null {
  if (streetCache === undefined) {
    streetCache = null;
    for (const anchor of streetAnchors(LAYOUT.districts)) {
      const pose = streetPose(LAYOUT.roads, anchor);
      if (pose) {
        streetCache = { pose, name: anchor.name };
        break;
      }
    }
  }
  return streetCache;
}

/**
 * Offsets from SKYLINE_PEAK, kept above the terrain; on layout v2 these reproduce
 * ART_DIRECTION 8.4 exactly.
 */
const fromPeak = (position: Tuple, target: Tuple): Pose => {
  const { x, z } = SKYLINE_PEAK;
  const px = x + position[0];
  const pz = z + position[2];
  const tx = x + target[0];
  const tz = z + target[2];
  return {
    position: [px, Math.max(position[1], surfaceHeight(px, pz) + 5), pz],
    target: [tx, Math.max(target[1], surfaceHeight(tx, tz) + 1), tz],
  };
};

export const CAMERA_PRESETS = {
  /** ART_DIRECTION 8.4 preset 2 (코어 상공). */
  overview: fromPeak([580, 420, 760], [20, 120, 20]),
  /** Computed lazily from the layout on first access; falls back to STREET_FALLBACK. */
  get street(): Pose {
    return streetPreset()?.pose ?? STREET_FALLBACK;
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
