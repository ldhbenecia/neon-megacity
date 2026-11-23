// Bridge detail LOD (hangang-perf, PERF.md): horizontal camera distance to the span center.
// 10 % hysteresis like buildings LOD_HYSTERESIS, so a camera parked at the edge does not flicker.

/** Detail turns back on closer than this (m). */
export const BRIDGE_LOD_NEAR = 600;
/** Detail turns off farther than this (m). */
export const BRIDGE_LOD_FAR = 660;

const NEAR2 = BRIDGE_LOD_NEAR * BRIDGE_LOD_NEAR;
const FAR2 = BRIDGE_LOD_FAR * BRIDGE_LOD_FAR;

/** Next detail state of a bridge whose center is `d2` (squared horizontal metres) away. */
export function bridgeDetailOn(on: boolean, d2: number): boolean {
  return d2 < (on ? FAR2 : NEAR2);
}
