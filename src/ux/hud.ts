// HUD (ART_DIRECTION 1, 8.3): title, clock, mode badge, controls help, selected building card,
// preset toast. DOM lives in index.html; this module only writes text when something changed.
import { zoneById, type Archetype, type BuildingSpec } from '../city/layout';
import { clockMinutes, formatClock } from '../core/clock';

export type RigMode = 'orbit' | 'fly' | 'cinematic' | 'flight';

const MODE_LABEL: Record<RigMode, string> = {
  orbit: 'ORBIT',
  fly: 'FLY · ESC',
  cinematic: 'CINEMATIC',
  flight: 'FLIGHT',
};

export const ARCHETYPE_KO: Record<Archetype, string> = {
  setbackTower: '셋백 타워',
  cylinderTower: '원통 타워',
  bracedTower: '브레이싱 타워',
  cantileverTower: '캔틸레버 타워',
  twinTower: '쌍둥이 타워',
  officeSlab: '업무 빌딩',
  sangga: '상가 건물',
  apartmentSlab: '판상형 아파트',
  hillHouse: '산동네 주택',
  warehouse: '창고',
  pavilion: '강변 매점',
};

export interface CardInfo {
  zone: string;
  name: string;
  sub: string;
  height: string;
  floors: string;
  archetype: string;
}

/** Korean card text for a building (pure, unit tested). */
export function buildingCard(b: BuildingSpec): CardInfo {
  let zone: string = b.district;
  try {
    zone = zoneById(b.zoneId).name;
  } catch {
    // Unknown zone id: fall back to the district kind.
  }
  const sub: string[] = [];
  if (b.tags.corp) sub.push(b.tags.corp);
  if (b.tags.complex) sub.push(b.tags.dong ? `${b.tags.complex} ${b.tags.dong}동` : b.tags.complex);
  else if (b.tags.dong) sub.push(`${b.tags.dong}동`);
  if (b.tags.cross) sub.push('옥상 십자가');
  return {
    zone: zone.toUpperCase(),
    name: b.tags.name,
    sub: sub.join(' · '),
    height: `${Math.round(b.h + b.spireH)} m`,
    floors: `${b.floors}층`,
    archetype: ARCHETYPE_KO[b.archetype],
  };
}

export interface Hud {
  setMode(mode: RigMode): void;
  /** Show the card for a building, or hide it with null. */
  showCard(b: BuildingSpec | null): void;
  toast(text: string): void;
  toggle(force?: boolean): boolean;
  readonly visible: boolean;
  update(timeOfDay: number): void;
  dispose(): void;
}

export function createHud(opts: {
  visible: boolean;
  /** Called when H toggles the HUD (main hides lil-gui too unless ?nogui). */
  onToggle?: (visible: boolean) => void;
}): Hud {
  const root = document.getElementById('hud');
  const clockEl = document.getElementById('clock');
  const modeEl = document.getElementById('hud-mode');
  const card = document.getElementById('hud-card');
  const toastEl = document.getElementById('hud-toast');
  const help = document.getElementById('hud-help');
  let clockMins = -1;
  let mode: RigMode | null = null;
  let toastTimer = 0;
  let cardTimer = 0;
  let visible = true;

  // Small screens start with the help folded so the city stays visible.
  if (help instanceof HTMLDetailsElement && window.matchMedia('(max-width: 640px)').matches) {
    help.open = false;
  }

  const field = (name: string, text: string): void => {
    const el = card?.querySelector<HTMLElement>(`[data-field="${name}"]`);
    if (el) el.textContent = text;
  };

  const hud: Hud = {
    get visible() {
      return visible;
    },
    setMode(m) {
      if (m === mode) return;
      mode = m;
      if (root) root.dataset.mode = m;
      if (modeEl) modeEl.textContent = MODE_LABEL[m];
    },
    showCard(b) {
      if (!card) return;
      clearTimeout(cardTimer);
      if (!b) {
        card.classList.remove('is-in');
        cardTimer = window.setTimeout(() => (card.hidden = true), 260);
        return;
      }
      const info = buildingCard(b);
      for (const k of Object.keys(info) as (keyof CardInfo)[]) field(k, info[k]);
      card.hidden = false;
      // Next frame so the 0.25 s fade-in transition runs.
      requestAnimationFrame(() => card.classList.add('is-in'));
    },
    toast(text) {
      if (!toastEl) return;
      toastEl.textContent = text;
      toastEl.classList.add('is-in');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toastEl.classList.remove('is-in'), 1600);
    },
    toggle(force) {
      visible = force ?? !visible;
      root?.classList.toggle('is-hidden', !visible);
      opts.onToggle?.(visible);
      return visible;
    },
    update(timeOfDay) {
      // The clock only changes once per in-game minute; skip redundant DOM writes.
      const mins = clockMinutes(timeOfDay);
      if (clockEl && mins !== clockMins) {
        clockMins = mins;
        clockEl.textContent = formatClock(mins);
      }
    },
    dispose() {
      clearTimeout(toastTimer);
      clearTimeout(cardTimer);
    },
  };
  hud.toggle(opts.visible);
  hud.setMode('orbit');
  return hud;
}
