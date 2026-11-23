import { LAYOUT, type BuildingSpec, type Layout } from '../city/layout';
import { clockMinutes, formatClock } from '../core/clock';

export type RigMode = 'orbit' | 'fly' | 'cinematic' | 'flight';

// String keys: newer layouts may add archetypes or kinds before ux learns them.
export const ARCHETYPE_KO: Readonly<Record<string, string>> = {
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
  taperTower: '테이퍼 타워',
  mediaSlab: '미디어 슬래브',
  lowOffice: '저층 업무',
  hanokRow: '기와 상가',
  palaceHall: '전각',
  brickWarehouse: '벽돌 창고',
  showroomBox: '쇼룸',
};

export const DISTRICT_KO: Readonly<Record<string, string>> = {
  core: '도심',
  midtown: '업무지구',
  sangga: '상가',
  hillside: '산동네',
  apartment: '아파트 단지',
  industrial: '공업지역',
  riverside: '강변',
  megacore: '고층 중심',
  corridor: '간선 업무축',
  oldtown: '옛 도심',
  palace: '궁궐',
  brick: '벽돌 창고가',
  nightlife: '유흥가',
  showroom: '쇼룸 거리',
  park: '공원',
};

export const ARCHETYPE_FALLBACK = '건물';
export const DISTRICT_FALLBACK = '구역';

const own = (table: Readonly<Record<string, string>>, key: string): string | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined;

export function archetypeLabel(archetype: string): string {
  return own(ARCHETYPE_KO, archetype) ?? ARCHETYPE_FALLBACK;
}

export function zoneLabel(L: Pick<Layout, 'districts'>, zoneId: string, kind: string): string {
  const name = L.districts.find((z) => z.id === zoneId)?.name;
  return name || own(DISTRICT_KO, kind) || DISTRICT_FALLBACK;
}

export interface CardInfo {
  zone: string;
  name: string;
  sub: string;
  height: string;
  floors: string;
  archetype: string;
}

export function buildingCard(b: BuildingSpec, L: Pick<Layout, 'districts'> = LAYOUT): CardInfo {
  const zone = zoneLabel(L, b.zoneId, b.district);
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
    archetype: archetypeLabel(b.archetype),
  };
}

export interface Hud {
  setMode(mode: RigMode): void;
  showCard(b: BuildingSpec | null): void;
  toast(text: string): void;
  toggle(force?: boolean): boolean;
  toggleHelp(force?: boolean): boolean;
  readonly helpOpen: boolean;
  showHint(): void;
  readonly visible: boolean;
  update(timeOfDay: number): void;
  dispose(): void;
}

const HINT_MS = 7000;

export function createHud(opts: { visible: boolean; onDeselect?: () => void }): Hud {
  const root = document.getElementById('hud');
  const clockEl = document.getElementById('clock');
  const modeEl = document.getElementById('hud-mode');
  const card = document.getElementById('hud-card');
  const toastEl = document.getElementById('hud-toast');
  const hint = document.getElementById('hud-hint');
  const help = document.getElementById('help');
  const helpClose = document.getElementById('help-close');
  const cardClose = document.getElementById('card-close');
  let clockMins = -1;
  let mode: RigMode | null = null;
  let toastTimer = 0;
  let hintTimer = 0;
  let visible = true;
  let helpReturn: HTMLElement | null = null;

  const field = (name: string, text: string): void => {
    const el = card?.querySelector<HTMLElement>(`[data-field="${name}"]`);
    if (el) el.textContent = text;
  };
  const hideHint = (): void => {
    clearTimeout(hintTimer);
    if (hint) hint.hidden = true;
  };
  const onCardClose = (): void => opts.onDeselect?.();
  const onHelpClose = (): void => {
    hud.toggleHelp(false);
  };
  cardClose?.addEventListener('click', onCardClose);
  helpClose?.addEventListener('click', onHelpClose);

  const hud: Hud = {
    get visible() {
      return visible;
    },
    showHint() {
      if (!hint) return;
      hint.hidden = false;
      clearTimeout(hintTimer);
      hintTimer = window.setTimeout(hideHint, HINT_MS);
    },
    get helpOpen() {
      return help ? help.hidden === false : false;
    },
    setMode(m) {
      if (m === mode) return;
      mode = m;
      if (root) root.dataset.mode = m;
      if (!modeEl) return;
      const label = m === 'fly' ? '비행 모드 · Esc로 끄기' : m === 'cinematic' ? '시네마틱' : '';
      modeEl.textContent = label;
      modeEl.hidden = label === '';
      if (m !== 'orbit' && m !== 'flight') hideHint();
    },
    showCard(b) {
      if (!card) return;
      if (!b) {
        card.hidden = true;
        return;
      }
      const info = buildingCard(b);
      for (const k of Object.keys(info) as (keyof CardInfo)[]) field(k, info[k]);
      card.hidden = false;
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
      return visible;
    },
    toggleHelp(force) {
      if (!help) return false;
      const isOpen = help.hidden === false;
      const open = force ?? !isOpen;
      if (open === isOpen) return open;
      help.hidden = !open;
      if (open) {
        hideHint();
        helpReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        helpClose?.focus({ preventScroll: true });
      } else {
        helpReturn?.focus({ preventScroll: true });
        helpReturn = null;
      }
      return open;
    },
    update(timeOfDay) {
      const mins = clockMinutes(timeOfDay);
      if (clockEl && mins !== clockMins) {
        clockMins = mins;
        clockEl.textContent = formatClock(mins);
      }
    },
    dispose() {
      clearTimeout(toastTimer);
      clearTimeout(hintTimer);
      cardClose?.removeEventListener('click', onCardClose);
      helpClose?.removeEventListener('click', onHelpClose);
    },
  };
  hud.toggle(opts.visible);
  hud.setMode('orbit');
  return hud;
}
