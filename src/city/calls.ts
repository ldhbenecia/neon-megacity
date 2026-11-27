/**
 * Call counters for the expensive layout queries. Tests bound them per generateLayout run so a
 * change that multiplies generation time shows up without timing on a shared machine.
 */
export const CALLS = { terrainHeight: 0, surfaceHeight: 0, zoneExact: 0 };

export function resetCalls(): void {
  CALLS.terrainHeight = 0;
  CALLS.surfaceHeight = 0;
  CALLS.zoneExact = 0;
}
