// Shared, deterministic city layout (layout v2). Every module reads from here so that
// terrain, buildings, infra, neon and the camera all agree. Units: 1 = 1 m.
// Coordinates: Y up, ground y = 0, north = -Z, east = +X, map centered at the origin.
// Data types: ./types.ts. Generation: ./generate.ts. Pure queries: ./queries.ts.
import { MAP_HALF } from './districts';
import { EXTENT, generateLayout } from './generate';
import { HASH_CELL } from './spatial';
import type { Layout } from './types';

export const CITY = {
  /** Play area edge length (m); the map spans [-half, half] on X and Z. */
  extent: EXTENT,
  half: MAP_HALF,
  /** Default layout seed. */
  seed: 2077,
  /** Spatial hash cell used by layout queries (m). */
  hashCell: HASH_CELL,
  /** Suggested chunk size for merged geometry / LOD (ART_DIRECTION 4.4). */
  chunkSize: 256,
} as const;

export const LAYOUT: Layout = generateLayout(CITY.seed);

export * from './types';
export { generateLayout, SKYLINE_PEAK, MEGA_MIN_H, RIVER_CLEARANCE } from './generate';
export { ZONES, zoneAt, zoneById, districtAt, bandEdgeZ, RIVERSIDE_HALF } from './districts';
export {
  RIVER,
  TERRAIN,
  riverZ,
  riverFrame,
  riverCenterDistance,
  riverSignedDistance,
  isNorthOfRiver,
  terrainHeight,
  surfaceHeight,
} from './river';
export { RING, ringDeckY, highwayCurve, highwaySamples, onBridge } from './highways';
export {
  buildingsInAabb,
  buildingContaining,
  raycastBuildings,
  buildingFaces,
  buildingTop,
  allTiers,
  deckHeightAt,
  ridgeHeight,
  ridgePoint,
  type Vec3Like,
} from './queries';
export { toWorld, toLocal, sideNormal } from './math';
export { CORPS } from './archetypes';
