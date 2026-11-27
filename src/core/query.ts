// URL query hooks for deterministic screenshots and debugging.
//   ?time=0..1   fixed time of day (pauses the cycle)
//   ?cam=<name>  preset camera pose
//   ?rain=0..1   initial rain intensity
//   ?nogui       hide the lil-gui panel
//   ?quality=high|medium|low|ci  render tier (ci: software GL test tier, see Quality)

import {
  CITY,
  LAYOUT,
  buildingContaining,
  riverWidthAt,
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
 * maxDistance lets the whole map fit the 55 deg view: the sphere around the map's half-diagonal
 * spans the vertical field of view, with 10 % to spare (v3 ~5700 m). Zoom-out scales around the
 * orbit target, and the camera itself stays inside cameraRing() (see below).
 */
export const CAMERA_FOV = 55;
const FIT_DISTANCE = Math.ceil(
  (Math.hypot(CITY.extentX, CITY.extentZ) / 2 / Math.sin(((CAMERA_FOV / 2) * Math.PI) / 180)) * 1.1,
);
export const CAMERA_LIMITS = {
  minDistance: 20,
  maxDistance: Math.max(FIT_DISTANCE, TOPDOWN_Y + 700),
  maxPolarAngle: Math.PI * 0.495,
} as const;

// Everything below that reads LAYOUT is computed on first use, never at module evaluation: the
// async boot evaluates app modules while the layout is still being generated in a Worker.

/**
 * The camera stays this far (horizontally) from the map centre: inside the nearest ridge ring and
 * the ground disc, so their edges never stand between the camera and the city. A low zoom-out
 * therefore stops at the ring; looking down, the full maxDistance is reachable.
 */
export function cameraRing(): number {
  return Math.min(...LAYOUT.ridges.map((r) => r.radius)) - 150;
}

/** Far plane: the farthest ridge seen from the zoom-out limit across the map. */
export function cameraFar(): number {
  return CAMERA_LIMITS.maxDistance + Math.max(...LAYOUT.ridges.map((r) => r.radius)) + 500;
}

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
  // A little over head height, so both rows of shop signs recede along the street.
  return {
    position: [px, surfaceHeight(px, pz) + STREET_EYE, pz],
    target: [tx, surfaceHeight(tx, tz) + 2, tz],
  };
}

const STREET_EYE = 8;

/**
 * Buildings fronting the first 140 m of the view, counted on the side with fewer: a street lined
 * on both sides reads as an alley, one with a gap on one side reads as an open lot.
 */
export function streetFrontage({ position: p, target: t }: Pose): number {
  const dx = t[0] - p[0];
  const dz = t[2] - p[2];
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  let left = 0;
  let right = 0;
  for (const b of LAYOUT.buildings) {
    const rx = b.x - p[0];
    const rz = b.z - p[2];
    const along = rx * ux + rz * uz;
    if (along < 10 || along > 140) continue;
    const across = rx * uz - rz * ux;
    if (Math.abs(across) > 30) continue;
    if (across > 0) right++;
    else left++;
  }
  return Math.min(left, right);
}

const MIN_DROP = Math.tan(Math.PI / 2 - CAMERA_LIMITS.maxPolarAngle + POLAR_MARGIN);

/** Inside maxPolarAngle (with margin), level enough to read as a street, no crest hides it. */
function streetViewClear({ position: p, target: t }: Pose, strict = true): boolean {
  if (p[1] - t[1] < Math.hypot(t[0] - p[0], t[2] - p[2]) * MIN_DROP) return false;
  if (!strict) return terrainClear(p, t);
  // A street dropping away down a slope fills the lower frame with dark roofs.
  if (Math.abs(p[1] - STREET_EYE - (t[1] - 2)) > 4) return false;
  // Nothing built over the first 80 m of the street below eye height (a roof or a deck right in
  // front of the lens fills the lower half of the frame).
  const dx = t[0] - p[0];
  const dz = t[2] - p[2];
  const len = Math.hypot(dx, dz);
  for (let d = 4; d <= 80; d += 4) {
    const x = p[0] + (dx / len) * d;
    const z = p[2] + (dz / len) * d;
    const ground = surfaceHeight(x, z);
    // The street ahead stays level with the camera's own ground (a rise reads as a dark wall), and
    // at road level: where the terrain lies above the flat road mesh it covers the street.
    if (Math.abs(ground - (p[1] - STREET_EYE)) > 2 || ground > 0.3) return false;
    for (let y = ground + 1; y < p[1]; y += 2) {
      if (buildingContaining(LAYOUT, x, y, z) !== null) return false;
    }
  }
  return terrainClear(p, t);
}

/** No terrain crest between the eye and the target. */
function terrainClear(p: Tuple, t: Tuple): boolean {
  for (let i = 1; i < 20; i++) {
    const f = i / 20;
    const y = p[1] + (t[1] - p[1]) * f;
    if (surfaceHeight(p[0] + (t[0] - p[0]) * f, p[2] + (t[2] - p[2]) * f) > y - 0.5) return false;
  }
  return true;
}

/**
 * Shot along the center line of an `anchor.kind` street: among the streets near `anchor.want`
 * whose view (either direction) is clear of hills, the one lined best on both sides.
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
  // The anchor's quarter only: the best-lined level street there, else the nearest clear one.
  const near = (q: Pose): boolean =>
    Math.hypot(q.position[0] - want.x, q.position[2] - want.z) < STREET_REACH;
  let best: { pose: Pose; score: number } | null = null;
  for (const { road, t } of candidates.slice(0, 8)) {
    for (const reverse of [false, true]) {
      const pose = streetLook(road, t, reverse);
      if (!near(pose) || !streetViewClear(pose)) continue;
      const score = streetFrontage(pose);
      if (!best || score > best.score) best = { pose, score };
    }
  }
  if (best) return best.pose;
  for (const { road, t } of candidates) {
    for (const reverse of [false, true]) {
      const pose = streetLook(road, t, reverse);
      if (streetViewClear(pose, false)) return pose;
    }
  }
  return null;
}

const STREET_REACH = 380;

function findStreet(): { pose: Pose; anchor: StreetAnchor } | null {
  for (const anchor of streetAnchors(LAYOUT.districts)) {
    const pose = streetPose(LAYOUT.roads, anchor);
    if (pose) return { pose, anchor };
  }
  return null;
}

let streetCache: { pose: Pose; anchor: StreetAnchor } | null | undefined;

/** First anchor with a clear street view, or null (the preset then uses streetFallback()). */
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

const landmark = (id: LandmarkId): Vec2 => {
  const l = LAYOUT.landmarks.find((m) => m.id === id);
  if (!l) throw new Error(`layout has no landmark ${id}`);
  return { x: l.x, z: l.z };
};

const mountain = (id: string): Vec2 => {
  const m = LAYOUT.mountains.find((q) => q.id === id);
  if (!m) throw new Error(`layout has no mountain ${id}`);
  return m.peak;
};

const bridge = (id: string): (typeof LAYOUT.bridges)[number] => {
  const br = LAYOUT.bridges.find((q) => q.id === id);
  if (!br) throw new Error(`layout has no bridge ${id}`);
  return br;
};

/**
 * Trees and buildings standing in the near part of the view (closer than 60 m, within 40 degrees
 * of the line of sight): at that range a tree crown or a corner fills a quarter of the frame.
 */
export function nearBlockers({ position: p, target: t }: Pose): number {
  const dx = t[0] - p[0];
  const dz = t[2] - p[2];
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const cos = Math.cos((40 * Math.PI) / 180);
  let n = 0;
  for (const s of LAYOUT.slots) {
    if (s.kind !== 'tree') continue;
    const rx = s.x - p[0];
    const rz = s.z - p[2];
    const d = Math.hypot(rx, rz);
    if (d < 60 && d > 0 && (rx * ux + rz * uz) / d > cos) n++;
  }
  for (let i = 1; i <= 12; i++) {
    const f = (i * 5) / len;
    const y = p[1] + (t[1] - p[1]) * f;
    if (buildingContaining(LAYOUT, p[0] + dx * f, y, p[2] + dz * f) !== null) n++;
  }
  return n;
}

/**
 * Above the traffic on a named road's centre line, looking 250 m down the road: the first spot
 * from 8 % along with no tree or building close in front of the lens.
 */
function roadPose(id: string): Pose {
  const r = LAYOUT.namedRoads.find((n) => n.id === id);
  const a = r?.points[0];
  const b = r?.points[1];
  const len = a && b ? Math.hypot(b.x - a.x, b.z - a.z) : 0;
  if (!a || !b || len < 1) throw new Error(`layout has no usable road ${id}`);
  const ux = (b.x - a.x) / len;
  const uz = (b.z - a.z) / len;
  const at = (f: number): Pose => {
    const px = a.x + ux * len * f;
    const pz = a.z + uz * len * f;
    const tx = px + ux * 250;
    const tz = pz + uz * 250;
    return levelFit({
      position: [px, surfaceHeight(px, pz) + 9, pz],
      target: [tx, surfaceHeight(tx, tz) + 3, tz],
    });
  };
  for (let f = 0.08; f < 0.4; f += 0.01) {
    const p = at(f);
    if (nearBlockers(p) === 0) return p;
  }
  return at(0.08);
}

/**
 * Slope from the eye to the top edge of the frame when the camera looks as level as the polar
 * limit allows, with about 3 degrees of headroom.
 */
const TOP_SLOPE = Math.tan(((CAMERA_FOV / 2 - 3) * Math.PI) / 180 - Math.atan(MIN_DROP));

/** Line from the eye to half the hero's height passes no other building. */
function heroInSight(
  e: Tuple,
  hero: { x: number; z: number; h: number; id: number | null },
): boolean {
  for (let i = 1; i < 40; i++) {
    const f = i / 40;
    const x = e[0] + (hero.x - e[0]) * f;
    const z = e[2] + (hero.z - e[2]) * f;
    const y = e[1] + (hero.h * 0.5 - e[1]) * f;
    const id = buildingContaining(LAYOUT, x, y, z);
    if (id !== null && id !== hero.id) return false;
  }
  return true;
}

/**
 * A point over the Han from which the whole landmark tower fits the frame (top included) with
 * nothing standing in front of it: the open water the tower rises behind, nearest to `near`.
 */
function overWaterView(id: LandmarkId, near: Vec2, eye: number, fallback: Pose): Pose {
  const l = LAYOUT.landmarks.find((m) => m.id === id);
  if (!l) throw new Error(`layout has no landmark ${id}`);
  const need = (l.h - eye) / TOP_SLOPE;
  const pts = LAYOUT.river.samples;
  let best: { e: Tuple; d: number } | null = null;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1] as Vec2;
    const c = pts[i] as Vec2;
    const b = pts[i + 1] as Vec2;
    const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / tl;
    const nz = (b.x - a.x) / tl;
    const w = riverWidthAt(c.x);
    for (const k of [-0.3, -0.15, 0, 0.15, 0.3]) {
      const x = c.x + nx * w * k;
      const z = c.z + nz * w * k;
      const d = Math.hypot(x - l.x, z - l.z);
      if (d < need || d > need + 700) continue;
      const e: Tuple = [x, Math.max(eye, surfaceHeight(x, z) + 5), z];
      const score = Math.hypot(x - near.x, z - near.z);
      if (best && score >= best.d) continue;
      if (!heroInSight(e, { x: l.x, z: l.z, h: l.h, id: l.buildingId })) continue;
      best = { e, d: score };
    }
  }
  // A layout without such a spot keeps the old fixed framing rather than failing every preset.
  if (!best) return fallback;
  return pose(best.e, [l.x, best.e[1], l.z]);
}

/**
 * SEOUL.md 6 viewpoints, keyed by `?cam=` name, all derived from layout features (bridges,
 * landmarks, mountain peaks, named roads, map extents) so the framing follows layout changes.
 * Heights over hills are terrain-relative, so lower mountains move the cameras with them.
 */
const SEOUL_KEYS = [
  'banpo',
  'yeouido',
  'namsan',
  'teheran',
  'seongsu',
  'jamsil',
  'bugak',
  'overview',
  'topdown',
] as const;
type SeoulKey = (typeof SEOUL_KEYS)[number];

function seoulPoses(): Record<SeoulKey, Pose> {
  const banpo = bridge('br-banpo');
  // South abutment (b) plus 20 m down the span, looking back across to the north landing.
  const bu = Math.hypot(banpo.b.x - banpo.a.x, banpo.b.z - banpo.a.z);
  const bx = banpo.b.x + ((banpo.b.x - banpo.a.x) / bu) * 20;
  const bz = banpo.b.z + ((banpo.b.z - banpo.a.z) / bu) * 20;
  const mast = landmark('namsan-mast');
  const apex = landmark('yongsan-apex');
  const gold = landmark('yeouido-gold');
  const blade = landmark('jamsil-blade');
  const bugak = mountain('bugak');
  const seongsu = bridge('br-seongsu');
  const sx = (seongsu.a.x + seongsu.b.x) / 2;
  const sz = (seongsu.a.z + seongsu.b.z) / 2;
  return {
    // Off the south end of the bridge over the water, far enough back for the Yongsan tower's top.
    banpo: overWaterView(
      'yongsan-apex',
      { x: bx, z: bz },
      70,
      pose([bx, banpo.deckY + 22, bz], [banpo.landA.x, 10, banpo.landA.z]),
    ),
    // Over the river east of the island, looking down at the cluster around the gold tower.
    yeouido: pose([gold.x + 510, 260, gold.z - 120], [gold.x, 140, gold.z]),
    // Just off the summit, over Yongsan's towers toward Yeouido and the river bend.
    namsan: pose(
      [mast.x + 26, surfaceHeight(mast.x + 26, mast.z + 29) + 80, mast.z + 29],
      [(apex.x + gold.x) / 2, 60, (apex.z + gold.z) / 2],
    ),
    teheran: roadPose('rd-teheran'),
    // Above the truss at mid-span, looking upstream to the Jamsil landmark.
    seongsu: levelFit({ position: [sx, seongsu.deckY + 20, sz], target: [blade.x, 10, blade.z] }),
    jamsil: overWaterView(
      'jamsil-blade',
      { x: blade.x - 450, z: blade.z - 720 },
      70,
      pose([blade.x - 450, 70, blade.z - 720], [blade.x, 50, blade.z]),
    ),
    // From Bugak's ridge over the palace and old town to the Namsan mast.
    bugak: pose(
      [bugak.x, surfaceHeight(bugak.x, bugak.z + 10) + 40, bugak.z + 10],
      [mast.x, 60, mast.z],
    ),
    overview: pose([CITY.halfX * 0.9, 900, CITY.halfZ * 1.15], [0, 80, -CITY.halfZ * 0.08]),
    topdown: { position: [0, TOPDOWN_Y, 1], target: [0, 0, 0] },
  };
}

let seoulCache: ReturnType<typeof seoulPoses> | undefined;
const seoul = (): ReturnType<typeof seoulPoses> => (seoulCache ??= seoulPoses());

let fallbackCache: CameraPose | undefined;
/**
 * Used when no street of any anchor gives a clear view: eye level at the first anchor point
 * (홍대's grid origin), looking 70 m north-east.
 */
export function streetFallback(): CameraPose {
  if (!fallbackCache) {
    const w = streetAnchors(LAYOUT.districts)[0]?.want ?? { x: 0, z: 0 };
    fallbackCache = pose([w.x, surfaceHeight(w.x, w.z) + 4, w.z], [w.x + 45, 0, w.z - 50]);
  }
  return fallbackCache;
}

/** One lazy getter per SEOUL_KEYS entry: a viewpoint added there is reachable by `?cam=` too. */
const seoulGetters = Object.defineProperties(
  {},
  Object.fromEntries(SEOUL_KEYS.map((k) => [k, { enumerable: true, get: (): Pose => seoul()[k] }])),
) as Readonly<Record<SeoulKey, Pose>>;

export const CAMERA_PRESETS = Object.defineProperties(
  {},
  {
    ...Object.getOwnPropertyDescriptors(seoulGetters),
    ...Object.getOwnPropertyDescriptors({
      /** 홍대 alley: the nearest clear nightlife street (see `streetPreset`). */
      get hongdae(): Pose {
        return streetPreset()?.pose ?? streetFallback();
      },
      /** Aliases kept for e2e, screenshots and old links. */
      get skyline(): Pose {
        return seoul().banpo;
      },
      get core(): Pose {
        return seoul().yeouido;
      },
      get street(): Pose {
        return CAMERA_PRESETS.hongdae;
      },
    }),
  },
) as Readonly<Record<SeoulKey | 'hongdae' | 'skyline' | 'core' | 'street', Pose>>;

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
