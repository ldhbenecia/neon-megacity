import { describe, expect, it } from 'vitest';
import { BRIDGE_LOD_FAR, BRIDGE_LOD_NEAR, bridgeDetailOn, bridgeLodRange } from '../src/infra/lod';

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

  it('quality tiers: high 600 m, medium 400 m with the same hysteresis, low and ci none', () => {
    const high = bridgeLodRange('high')!;
    expect(high.near2).toBe(at(BRIDGE_LOD_NEAR));
    expect(high.far2).toBeCloseTo(at(BRIDGE_LOD_FAR), 6);
    const medium = bridgeLodRange('medium')!;
    expect(Math.sqrt(medium.near2)).toBeCloseTo(400, 9);
    expect(Math.sqrt(medium.far2)).toBeCloseTo(440, 9);
    expect(bridgeDetailOn(false, at(450), high)).toBe(true);
    expect(bridgeDetailOn(false, at(450), medium)).toBe(false);
    expect(bridgeLodRange('low')).toBeNull();
    expect(bridgeLodRange('ci')).toBeNull();
  });
});
