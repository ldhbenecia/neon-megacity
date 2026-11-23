// Shared, deterministic city layout (layout v3, docs/SEOUL.md). Every module reads from here so that
// terrain, buildings, infra, neon and the camera all agree. Units: 1 = 1 m.
// Coordinates: Y up, ground y = 0, north = -Z, east = +X, map centered at the origin.
// Data types: ./types.ts. Generation: ./generate.ts. Pure queries: ./queries.ts.
import { EXTENT, EXTENT_X, EXTENT_Z, generateLayout } from './generate';
import { HALF_X, HALF_Z } from './river';
import { HASH_CELL } from './spatial';
import type { Layout } from './types';

export const CITY = {
  /** Longer side (kept for v2 callers). The map spans x ±halfX, z ±halfZ. */
  extent: EXTENT,
  extentX: EXTENT_X,
  extentZ: EXTENT_Z,
  /** max(halfX, halfZ); bounds checks should use halfX / halfZ. */
  half: Math.max(HALF_X, HALF_Z),
  halfX: HALF_X,
  halfZ: HALF_Z,
  seed: 2077,
  /** Spatial hash cell used by layout queries (m). */
  hashCell: HASH_CELL,
  /** Suggested chunk size for merged geometry / LOD (ART_DIRECTION 4.4). */
  chunkSize: 400,
} as const;

export const LAYOUT: Layout = generateLayout(CITY.seed);

export * from './types';
export {
  generateLayout,
  SKYLINE_PEAK,
  MEGA_MIN_H,
  RIVER_CLEARANCE,
  EXTENT_X,
  EXTENT_Z,
} from './generate';
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
export {
  RIVER,
  EMBANK_SLOPE,
  TERRAIN,
  HALF_X,
  HALF_Z,
  ISLANDS,
  MOUNTAINS,
  SAETGANG,
  riverZ,
  riverFrame,
  riverOffset,
  riverWidthAt,
  parkWidthAt,
  waterSignedDistance,
  islandAt,
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
  BRIDGE_LAND,
  BRIDGE_LAND_SOUTH,
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
