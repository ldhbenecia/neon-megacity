// Plain layout constants the app reads at startup. Values only (no three, no rng), so importing
// them does not pull the layout generator into the first-load bundle (the city worker runs it).
import type { Vec2 } from './types';

/** Map half extents (m). The map spans x ±HALF_X, z ±HALF_Z. */
export const HALF_X = 2000;
export const HALF_Z = 1300;
export const EXTENT_X = HALF_X * 2;
export const EXTENT_Z = HALF_Z * 2;
/** Skyline peak: the 용산 apex, the tallest tower of the city (SEOUL.md 4.5). */
export const SKYLINE_PEAK: Vec2 = { x: -380, z: -80 };
/** Megatower threshold. */
export const MEGA_MIN_H = 250;
/** Clear distance (m) buildings keep from the river channel edge. */
export const RIVER_CLEARANCE = 5;

/** Sidewalk width (m) by district kind. */
export const SIDEWALK: Record<string, number> = {
  core: 4,
  midtown: 4,
  sangga: 2,
  hillside: 1,
  apartment: 6,
  industrial: 4,
  megacore: 5,
  corridor: 4,
  oldtown: 2,
  palace: 10,
  brick: 2,
  nightlife: 1.5,
  showroom: 4,
};
