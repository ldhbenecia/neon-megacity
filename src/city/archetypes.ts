// Building archetypes: footprint sizing, tier (setback) computation and fictional names.
// ART_DIRECTION 4.1, 4.2. Tiers live in the layout so buildings and neon share one truth.
import type { Rng } from '../core/random';
import { toWorld } from './math';
import type {
  Archetype,
  BuildingSpec,
  Cantilever,
  Side,
  Skybridge,
  Tier,
  TierShape,
} from './types';

/** Floor heights per archetype: [typical floor, ground floor]. */
export const FLOOR_H: Record<Archetype, [number, number]> = {
  setbackTower: [3.6, 6],
  cylinderTower: [3.6, 6],
  bracedTower: [3.6, 6],
  cantileverTower: [3.6, 6],
  twinTower: [3.6, 6],
  officeSlab: [3.6, 6],
  sangga: [3.3, 4.2],
  apartmentSlab: [2.8, 2.8],
  hillHouse: [2.7, 2.7],
  warehouse: [6, 6],
  pavilion: [3, 3],
};

export function floorsFor(h: number, floorH: number, groundH: number): number {
  return Math.max(1, Math.round((h - groundH) / floorH) + 1);
}

/** Weighted pick from [value, weight] pairs. */
export function weighted<T>(rng: Rng, table: readonly (readonly [T, number])[]): T {
  const total = table.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [v, w] of table) {
    r -= w;
    if (r < 0) return v;
  }
  const last = table[table.length - 1];
  if (!last) throw new Error('weighted() on empty table');
  return last[0];
}

/** Body of a building before tiers are computed. */
export interface Massing {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rotY: number;
  baseY: number;
  archetype: Archetype;
}

export interface TierResult {
  tiers: Tier[];
  twin?: Tier[];
  skybridge?: Skybridge;
  cantilever?: Cantilever;
  spireH: number;
}

const SIDES: readonly Side[] = ['px', 'nx', 'pz', 'nz'];

function tier(
  m: Massing,
  lx: number,
  w: number,
  d: number,
  y0: number,
  y1: number,
  shape: TierShape,
  chamfer: number,
): Tier {
  const o = toWorld(lx, 0, m.rotY);
  return { x: m.x + o.x, z: m.z + o.z, w, d, y0, y1, shape, chamfer };
}

/** Stack of tiers with relative heights `ratios` and per-step insets. */
function setbackStack(
  m: Massing,
  rng: Rng,
  lx: number,
  w0: number,
  d0: number,
  ratios: readonly number[],
  shape: TierShape,
  chamfer: number,
): Tier[] {
  const sum = ratios.reduce((s, r) => s + r, 0);
  const tiers: Tier[] = [];
  let w = w0;
  let d = d0;
  let y = m.baseY;
  ratios.forEach((r, i) => {
    if (i > 0) {
      const inset = rng.range(3, 8);
      // Keep at least 8 m of floor plate; otherwise stop insetting.
      if (w - 2 * inset >= 8 && d - 2 * inset >= 8) {
        w -= 2 * inset;
        d -= 2 * inset;
      }
    }
    const y1 = i === ratios.length - 1 ? m.baseY + m.h : y + (m.h * r) / sum;
    const c = shape === 'chamfer' ? Math.min(chamfer, w / 4, d / 4) : 0;
    tiers.push(tier(m, lx, w, d, y, y1, shape, c));
    y = y1;
  });
  return tiers;
}

const SETBACK_RATIOS = [0.4, 0.25, 0.2, 0.15] as const;

export function computeTiers(m: Massing, rng: Rng, district: string): TierResult {
  const top = m.baseY + m.h;
  const box = (shape: TierShape = 'box', chamfer = 0): Tier[] => [
    tier(m, 0, m.w, m.d, m.baseY, top, shape, chamfer),
  ];
  switch (m.archetype) {
    case 'setbackTower': {
      const n = district === 'midtown' ? 2 : m.h < 90 ? 3 : rng.int(3, 5);
      const ratios = n === 2 ? [0.7, 0.3] : [...SETBACK_RATIOS.slice(0, n - 1), 0.15];
      const chamfered = rng.chance(0.5);
      const tiers = setbackStack(
        m,
        rng,
        0,
        m.w,
        m.d,
        ratios,
        chamfered ? 'chamfer' : 'box',
        rng.range(1.5, 3),
      );
      return { tiers, spireH: rng.chance(0.5) ? m.h * rng.range(0.06, 0.12) : 0 };
    }
    case 'cylinderTower': {
      const y1 = m.baseY + m.h * 0.88;
      const dia = Math.min(m.w, m.d);
      return {
        tiers: [
          tier(m, 0, dia, dia, m.baseY, y1, 'cylinder', 0),
          tier(m, 0, dia * 0.7, dia * 0.7, y1, top, 'cylinder', 0),
        ],
        spireH: 0,
      };
    }
    case 'bracedTower':
      return { tiers: box(), spireH: rng.chance(0.3) ? m.h * rng.range(0.05, 0.1) : 0 };
    case 'cantileverTower': {
      const podiumH = Math.min(rng.range(20, 40), m.h * 0.3);
      const inset = Math.min(rng.range(10, 20), (Math.min(m.w, m.d) - 20) / 2);
      const bw = m.w - 2 * Math.max(inset, 0);
      const bd = m.d - 2 * Math.max(inset, 0);
      const tiers = [
        tier(m, 0, m.w, m.d, m.baseY, m.baseY + podiumH, 'box', 0),
        tier(m, 0, bw, bd, m.baseY + podiumH, top, 'box', 0),
      ];
      const side = rng.pick(SIDES);
      const faceW = side === 'px' || side === 'nx' ? bd : bw;
      const y0 = m.baseY + m.h * rng.range(0.45, 0.7);
      const out = Math.min(rng.range(8, 20), inset - 1);
      const y1 = Math.min(y0 + rng.range(12, 30), top - 4);
      // The mass must stay inside the podium footprint; skip it on narrow podiums.
      if (out < 2 || y1 <= y0) return { tiers, spireH: 0 };
      const cant: Cantilever = { side, out, width: faceW * 0.6, y0, y1 };
      return { tiers, cantilever: cant, spireH: 0 };
    }
    case 'twinTower': {
      let gap = rng.range(20, 30);
      let tw = (m.w - gap) / 2;
      if (tw < 14) {
        gap = Math.max(8, m.w - 28);
        tw = (m.w - gap) / 2;
      }
      const off = (gap + tw) / 2;
      const stack = (lx: number): Tier[] => setbackStack(m, rng, lx, tw, m.d, [0.8, 0.2], 'box', 0);
      const y0 = m.baseY + m.h * 0.6;
      return {
        tiers: stack(-off),
        twin: stack(off),
        skybridge: { y0, y1: y0 + 7.2, width: 8 },
        spireH: 0,
      };
    }
    case 'officeSlab':
      return rng.chance(0.3)
        ? { tiers: box('chamfer', Math.min(2, m.w / 4, m.d / 4)), spireH: 0 }
        : { tiers: box(), spireH: 0 };
    default:
      return { tiers: box(), spireH: 0 };
  }
}

// --- Fictional names (no real places, brands or works) ---

const SYL_A = [
  '청',
  '람',
  '운',
  '흑',
  '별',
  '달',
  '새',
  '은',
  '한',
  '솔',
  '빛',
  '누리',
  '가람',
  '미르',
];
const SYL_B = ['하', '산', '림', '광', '경', '안', '원', '성', '진', '명', '도', '현'];
const OFFICE_SUFFIX = ['빌딩', '타워', '센터', '프라자', '회관', '트레이드센터'];
const SANGGA_SUFFIX = ['상가', '전자상가', '시장', '아케이드', '빌딩'];

/** Fictional megacorps (ART_DIRECTION 5.3). */
export const CORPS = [
  '연무중공업',
  '휘광바이오',
  '심연통신',
  '하운금융',
  'teraSHIN 반도체',
  '청람로보틱스',
] as const;

export function fictionalName(rng: Rng, archetype: Archetype): string {
  const stem = `${rng.pick(SYL_A)}${rng.pick(SYL_B)}`;
  switch (archetype) {
    case 'sangga':
      return `${stem}${rng.pick(SANGGA_SUFFIX)}`;
    case 'hillHouse':
      return `별계단동 ${rng.int(1, 300)}번지`;
    case 'warehouse':
      return `운해물류 제${rng.int(1, 40)}창고`;
    case 'pavilion':
      return `${stem} 강변 매점`;
    default:
      return `${stem}${rng.pick(OFFICE_SUFFIX)}`;
  }
}

/** Tags/fields of a spec that depend only on the massing (used by the generator). */
export type SpecCore = Omit<BuildingSpec, 'tiers' | 'twin' | 'skybridge' | 'cantilever' | 'spireH'>;
