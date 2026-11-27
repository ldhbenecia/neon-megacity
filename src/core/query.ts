// URL query hooks for deterministic screenshots and debugging.
//   ?time=0..1   fixed time of day (pauses the cycle)
//   ?cam=<name>  preset camera pose
//   ?rain=0..1   initial rain intensity
//   ?nogui       hide the lil-gui panel
//   ?quality=high|medium|low|ci  render tier (ci: software GL test tier, see Quality)

import {
  CITY,
  LAYOUT,
  surfaceHeight,
  type DistrictZone,
  type LandmarkId,
  type Road,
  type Vec2,
} from '../city/layout';
import { closestSegmentT, pointSegmentDistance } from '../city/math';
import type { Quality } from './types';

type Tuple = readonly [number, number, number];

export interface CameraPose {
  readonly position: Tuple;
  readonly target: Tuple;
}
type Pose = CameraPose;

/** Map-relative presets: the same framing whichever layout version is loaded. */
const TOPDOWN_Y = Math.max(CITY.extentX, CITY.extentZ) / 2 + 700;
/** Polar margin every preset keeps under maxPolarAngle (rad), shared with ux `fitPolar`. */
export const POLAR_MARGIN = 0.01;

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

/** Used when no clear nightlife or sangga street exists: the SEOUL.md 6 홍대 draft. */
export const STREET_FALLBACK: CameraPose = { position: [-985, 4, -470], target: [-940, 2, -520] };

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

const MIN_DROP = Math.tan(Math.PI / 2 - CAMERA_LIMITS.maxPolarAngle + POLAR_MARGIN);

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
    if (Math.hypot(road.b.x - road.a.x, road.b.z - road.a.z) <= 300) continue;
    const t = closestSegmentT(want, road.a, road.b);
    candidates.push({ road, t, d: pointSegmentDistance(want, road.a, road.b) });
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

function findStreet(): { pose: Pose; anchor: StreetAnchor } | null {
  for (const anchor of streetAnchors(LAYOUT.districts)) {
    const pose = streetPose(LAYOUT.roads, anchor);
    if (pose) return { pose, anchor };
  }
  return null;
}

let streetCache: { pose: Pose; anchor: StreetAnchor } | null | undefined;

/** First anchor with a clear street view, or null (the preset then uses STREET_FALLBACK). */
export function streetPreset(): { pose: Pose; anchor: StreetAnchor } | null {
  if (streetCache === undefined) streetCache = findStreet();
  return streetCache;
}

const lifted = (x: number, y: number, z: number, clear: number): [number, number, number] => [
  x,
  Math.max(y, surfaceHeight(x, z) + clear),
  z,
];

/** Lowers the target just enough that the view keeps POLAR_MARGIN under maxPolarAngle. */
function levelFit(pose: Pose): Pose {
  const [px, py, pz] = pose.position;
  const [tx, ty, tz] = pose.target;
  const horiz = Math.hypot(tx - px, tz - pz);
  const maxY = py - horiz * MIN_DROP;
  return ty <= maxY ? pose : { position: pose.position, target: [tx, maxY, tz] };
}

/** Pose kept above the terrain (camera 5 m, target 1 m) and inside the polar limit. */
const pose = (p: Tuple, t: Tuple): Pose =>
  levelFit({
    position: lifted(p[0], p[1], p[2], 5),
    target: lifted(t[0], t[1], t[2], 1),
  });

/** Landmark footprint centre at height `y`, or the SEOUL.md 6 draft target when it is missing. */
function landmarkAt(id: LandmarkId, y: number, draft: Tuple): Tuple {
  const l = LAYOUT.landmarks.find((m) => m.id === id);
  return l ? [l.x, y, l.z] : draft;
}

/** Above the traffic on a named road's centre line, 8 % along it, looking 250 m down the road. */
function roadPose(id: string, draft: Pose): Pose {
  const r = LAYOUT.namedRoads.find((n) => n.id === id);
  const a = r?.points[0];
  const b = r?.points[1];
  if (!a || !b) return draft;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (b.x - a.x) / len;
  const uz = (b.z - a.z) / len;
  const px = a.x + ux * len * 0.08;
  const pz = a.z + uz * len * 0.08;
  const tx = px + ux * 250;
  const tz = pz + uz * 250;
  return levelFit({
    position: [px, surfaceHeight(px, pz) + 9, pz],
    target: [tx, surfaceHeight(tx, tz) + 3, tz],
  });
}

/** Above a bridge's centre (clear of the truss), looking at `target`. */
function bridgePose(id: string, target: Tuple, draft: Pose): Pose {
  const br = LAYOUT.bridges.find((b) => b.id === id);
  if (!br) return draft;
  const x = (br.a.x + br.b.x) / 2;
  const z = (br.a.z + br.b.z) / 2;
  return levelFit({ position: [x, br.deckY + 20, z], target });
}

/**
 * SEOUL.md 6 viewpoints, keyed by `?cam=` name. Targets follow `LAYOUT.landmarks`, named roads
 * and bridges so a layout tweak keeps the framing; the drafts are fallbacks only.
 */
const SEOUL_POSES = {
  banpo: pose([215, 18, 470], [0, 10, 0]),
  yeouido: pose([-620, 260, 0], landmarkAt('yeouido-gold', 140, [-980, 140, 220])),
  namsan: pose([-150, 240, -360], [-600, 60, 100]),
  teheran: roadPose('rd-teheran', pose([600, 6, 580], [900, 3, 455])),
  seongsu: bridgePose('br-seongsu', [1600, 10, 120], pose([660, 17, -120], [1600, 10, 120])),
  jamsil: pose([1250, 70, -260], landmarkAt('jamsil-blade', 50, [1650, 50, 300])),
  bugak: pose([-200, 240, -1170], [-150, 60, -500]),
  overview: pose([1800, 900, 1500], [0, 80, -100]),
  topdown: { position: [0, TOPDOWN_Y, 1], target: [0, 0, 0] },
} as const satisfies Record<string, Pose>;

export const CAMERA_PRESETS = {
  ...SEOUL_POSES,
  /** 홍대 alley: the nearest clear nightlife street (see `streetPreset`). */
  get hongdae(): Pose {
    return streetPreset()?.pose ?? STREET_FALLBACK;
  },
  /** Aliases kept for e2e, screenshots and old links. */
  get skyline(): Pose {
    return SEOUL_POSES.banpo;
  },
  get core(): Pose {
    return SEOUL_POSES.yeouido;
  },
  get street(): Pose {
    return CAMERA_PRESETS.hongdae;
  },
} as const satisfies Record<string, Pose>;

export type CameraPreset = keyof typeof CAMERA_PRESETS;

/** Pose of a named preset (preferred accessor). */
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
  if (quality === 'high' || quality === 'medium' || quality === 'low' || quality === 'ci') {
    opts.quality = quality;
  }
  return opts;
}
