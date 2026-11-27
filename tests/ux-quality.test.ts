import { describe, expect, it } from 'vitest';
import {
  QualityController,
  TUNING,
  storedTier,
  tierFromRenderer,
  type QualityChange,
} from '../src/ux/quality';

/** Feeds `seconds` of frames at `ms` each; returns every change in order. */
function run(c: QualityController, ms: number, seconds: number): NonNullable<QualityChange>[] {
  const out: NonNullable<QualityChange>[] = [];
  for (let t = 0; t < seconds; t += ms / 1000) {
    const ch = c.step(ms / 1000);
    if (ch) out.push(ch);
  }
  return out;
}

describe('tierFromRenderer', () => {
  it('maps GPU names to a starting tier and unknown names to medium', () => {
    expect(
      tierFromRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)'),
    ).toBe('high');
    expect(tierFromRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)')).toBe('high');
    expect(tierFromRenderer('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)')).toBe(
      'medium',
    );
    expect(tierFromRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))')).toBe(
      'low',
    );
    expect(tierFromRenderer('Mali-G78')).toBe('low');
    // Safari masks Apple GPUs: a Mac starts at medium, a touch device at low.
    expect(tierFromRenderer('Apple GPU')).toBe('medium');
    expect(tierFromRenderer('Apple GPU', true)).toBe('low');
    expect(tierFromRenderer('')).toBe('medium');
    expect(tierFromRenderer(null)).toBe('medium');
  });
});

describe('QualityController', () => {
  it('steps DPR down before the tier, then the tier', () => {
    const c = new QualityController('high', 2, false);
    expect(c.state).toEqual({ tier: 'high', dpr: 1.5 });
    const changes = run(c, 30, 30);
    expect(changes[0]).toMatchObject({ tier: 'high', dpr: 1.25, tierChanged: false });
    expect(changes.some((ch) => ch.tier === 'medium' && ch.tierChanged)).toBe(true);
    expect(c.state.tier).toBe('low');
    expect(c.state.dpr).toBe(0.75);
  });

  it('climbs back slowly and may pass a guessed boot tier, up to high', () => {
    const c = new QualityController('medium', 2, false);
    run(c, 30, 20);
    expect(c.state.tier).toBe('low');
    run(c, 8, 240);
    expect(c.state).toEqual({ tier: 'high', dpr: 1.5 });
  });

  it('ignores the warm-up frames, then probes', () => {
    const c = new QualityController('high', 2, false);
    expect(run(c, 40, (TUNING.skipFrames * 40) / 1000)).toEqual([]);
    expect(run(c, 40, TUNING.probeS).length).toBeGreaterThan(0);
  });

  it('blames a step up only within the undo window; later slowdowns step down without locking', () => {
    const c = new QualityController('high', 2, false);
    run(c, 30, 12);
    run(c, 8, 120);
    expect(c.state).toEqual({ tier: 'high', dpr: 1.5 });
    // Long after the last step up: a heavy scene steps down normally...
    run(c, 30, 8);
    expect(c.state.dpr).toBeLessThan(1.5);
    // ...and climbing is not locked, so a light scene brings it back.
    run(c, 8, 120);
    expect(c.state).toEqual({ tier: 'high', dpr: 1.5 });
  });

  it('does not step down for isolated spikes (median, not mean)', () => {
    const c = new QualityController('high', 2, false);
    const changes: unknown[] = [];
    for (let i = 0; i < 60 * 30; i++) {
      const ch = c.step(i % 10 === 9 ? 0.2 : 1 / 60);
      if (ch) changes.push(ch);
    }
    expect(changes).toEqual([]);
    expect(c.state).toEqual({ tier: 'high', dpr: 1.5 });
  });

  it('reset returns to the boot tier at full DPR', () => {
    const c = new QualityController('high', 2, false);
    run(c, 30, 15);
    expect(c.reset()).toMatchObject({ tier: 'high', dpr: 1.5 });
  });

  it('climbs back on a 60 Hz display, where frames never go below 16.7 ms', () => {
    const c = new QualityController('high', 2, false);
    run(c, 30, 12);
    const dropped = { ...c.state };
    expect(dropped.dpr).toBeLessThan(1.5);
    run(c, 1000 / 60, 60);
    expect(c.state.dpr).toBeGreaterThan(dropped.dpr);
  });

  it('undoes a step up that made things worse and stops climbing', () => {
    const c = new QualityController('high', 2, false);
    run(c, 30, 6);
    const low = { ...c.state };
    run(c, 8, 12);
    const climbed = { ...c.state };
    expect(climbed).not.toEqual(low);
    run(c, 30, TUNING.minGapS + 1);
    run(c, 8, 60);
    expect(c.state.dpr).toBeLessThanOrEqual(climbed.dpr);
  });

  it('does nothing for a manual pick and ignores hitches', () => {
    const m = new QualityController('low', 2, true);
    expect(run(m, 40, 30)).toEqual([]);
    const c = new QualityController('high', 2, false);
    expect(c.step(1)).toBeNull();
  });

  it('never exceeds the device pixel ratio', () => {
    expect(new QualityController('high', 1, false).state.dpr).toBe(1);
  });
});

describe('storedTier', () => {
  it('accepts user tiers only', () => {
    expect(storedTier('medium')).toBe('medium');
    expect(storedTier('ci')).toBeNull();
    expect(storedTier('auto')).toBeNull();
    expect(storedTier(null)).toBeNull();
  });
});
