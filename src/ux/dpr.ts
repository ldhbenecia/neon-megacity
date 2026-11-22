// Adaptive device pixel ratio (ART_DIRECTION 11, "적응형 품질"). Pure state machine:
// 2 s moving average frame time > 20 ms → DPR −0.25 (min 1.0); < 14 ms held for 5 s → +0.25 (cap).

export interface DprOptions {
  /** Upper bound, normally min(devicePixelRatio, 1.5). */
  max: number;
  min?: number;
  step?: number;
  slowMs?: number;
  fastMs?: number;
  windowS?: number;
  recoverS?: number;
}

export class AdaptiveDpr {
  readonly max: number;
  readonly min: number;
  private readonly step: number;
  private readonly slowMs: number;
  private readonly fastMs: number;
  private readonly windowS: number;
  private readonly recoverS: number;
  /** Ring of (dt) samples covering the last `windowS` seconds. */
  private samples: number[] = [];
  private sum = 0;
  private fastFor = 0;
  dpr: number;

  constructor(opts: DprOptions) {
    this.min = Math.min(opts.min ?? 1, opts.max);
    this.max = Math.max(opts.max, this.min);
    this.step = opts.step ?? 0.25;
    this.slowMs = opts.slowMs ?? 20;
    this.fastMs = opts.fastMs ?? 14;
    this.windowS = opts.windowS ?? 2;
    this.recoverS = opts.recoverS ?? 5;
    this.dpr = this.max;
  }

  /** Moving average frame time in ms (0 with no samples). */
  get averageMs(): number {
    return this.samples.length ? (this.sum / this.samples.length) * 1000 : 0;
  }

  /** Feed one frame's real delta (seconds). Returns the new DPR when it changed, else null. */
  sample(dt: number): number | null {
    // Hitches (tab switch, GC, shader compile) say nothing about steady-state cost.
    if (!(dt > 0) || dt > 0.25) return null;
    this.samples.push(dt);
    this.sum += dt;
    while (this.sum - (this.samples[0] ?? 0) >= this.windowS && this.samples.length > 1) {
      this.sum -= this.samples.shift() ?? 0;
    }
    if (this.sum < this.windowS * 0.95) return null; // window not full yet
    const avg = this.averageMs;
    if (avg > this.slowMs) {
      this.fastFor = 0;
      if (this.dpr > this.min) return this.set(this.dpr - this.step);
      return null;
    }
    if (avg < this.fastMs) {
      this.fastFor += dt;
      if (this.fastFor >= this.recoverS && this.dpr < this.max) {
        this.fastFor = 0;
        return this.set(this.dpr + this.step);
      }
    } else {
      this.fastFor = 0;
    }
    return null;
  }

  private set(v: number): number {
    this.dpr = Math.min(this.max, Math.max(this.min, Math.round(v * 100) / 100));
    // Fresh window: the old samples were measured at the previous resolution.
    this.samples = [];
    this.sum = 0;
    return this.dpr;
  }
}
