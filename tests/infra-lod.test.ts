import { describe, expect, it } from 'vitest';
import { BRIDGE_LOD_FAR, BRIDGE_LOD_NEAR, bridgeDetailOn } from '../src/infra/lod';

const at = (d: number) => d * d;

describe('infra: bridge detail LOD', () => {
  it('turns detail off past BRIDGE_LOD_FAR and back on inside BRIDGE_LOD_NEAR', () => {
    expect(BRIDGE_LOD_FAR / BRIDGE_LOD_NEAR).toBeCloseTo(1.1, 9);
    expect(bridgeDetailOn(true, at(BRIDGE_LOD_FAR - 1))).toBe(true);
    expect(bridgeDetailOn(true, at(BRIDGE_LOD_FAR + 1))).toBe(false);
    expect(bridgeDetailOn(false, at(BRIDGE_LOD_NEAR + 1))).toBe(false);
    expect(bridgeDetailOn(false, at(BRIDGE_LOD_NEAR - 1))).toBe(true);
  });

  it('holds its state inside the hysteresis band, so a parked camera does not flicker', () => {
    const mid = at((BRIDGE_LOD_NEAR + BRIDGE_LOD_FAR) / 2);
    let on = true;
    for (let i = 0; i < 5; i++) on = bridgeDetailOn(on, mid);
    expect(on).toBe(true);
    on = false;
    for (let i = 0; i < 5; i++) on = bridgeDetailOn(on, mid);
    expect(on).toBe(false);
  });
});
