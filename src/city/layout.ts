// Shared, deterministic city layout (layout v3, docs/SEOUL.md). Every module reads from here so that
// terrain, buildings, infra, neon and the camera all agree. Units: 1 = 1 m.
// Coordinates: Y up, ground y = 0, north = -Z, east = +X, map centered at the origin.
// Data types: ./types.ts. Generation: ./generate.ts. Pure queries: ./queries.ts.
import { EXTENT_X, EXTENT_Z, HALF_X, HALF_Z } from './constants';
import { HASH_CELL } from './spatial';
import { CITY_SEED } from './seed';
import type { Layout } from './types';

export const CITY = {
  /** The map spans x ±halfX, z ±halfZ. */
  extentX: EXTENT_X,
  extentZ: EXTENT_Z,
  halfX: HALF_X,
  halfZ: HALF_Z,
  seed: CITY_SEED,
  /** Spatial hash cell used by layout queries (m). */
  hashCell: HASH_CELL,
  /** Suggested chunk size for merged geometry / LOD (ART_DIRECTION 4.4). */
  chunkSize: 400,
} as const;

/**
 * The city layout, published once by `setLayout` before any other app module is evaluated:
 * src/boot.ts generates it in the city worker (or on the main thread as a fallback) and imports
 * the app afterwards; tests publish it in tests/setup-layout.ts.
 */
export let LAYOUT: Layout;

export function setLayout(layout: Layout): void {
  LAYOUT = layout;
}

export * from './types';
export { SKYLINE_PEAK, MEGA_MIN_H, RIVER_CLEARANCE, EXTENT_X, EXTENT_Z } from './constants';
export {
  ZONES,
  zoneAt,
  zoneById,
  zoneSide,
  districtAt,
  bandEdgeZ,
  riversideHalfAt,
  TEHERAN,
} from './districts';
export { baseKind, baseKindOf, isUnbuilt, type BaseKind } from './kinds';
export {
  RIVER,
  EMBANK_SLOPE,
  TERRAIN,
  HALF_X,
  HALF_Z,
  ISLANDS,
  MOUNTAINS,
  MOUNTAIN_RANGES,
  SAETGANG,
  riverZ,
  riverFrame,
  riverOffset,
  riverWidthAt,
  parkWidthAt,
  waterSignedDistance,
  islandAt,
  isForest,
  terrainSlope,
  FOREST_SLOPE,
  FOREST_LINE,
  TALL_GROUND,
  TALL_H,
  PALACE_RECT,
  riverCenterDistance,
  riverSignedDistance,
  isNorthOfRiver,
  terrainHeight,
  surfaceHeight,
} from './river';
export {
  highwayCurve,
  highwaySamples,
  onBridge,
  bridgeDeckY,
  BRIDGE_RAMP_NORTH,
  BRIDGE_RAMP_SOUTH_MIN,
  MAX_DECK_THICKNESS,
  MIN_ROAD_CLEARANCE,
  GANGBYEON_OFFSET,
  GANGBYEON_Y,
  OLYMPIC_OFFSET,
} from './highways';
export {
  buildingsInAabb,
  buildingContaining,
  raycastBuildings,
  buildingFaces,
  buildingTop,
  allTiers,
  buildingVolumes,
  deckHeightAt,
  ridgeHeight,
  ridgePoint,
  type Vec3Like,
} from './queries';
export { toWorld, toLocal, sideNormal } from './math';
export { CORPS } from './archetypes';
export {
  PALACE_BUILDINGS,
  PALACE_AXIS,
  PALACE_AXIS_X,
  palaceCenter,
  PALACE_GATE_HALF,
  palaceWallAt,
  palaceWallDistance,
} from './palace';
