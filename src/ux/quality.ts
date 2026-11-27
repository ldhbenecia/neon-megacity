// User quality tiers (docs/PERF.md "user quality tiers"): boot choice and the frame-time controller.
// Pure logic, no DOM; src/ux/perf.ts drives it every frame and applies its decisions.
import type { Quality } from '../core/types';

export type UserTier = Exclude<Quality, 'ci'>;
export const TIERS: readonly UserTier[] = ['low', 'medium', 'high'];

/** DPR cap per tier; the controller lowers DPR within a tier before dropping the tier. */
export const TIER_DPR: Readonly<Record<UserTier, number>> = { high: 1.5, medium: 1, low: 0.75 };
const DPR_STEP = 0.25;

/**
 * Starting tier from the WebGL renderer string (WEBGL_debug_renderer_info). Unreadable strings
 * (blocked or masked by the browser) start at medium, and the controller may still climb to high.
 * Safari masks every Apple GPU as "Apple GPU": on a touch device (iPhone, iPad) that is low,
 * on a Mac (M1–M4) medium.
 */
export function tierFromRenderer(renderer: string | null | undefined, touch = false): UserTier {
  const r = (renderer ?? '').toLowerCase();
  if (!r) return 'medium';
  if (/apple gpu\b/.test(r)) return touch ? 'low' : 'medium';
  if (/swiftshader|llvmpipe|software|mali|adreno|powervr/.test(r)) return 'low';
  if (/apple m\d|nvidia|geforce|rtx|radeon rx|radeon pro/.test(r)) return 'high';
  if (/intel|iris|uhd|radeon/.test(r)) return 'medium';
  return 'medium';
}

export interface QualityTuning {
  /** Window of the frame-time median (s). */
  windowS: number;
  slowMs: number;
  /**
   * A median below this is fast enough to try a step up. rAF intervals never go below the
   * display refresh (16.7 ms at 60 Hz), so this must sit above it; a step up that turns out too
   * heavy is undone and climbing stops.
   */
  fastMs: number;
  /** Seconds above slowMs before a step down. */
  slowForS: number;
  /** Seconds below fastMs before a step up. */
  fastForS: number;
  /** At most one step per this many seconds. */
  minGapS: number;
  /** Boot probe: the first seconds after warm-up step down at once above probeMs. */
  probeS: number;
  probeMs: number;
  /** First frames ignored entirely (shader warm-up, LOD0 builds, power-on). */
  skipFrames: number;
  /** A step up can only be blamed for a slowdown within this many seconds after it. */
  undoWindowS: number;
}

/** Window cap (frames): 2 s at up to 240 Hz. */
const MAX_SAMPLES = 512;

export const TUNING: QualityTuning = {
  windowS: 2,
  slowMs: 20,
  // 55 fps: holding a 60 Hz display at its refresh rate.
  fastMs: 1000 / 55,
  slowForS: 2,
  fastForS: 8,
  minGapS: 3,
  probeS: 2,
  probeMs: 25,
  skipFrames: 60,
  undoWindowS: 6,
};

export interface QualityState {
  tier: UserTier;
  dpr: number;
}

/** What `step` decided this frame (null: nothing changed). */
export type QualityChange = { tier: UserTier; dpr: number; tierChanged: boolean } | null;

/**
 * One controller for DPR and tier. Down: DPR first (0.25 steps to the tier's floor), then the next
 * tier. Up: the reverse, up to high (a guessed boot tier may be too low). A step up that makes the
 * median slow within undoWindowS is undone once and climbing stops for the session; later
 * slowdowns take the normal step-down path. `manual` (a stored or ?quality= pick) disables it.
 */
export class QualityController {
  state: QualityState;
  private readonly boot: UserTier;
  private readonly maxDpr: number;
  private frames = 0;
  private samples: number[] = [];
  /** Scratch for the median: sorted in place every frame, never reallocated. */
  private readonly sorted = new Float64Array(MAX_SAMPLES);
  private sum = 0;
  private slowFor = 0;
  private fastFor = 0;
  private sinceStep = Infinity;
  private age = 0;
  private lastUp: QualityState | null = null;
  private climbLocked = false;

  constructor(
    tier: UserTier,
    deviceDpr: number,
    readonly manual: boolean,
    private readonly t: QualityTuning = TUNING,
  ) {
    this.boot = tier;
    this.maxDpr = Math.max(0.5, deviceDpr);
    this.state = { tier, dpr: this.capFor(tier) };
  }

  /** DPR cap of a tier on this device (never above the device ratio). */
  capFor(tier: UserTier): number {
    return Math.min(TIER_DPR[tier], this.maxDpr);
  }

  /**
   * Median frame time of the window (ms). A median, not a mean: a few long frames (tab switch,
   * shader compile, a LOD0 build) must not move the tier.
   */
  get medianMs(): number {
    const n = this.samples.length;
    if (n === 0) return 0;
    this.sorted.fill(Infinity);
    for (let i = 0; i < n; i++) this.sorted[i] = this.samples[i] ?? Infinity;
    this.sorted.sort();
    return (this.sorted[n >> 1] ?? 0) * 1000;
  }

  /** Feed one frame (seconds). Hitches over 0.25 s (tab switch, GC, compile) are ignored. */
  step(dt: number): QualityChange {
    if (this.manual || !(dt > 0) || dt > 0.25) return null;
    if (++this.frames <= this.t.skipFrames) return null;
    this.age += dt;
    this.sinceStep += dt;
    this.samples.push(dt);
    this.sum += dt;
    while (
      this.samples.length > 1 &&
      (this.sum - (this.samples[0] ?? 0) >= this.t.windowS || this.samples.length > MAX_SAMPLES)
    ) {
      this.sum -= this.samples.shift() ?? 0;
    }
    const med = this.medianMs;
    const probing = this.age <= this.t.probeS;
    if (probing && this.sum >= this.t.probeS * 0.5 && med > this.t.probeMs) {
      return this.down();
    }
    if (this.sum < this.t.windowS * 0.95) return null;
    this.slowFor = med > this.t.slowMs ? this.slowFor + dt : 0;
    this.fastFor = med < this.t.fastMs ? this.fastFor + dt : 0;
    if (this.lastUp && this.sinceStep > this.t.undoWindowS) this.lastUp = null;
    if (this.lastUp && med > this.t.slowMs) {
      // The last step up made things worse: undo it and stop climbing.
      const back = this.lastUp;
      this.lastUp = null;
      this.climbLocked = true;
      return this.apply(back);
    }
    if (this.sinceStep < this.t.minGapS) return null;
    if (this.slowFor >= this.t.slowForS) return this.down();
    if (this.fastFor >= this.t.fastForS && !this.climbLocked) return this.up();
    return null;
  }

  /**
   * To `tier` (default: the boot tier) at its DPR cap with a fresh window and climbing unlocked:
   * the quality picker and the debug panel "Auto quality".
   */
  reset(tier: UserTier = this.boot): QualityChange {
    this.climbLocked = false;
    this.lastUp = null;
    const change = this.apply({ tier, dpr: this.capFor(tier) });
    this.clearWindow();
    return change;
  }

  /** Drop the frame history, e.g. when automatic mode is switched back on. */
  clearWindow(): void {
    this.samples = [];
    this.sum = 0;
    this.slowFor = 0;
    this.fastFor = 0;
    this.sinceStep = 0;
  }

  private down(): QualityChange {
    const { tier, dpr } = this.state;
    const floor =
      tier === 'low' ? TIER_DPR.low : this.capFor(TIERS[TIERS.indexOf(tier) - 1] ?? tier);
    if (dpr - DPR_STEP >= floor - 1e-6) return this.apply({ tier, dpr: dpr - DPR_STEP }, false);
    const lower = TIERS[TIERS.indexOf(tier) - 1];
    if (!lower) return null;
    return this.apply({ tier: lower, dpr: this.capFor(lower) }, false);
  }

  private up(): QualityChange {
    const { tier, dpr } = this.state;
    const prev = { ...this.state };
    let next: QualityState | null = null;
    if (dpr + DPR_STEP <= this.capFor(tier) + 1e-6) next = { tier, dpr: dpr + DPR_STEP };
    else if (TIERS.indexOf(tier) < TIERS.indexOf('high')) {
      const higher = TIERS[TIERS.indexOf(tier) + 1];
      if (higher) next = { tier: higher, dpr: this.capFor(tier) };
    }
    if (!next) return null;
    const change = this.apply(next, false);
    this.lastUp = prev;
    return change;
  }

  private apply(next: QualityState, keepLastUp = true): QualityChange {
    const tierChanged = next.tier !== this.state.tier;
    const dpr = Math.round(next.dpr * 100) / 100;
    if (!tierChanged && dpr === this.state.dpr) return null;
    this.state = { tier: next.tier, dpr };
    if (!keepLastUp) this.lastUp = null;
    this.samples = [];
    this.sum = 0;
    this.slowFor = 0;
    this.fastFor = 0;
    this.sinceStep = 0;
    return { tier: next.tier, dpr, tierChanged };
  }
}

/** localStorage key of the user's manual pick ('auto' or a tier). */
export const QUALITY_STORAGE_KEY = 'hangang.quality';

/** A stored pick, if valid. */
export function storedTier(value: string | null): UserTier | null {
  return value === 'high' || value === 'medium' || value === 'low' ? value : null;
}
