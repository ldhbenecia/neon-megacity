// v3 district kinds mapped onto the v2 kinds whose rendering rules (window light, signs, rooftop
// props) already exist, so buildings and neon can fall back on one shared table. v2 kinds map
// to themselves, which keeps the v2 city unchanged.
// Callers check isUnbuilt(kind) first, then branch on baseKind(kind): palace and park have no
// v2 rules to fall back on.
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

// The Record keeps tsc checking that every DistrictKind is listed; lookups go through the Map so
// keys like '__proto__' or 'constructor' never reach Object.prototype.
const TABLE: Record<DistrictKind, BaseKind> = {
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

const BASE = new Map<string, BaseKind>(Object.entries(TABLE));

/** Closest v2 kind for a district kind (manager decision, SEOUL.md 7.2). */
export function baseKind(kind: DistrictKind): BaseKind {
  const b = BASE.get(kind);
  if (b === undefined) throw new Error(`unknown district kind ${kind}`);
  return b;
}

/** Like baseKind for untyped input (e.g. strings from data): undefined when the kind is unknown. */
export function baseKindOf(kind: string): BaseKind | undefined {
  return BASE.get(kind);
}

/**
 * True for kinds without lit buildings or street signs: parks have no buildings and the palace
 * grounds keep their halls dark (only low uplights). Renderers skip window light and signs there.
 */
export function isUnbuilt(kind: DistrictKind): boolean {
  return kind === 'park' || kind === 'palace';
}
