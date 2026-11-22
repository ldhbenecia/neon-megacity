// Boot progress math (ART_DIRECTION 9.2). Pure: the loader DOM only renders what this returns.
// Weights are normalized by their sum, so the bar reaches 100% whatever main.ts declares.

export interface BootStage {
  name: string;
  weight: number;
}

export interface ProgressState {
  stages: BootStage[];
  /** Index of the running stage, -1 before the first one. */
  current: number;
  done: boolean;
}

export function createProgress(): ProgressState {
  return { stages: [], current: -1, done: false };
}

/** Registers / starts a stage. Stages are reported in order; a repeated name is ignored. */
export function startStage(s: ProgressState, name: string, weight: number): ProgressState {
  if (s.stages.some((st) => st.name === name)) return s;
  const stages = [...s.stages, { name, weight: Math.max(0, weight) }];
  return { stages, current: stages.length - 1, done: false };
}

export function finish(s: ProgressState): ProgressState {
  return { ...s, current: s.stages.length, done: true };
}

/**
 * Completed fraction 0..1: finished stages over the total weight.
 * `total` is the planned weight sum (e.g. 100); stages beyond it extend the denominator.
 */
export function progressFraction(s: ProgressState, total: number): number {
  if (s.done) return 1;
  let finished = 0;
  let declared = 0;
  s.stages.forEach((st, i) => {
    declared += st.weight;
    if (i < s.current) finished += st.weight;
  });
  const denom = Math.max(total, declared);
  return denom > 0 ? Math.min(1, finished / denom) : 0;
}

/** "042%" style label (zero padded, tabular). */
export function formatPercent(fraction: number): string {
  const n = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return `${String(n).padStart(3, '0')}%`;
}

/** Segment index (0..segments-1) that is currently filling, for the blinking cell. */
export function activeSegment(fraction: number, segments: number): number {
  return Math.min(segments - 1, Math.floor(Math.min(1, Math.max(0, fraction)) * segments));
}
