import {
  LAYOUT,
  isNorthOfRiver,
  surfaceHeight,
  type DistrictZone,
  type Layout,
  type Vec3,
} from '../city/layout';
import { CAMERA_LIMITS, cameraPreset, type CameraPreset } from '../core/query';
import { cameraFloor, resolveCollision, targetFloor } from './collision';
import { clamp, fitPolar, type Pose } from './motion';

export interface RigPreset extends Pose {
  key: number;
  name: string;
}

type Tuple = readonly [number, number, number];
const v = (a: Tuple): Vec3 => ({ x: a[0], y: a[1], z: a[2] });

export function camPose(name: CameraPreset): Pose {
  const p = cameraPreset(name);
  return { position: v(p.position), target: v(p.target) };
}

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

/** SEOUL.md 6: number keys 1-8 (cameraPreset names in brackets). */
const SEOUL_PRESETS: readonly [string, CameraPreset][] = [
  ['반포대교 남단', 'banpo'],
  ['여의도 상공', 'yeouido'],
  ['남산에서', 'namsan'],
  ['테헤란로', 'teheran'],
  ['성수대교 위', 'seongsu'],
  ['잠실 스카이라인', 'jamsil'],
  ['홍대 골목', 'hongdae'],
  ['북악에서', 'bugak'],
];

function build(L: Layout): RigPreset[] {
  return SEOUL_PRESETS.map(([name, cam], i) => ({
    key: i + 1,
    name,
    ...safePose(L, camPose(cam)),
  }));
}

export interface DistrictView extends Pose {
  id: string;
  name: string;
  kind: string;
  /** North of the Han (강북) or south (강남), for grouping the zone list. */
  north: boolean;
}

/**
 * A view of each zone from its river side: target at the zone's centre lifted by a third of
 * the zone's tallest building, camera back toward the river by a distance that grows with the
 * zone's size, so the whole quarter and some water fit the frame.
 */
export function districtView(L: Layout, zone: DistrictZone): DistrictView {
  // Centre of the zone's own buildings: a polygon centroid can fall in an enclave (the palace
  // inside 종로). Parks without buildings use the outline centroid.
  const own = L.buildings.filter((b) => b.zoneId === zone.id);
  const pts = own.length >= 3 ? own : zone.polygon;
  let cx = 0;
  let cz = 0;
  for (const q of pts) {
    cx += q.x / pts.length;
    cz += q.z / pts.length;
  }
  if (own.length >= 3) {
    // Wrap-around filler zones (강북권) have their mean elsewhere: snap to their nearest building.
    const mx = cx;
    const mz = cz;
    let bestD = Infinity;
    for (const b of own) {
      const d = Math.hypot(b.x - mx, b.z - mz);
      if (d < bestD) {
        bestD = d;
        cx = b.x;
        cz = b.z;
      }
    }
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const q of zone.polygon) {
    minX = Math.min(minX, q.x);
    maxX = Math.max(maxX, q.x);
    minZ = Math.min(minZ, q.z);
    maxZ = Math.max(maxZ, q.z);
  }
  let tallest = 0;
  for (const b of L.buildings)
    if (b.zoneId === zone.id) tallest = Math.max(tallest, b.h + b.spireH);
  const north = isNorthOfRiver(cx, cz);
  // Toward the river: south for 강북 zones, north for 강남 zones.
  const dz = north ? 1 : -1;
  const size = Math.hypot(maxX - minX, maxZ - minZ);
  const back = clamp(size * 0.55, 260, 1100);
  const ty = surfaceHeight(cx, cz) + tallest / 3;
  const pose: Pose = {
    position: { x: cx, y: ty + back * 0.55 + tallest * 0.4, z: cz + dz * back },
    target: { x: cx, y: ty, z: cz },
  };
  // A hill between camera and zone (Namsan in front of 종로): climb until the view clears it.
  for (let i = 0; i < 20 && !terrainClear(pose); i++) pose.position.y += 40;
  return { id: zone.id, name: zone.name, kind: zone.kind, north, ...safePose(L, pose) };
}

/** True when no terrain rises within 3 m of the straight sight line from camera to target. */
export function terrainClear({ position: p, target: t }: Pose): boolean {
  for (let i = 1; i < 32; i++) {
    const f = i / 32;
    const y = p.y + (t.y - p.y) * f;
    if (surfaceHeight(p.x + (t.x - p.x) * f, p.z + (t.z - p.z) * f) > y - 3) return false;
  }
  return true;
}

let districtCache: DistrictView[] | null = null;

/** One view per named zone (the riverside band is reached through the bridge presets). */
/** Zone kinds that stand out (chips, minimap): the quarters most visitors look for first. */
export const MAJOR_KINDS: ReadonlySet<string> = new Set([
  'megacore',
  'corridor',
  'nightlife',
  'brick',
  'oldtown',
]);

export function districtViews(): readonly DistrictView[] {
  // Fill zones (강북권/강남권) are generic padding, not places anyone looks for. West to east.
  districtCache ??= LAYOUT.districts
    .filter((z) => z.kind !== 'riverside' && !z.id.startsWith('fill'))
    .map((z) => districtView(LAYOUT, z))
    .sort((a, b) => a.target.x - b.target.x);
  return districtCache;
}

export function districtViewById(id: string): DistrictView | undefined {
  return districtViews().find((d) => d.id === id);
}

let cache: RigPreset[] | null = null;
export function rigPresets(): readonly RigPreset[] {
  cache ??= build(LAYOUT);
  return cache;
}

export function rigPreset(key: number): RigPreset {
  const list = rigPresets();
  return list[clamp(Math.round(key), 1, list.length) - 1] as RigPreset;
}

/** SEOUL.md 6: 1 -> 3 -> 2 -> 7 -> 8 -> 4 -> 5 -> 6 -> 1. */
export const CINEMATIC_ORDER = [1, 3, 2, 7, 8, 4, 5, 6] as const;

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
