// v3 district kinds mapped onto the v2 kinds whose rendering rules (window light, signs, rooftop
// props) already exist, so buildings and neon can fall back on one shared table. v2 kinds map
// to themselves, which keeps the v2 city unchanged.
import type { DistrictKind } from './types';

/** v2 kinds plus the two v3 kinds that have no v2 equivalent. */
export type BaseKind =
  | 'core'
  | 'midtown'
  | 'sangga'
  | 'hillside'
  | 'apartment'
  | 'industrial'
  | 'riverside'
  | 'palace'
  | 'park';

const BASE: Record<DistrictKind, BaseKind> = {
  core: 'core',
  midtown: 'midtown',
  sangga: 'sangga',
  hillside: 'hillside',
  apartment: 'apartment',
  industrial: 'industrial',
  riverside: 'riverside',
  megacore: 'core',
  corridor: 'core',
  oldtown: 'sangga',
  brick: 'sangga',
  nightlife: 'sangga',
  showroom: 'sangga',
  palace: 'palace',
  park: 'park',
};

/** Closest v2 kind for a district kind (manager decision, SEOUL.md 7.2). */
export function baseKind(kind: DistrictKind): BaseKind {
  return BASE[kind];
}

/**
 * True for kinds without lit buildings or street signs: parks have no buildings and the palace
 * grounds keep their halls dark (only low uplights). Renderers skip window light and signs there.
 */
export function isUnbuilt(kind: DistrictKind): boolean {
  return kind === 'park' || kind === 'palace';
}
