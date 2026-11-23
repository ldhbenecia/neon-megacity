export interface BootStage {
  name: string;
  weight: number;
}

export interface ProgressState {
  stages: BootStage[];
  current: number;
  done: boolean;
}

export function createProgress(): ProgressState {
  return { stages: [], current: -1, done: false };
}

export function startStage(s: ProgressState, name: string, weight: number): ProgressState {
  if (s.stages.some((st) => st.name === name)) return s;
  const stages = [...s.stages, { name, weight: Math.max(0, weight) }];
  return { stages, current: stages.length - 1, done: false };
}

export function finish(s: ProgressState): ProgressState {
  return { ...s, current: s.stages.length, done: true };
}

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

export function formatPercent(fraction: number): string {
  const n = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return `${String(n).padStart(3, '0')}%`;
}

export function activeSegment(fraction: number, segments: number): number {
  return Math.min(segments - 1, Math.floor(Math.min(1, Math.max(0, fraction)) * segments));
}
