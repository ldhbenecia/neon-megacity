import {
  activeSegment,
  createProgress,
  finish,
  formatPercent,
  progressFraction,
  startStage,
  type ProgressState,
} from './progress';

export interface Loader {
  stage(name: string, weight: number): void;
  detail(name: string, text: string): void;
  done(): Promise<void>;
  fail(stage: string, err: unknown): void;
}

const TOTAL_WEIGHT = 100;
const SEGMENTS = 20;
const LOG_LINES = 4;

const STAGE_TEXT: Record<string, [running: string, done: string]> = {
  setup: ['도시 측량 중…', '지형 측량 완료'],
  lighting: ['하늘 보정 중…', '하늘 보정 완료'],
  terrain: ['한강 수위 측정 중…', '한강 수위 안정'],
  buildings: ['건물 조립 중…', '건물 조립 완료'],
  infra: ['고가도로 연결 중…', '고가도로 연결 완료'],
  neon: ['네온 배선 중…', '네온 점등 대기'],
  atmosphere: ['대기 생성 중…', '대기 생성 완료'],
  compile: ['셰이더 예열 중…', '셰이더 예열 완료'],
  'first-frame': ['첫 프레임 렌더 중…', '전력 투입'],
};

export const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createLoader(root: HTMLElement | null = document.getElementById('boot')): Loader {
  let state: ProgressState = createProgress();
  const details = new Map<string, string>();
  const fill = root?.querySelector<HTMLElement>('.boot-fill') ?? null;
  const cursor = root?.querySelector<HTMLElement>('.boot-cursor') ?? null;
  const pct = root?.querySelector<HTMLElement>('.boot-pct') ?? null;
  const bar = root?.querySelector<HTMLElement>('.boot-bar') ?? null;
  const log = root?.querySelector<HTMLElement>('.boot-log') ?? null;
  let failed = false;
  let running: HTMLElement | null = null;

  const render = (): void => {
    const f = progressFraction(state, TOTAL_WEIGHT);
    // transform-only so the CSS transition keeps moving while a sync init blocks the thread.
    if (fill) fill.style.transform = `scaleX(${f})`;
    if (cursor) cursor.style.transform = `translateX(${activeSegment(f, SEGMENTS) * 100}%)`;
    if (pct) pct.textContent = formatPercent(f);
    bar?.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    if (root) root.dataset.progress = String(Math.round(f * 100));
  };

  const line = (tag: 'OK' | '..' | 'ERR', text: string): HTMLElement | null => {
    if (!log) return null;
    const li = document.createElement('li');
    li.dataset.tag = tag;
    const b = document.createElement('b');
    b.textContent = `[${tag}]`;
    li.append(b, ` ${text}`);
    log.append(li);
    while (log.children.length > LOG_LINES) log.firstElementChild?.remove();
    log.classList.remove('push');
    log.getBoundingClientRect(); // force a reflow so the animation restarts
    log.classList.add('push');
    return li;
  };

  const closeRunning = (): void => {
    const name = state.stages[state.current]?.name;
    if (!running || name === undefined) return;
    const done = STAGE_TEXT[name]?.[1] ?? `${name} 완료`;
    const extra = details.get(name);
    running.dataset.tag = 'OK';
    running.replaceChildren(
      Object.assign(document.createElement('b'), { textContent: '[OK]' }),
      ` ${extra ?? done}`,
    );
    running = null;
  };

  render();
  return {
    stage(name, weight) {
      if (failed) return;
      // Boot stage timings for `npm run perf` (performance.getEntriesByType('mark')).
      performance.mark(`boot:${name}`);
      closeRunning();
      state = startStage(state, name, weight);
      running = line('..', STAGE_TEXT[name]?.[0] ?? `${name}…`);
      render();
    },
    detail(name, text) {
      details.set(name, text);
    },
    async done() {
      if (failed) return;
      performance.mark('boot:interactive');
      closeRunning();
      state = finish(state);
      render();
      if (!root) return;
      const reduce = reducedMotion();
      root.classList.add('is-done');
      await wait(reduce ? 0 : 260);
      root.classList.add('is-leaving');
      await wait(reduce ? 200 : 720);
      root.remove();
    },
    fail(stage, err) {
      // Reported once: a module failure is rethrown and reaches main's boot().catch too.
      if (failed) return;
      failed = true;
      console.error(`[boot] ${stage} failed`, err);
      root?.classList.add('is-error');
      // The running stage line becomes the error line: a failed stage never shows [OK].
      if (running) {
        running.dataset.tag = 'ERR';
        running.replaceChildren(
          Object.assign(document.createElement('b'), { textContent: '[ERR]' }),
          ` ${stage}`,
        );
        running = null;
      } else {
        line('ERR', stage);
      }
    },
  };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Two animation frames: lets the DOM paint the last loader update before blocking again.
 * A timeout backs it up so boot still finishes in a background tab (no rAF there).
 */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 120);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(t);
        resolve();
      }),
    );
  });
}
