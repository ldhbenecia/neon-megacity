// Bridge detail LOD (hangang-perf, PERF.md): camera distance to the span center on the deck (3D,
// so a high orbit or topdown view over a bridge drops its sub-pixel rails and paint).
// 10 % hysteresis like buildings LOD_HYSTERESIS, so a camera parked at the edge does not flicker.
import type { Quality } from '../core/types';

/** Detail turns back on closer than this (m), quality 'high'. */
export const BRIDGE_LOD_NEAR = 600;
/** Detail turns off farther than this (m), quality 'high'. */
export const BRIDGE_LOD_FAR = 660;

/**
 * Detail switch-on distance by user tier (m), PERF.md quality knobs. 'low' keeps the built detail
 * hidden; 'ci' never builds it.
 */
export const BRIDGE_LOD_NEAR_BY_QUALITY: Readonly<Record<Quality, number>> = {
  high: BRIDGE_LOD_NEAR,
  medium: 400,
  low: 0,
  ci: 0,
};

const HYSTERESIS = BRIDGE_LOD_FAR / BRIDGE_LOD_NEAR;

/** Squared on / off distances for a tier, or null when the tier shows no detail. */
export interface BridgeLodRange {
  near2: number;
  far2: number;
}

export function bridgeLodRange(q: Quality): BridgeLodRange | null {
  const near = BRIDGE_LOD_NEAR_BY_QUALITY[q];
  if (near <= 0) return null;
  const far = near * HYSTERESIS;
  return { near2: near * near, far2: far * far };
}

const HIGH = bridgeLodRange('high') as BridgeLodRange;

/** Next detail state of a bridge whose center is `d2` (squared metres) away. */
export function bridgeDetailOn(on: boolean, d2: number, range: BridgeLodRange = HIGH): boolean {
  return d2 < (on ? range.far2 : range.near2);
}
