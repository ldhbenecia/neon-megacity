// Ownership (ARCHITECTURE env table): `timeLocked` and `rainTarget` are ux-owned. A user scrub
// writes `timeOfDay` only while `timeLocked` is true (the documented exception: lighting does
// not advance it while locked). Weather buttons set `rainTarget`; atmosphere eases `rain` to it.
import { clockMinutes } from '../core/clock';
import type { Ctx } from '../core/types';
import type { CameraRig } from './cameraRig';
import type { Hud } from './hud';
import type { Perf } from './perf';
import { QUALITY_STORAGE_KEY, type UserTier } from './quality';
import { districtViews, rigPresets } from './presets';

export interface Controls {
  update(): void;
  /** Marks the chip of the zone the camera looks at ('' for none). */
  markDistrict(id: string): void;
  dispose(): void;
}

const TIER_KO: Readonly<Record<string, string>> = { high: '상', medium: '중', low: '하', ci: 'CI' };
/** Zone kinds whose chips stand out: the quarters most visitors look for first. */

const MAJOR_KINDS = new Set(['megacore', 'corridor', 'nightlife', 'brick', 'oldtown']);

export const RAIN_STEPS = [0, 0.35, 1] as const;

export function rainStep(rain: number): number {
  let best = 0;
  RAIN_STEPS.forEach((v, i) => {
    if (Math.abs(v - rain) < Math.abs((RAIN_STEPS[best] ?? 0) - rain)) best = i;
  });
  return best;
}

export function createControls(ctx: Ctx, rig: CameraRig, hud: Hud, perf: Perf): Controls {
  const { env } = ctx;
  const toggle = document.getElementById('panel-toggle');
  const panel = document.getElementById('panel');
  const chipsRoot = document.getElementById('preset-chips');
  const swCine = document.getElementById('sw-cinematic');
  const swFly = document.getElementById('sw-fly');
  const openHelp = document.getElementById('open-help');
  const play = document.getElementById('tl-play');
  const range = document.getElementById('tl-range');
  const ticks = document.querySelector('.tl-ticks');
  const weatherButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-rain]'));
  const cleanup: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(
    el: EventTarget | null,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void => {
    if (!el) return;
    el.addEventListener(type, fn as EventListener, opts);
    cleanup.push(() => el.removeEventListener(type, fn as EventListener, opts));
  };

  const hudRoot = document.getElementById('hud');
  // Same breakpoint as the compact rules in style.css: the panel and the card take turns there.
  const compact = window.matchMedia('(max-width: 640px), (max-height: 520px)');
  const setPanel = (open: boolean, focus = false): void => {
    if (!panel || !toggle) return;
    // The help sheet and the panel never share the screen.
    if (open) hud.toggleHelp(false);
    panel.hidden = !open;
    if (hudRoot) hudRoot.dataset.panel = open ? 'open' : 'closed';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '도시 설정 닫기' : '도시 설정 열기');
    if (open && focus) panel.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  };
  on(toggle, 'click', (e) => setPanel(panel ? panel.hidden !== false : false, e.detail === 0));
  // Esc closes the panel first (capture: before the rig's Esc deselects or leaves fly mode).
  on(
    window,
    'keydown',
    (e) => {
      if (e.code !== 'Escape' || !panel || panel.hidden !== false) return;
      e.stopImmediatePropagation();
      setPanel(false);
      toggle?.focus({ preventScroll: true });
    },
    { capture: true },
  );
  on(ctx.renderer.domElement, 'pointerdown', () => setPanel(false));
  cleanup.push(
    hud.onCard((open) => {
      // Not while the user works in the panel: the card waits behind it (style.css) instead.
      if (open && compact.matches && !panel?.contains(document.activeElement)) setPanel(false);
    }),
    hud.onHelp((open) => {
      if (open) setPanel(false);
    }),
    () => {
      if (hudRoot) delete hudRoot.dataset.panel;
    },
  );
  on(openHelp, 'click', () => {
    setPanel(false);
    hud.toggleHelp(true);
  });

  const renderWeather = (): void => {
    const step = rainStep(env.rainTarget);
    weatherButtons.forEach((b, i) => b.setAttribute('aria-checked', String(i === step)));
  };
  for (const b of weatherButtons) {
    on(b, 'click', () => {
      env.rainTarget = Number(b.dataset.rain ?? 0);
      renderWeather();
    });
  }
  on(panel?.querySelector('.segmented') ?? null, 'keydown', (e) => {
    if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const next = Math.min(
      weatherButtons.length - 1,
      Math.max(0, rainStep(env.rainTarget) + (e.code === 'ArrowRight' ? 1 : -1)),
    );
    weatherButtons[next]?.click();
    weatherButtons[next]?.focus();
  });

  const chips: HTMLButtonElement[] = [];
  if (chipsRoot) {
    for (const p of rigPresets()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.preset = String(p.key);
      const key = document.createElement('span');
      key.className = 'chip-key';
      key.textContent = String(p.key);
      key.setAttribute('aria-hidden', 'true');
      b.append(key, p.name);
      b.setAttribute('aria-label', `${p.name} (${p.key})`);
      on(b, 'click', () => rig.goPreset(p.key));
      chipsRoot.append(b);
      chips.push(b);
    }
  }

  const districtRoot = document.getElementById('district-chips');
  const districtGroup = document.getElementById('district-group');
  // On a phone the long list would hide the whole city behind the panel: start folded there.
  if (districtGroup instanceof HTMLDetailsElement && compact.matches) districtGroup.open = false;
  let currentDistrict = '';
  if (districtRoot) {
    const views = districtViews();
    for (const [north, label] of [
      [true, '강북'],
      [false, '강남'],
    ] as const) {
      const row = document.createElement('div');
      row.className = 'district-row';
      const head = document.createElement('span');
      head.className = 'district-side';
      head.textContent = label;
      row.append(head);
      for (const d of views.filter((v) => v.north === north)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.district = d.id;
        if (MAJOR_KINDS.has(d.kind)) b.dataset.major = '';
        b.textContent = d.name;
        on(b, 'click', () => {
          rig.goDistrict(d.id);
          if (compact.matches) setPanel(false);
        });
        row.append(b);
      }
      districtRoot.append(row);
    }
    cleanup.push(() => districtRoot.replaceChildren());
  }

  on(swCine, 'click', () => {
    rig.setCinematic(rig.mode !== 'cinematic');
    if (rig.mode === 'cinematic') setPanel(false);
  });
  on(swFly, 'click', () => {
    rig.setFly(rig.mode !== 'fly');
    if (rig.mode === 'fly') setPanel(false);
  });

  const input = range instanceof HTMLInputElement ? range : null;
  let scrubbing = false;
  const setTime = (t: number): void => {
    env.timeLocked = true;
    env.timeOfDay = ((t % 1) + 1) % 1;
  };
  on(input, 'input', () => {
    if (!input) return;
    setTime(Number(input.value) / 1440);
  });
  on(input, 'pointerdown', () => (scrubbing = true));
  on(window, 'pointerup', () => (scrubbing = false));
  on(window, 'pointercancel', () => (scrubbing = false));
  on(play, 'click', () => {
    env.timeLocked = !env.timeLocked;
  });
  on(ticks, 'click', (e) => {
    const b = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-time]');
    if (b) setTime(Number(b.dataset.time));
  });

  let lastMins = -1;
  let lastLocked: boolean | null = null;
  let lastMode = '';
  let lastPreset: number | null | undefined;
  let lastRainStep = -1;
  renderWeather();

  // Quality row: auto, or a fixed tier that turns the frame-time controller off (saved).
  const qualityGroup = document.getElementById('quality-group');
  const qualityNow = document.getElementById('quality-now');
  const urlQuality = new URLSearchParams(location.search).has('quality');
  const qualityButtons = [
    ...(qualityGroup?.querySelectorAll<HTMLButtonElement>('button[data-quality]') ?? []),
  ];
  let lastQuality = '';
  const renderQuality = (): void => {
    const q = perf.quality();
    const key = `${q.tier}/${q.auto}`;
    if (key === lastQuality) return;
    lastQuality = key;
    if (qualityGroup) qualityGroup.hidden = q.tier === 'ci';
    const picked = q.auto ? 'auto' : q.tier;
    for (const b of qualityButtons)
      b.setAttribute('aria-checked', String(b.dataset.quality === picked));
    if (qualityNow)
      qualityNow.textContent =
        q.tier === 'ci' ? '' : `· ${q.auto ? '자동 · ' : ''}${TIER_KO[q.tier]}`;
  };
  for (const b of qualityButtons) {
    on(b, 'click', () => {
      const choice = b.dataset.quality as 'auto' | UserTier;
      // ?quality= wins over the stored pick at boot, so a pick made under it lasts this visit only.
      if (!urlQuality) {
        try {
          localStorage.setItem(QUALITY_STORAGE_KEY, choice);
        } catch {
          // Private mode or blocked storage: the pick still applies for this visit.
        }
      }
      perf.choose(choice);
      renderQuality();
    });
  }
  on(qualityGroup?.querySelector('.segmented') ?? null, 'keydown', (e) => {
    if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const at = qualityButtons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const next = Math.min(
      qualityButtons.length - 1,
      Math.max(0, at + (e.code === 'ArrowRight' ? 1 : -1)),
    );
    qualityButtons[next]?.click();
    qualityButtons[next]?.focus();
  });
  renderQuality();

  return {
    markDistrict(id) {
      if (id === currentDistrict || !districtRoot) return;
      currentDistrict = id;
      for (const b of districtRoot.querySelectorAll<HTMLButtonElement>('button[data-district]')) {
        b.setAttribute('aria-current', String(b.dataset.district === id));
      }
    },
    update() {
      const mins = clockMinutes(env.timeOfDay);
      if (input && mins !== lastMins && !scrubbing) {
        lastMins = mins;
        input.value = String(mins);
        input.setAttribute('aria-valuetext', `${Math.floor(mins / 60)}시 ${mins % 60}분`);
      }
      if (play && env.timeLocked !== lastLocked) {
        lastLocked = env.timeLocked;
        play.setAttribute('aria-pressed', String(!env.timeLocked));
        play.setAttribute('aria-label', env.timeLocked ? '시간 흐르게 하기' : '시간 흐름 멈추기');
      }
      if (rig.mode !== lastMode) {
        lastMode = rig.mode;
        swCine?.setAttribute('aria-checked', String(rig.mode === 'cinematic'));
        swFly?.setAttribute('aria-checked', String(rig.mode === 'fly'));
      }
      if (rig.preset !== lastPreset) {
        lastPreset = rig.preset;
        for (const c of chips) {
          c.setAttribute('aria-current', String(Number(c.dataset.preset) === rig.preset));
        }
      }
      const step = rainStep(env.rainTarget);
      renderQuality();
      if (step !== lastRainStep) {
        lastRainStep = step;
        renderWeather();
      }
    },
    dispose() {
      for (const fn of cleanup) fn();
      for (const c of chips) c.remove();
    },
  };
}
