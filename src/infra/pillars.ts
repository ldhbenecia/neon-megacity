// Highway pillars (ART_DIRECTION 2.5): Y section under the 내부순환로 main legs, T section under
// 강변북로 and every ramp. Positions come from the layout (`hw.pillars`); this file only adds the shape,
// orientation and the filters that keep pillars out of other decks. Pure.
import { surfaceHeight, type Highway, type Layout } from '../city/layout';
import { obbOverlap } from '../city/math';
import { frameAt, norm, sub, type V3 } from './mesh';
import type { BeamInstance, ColumnInstance } from './parts';
import { rotYForLateral } from './parts';
import { DECK_THICKNESS } from './profile';
import { SAME_LEVEL, hwPath, nearestOnPath, type HwPath } from './highways';

export type PillarKind = 'T' | 'Y';

export interface PillarSpec {
  owner: string;
  kind: PillarKind;
  x: number;
  z: number;
  /** Ground under the pillar and the deck surface above it. */
  footY: number;
  deckY: number;
  /** Unit lateral (horizontal, right of travel). */
  lat: V3;
  rotY: number;
  /** Column cross-section: lateral × along. */
  colW: number;
  colD: number;
  /** Highway width (sizes the cap / arms). */
  deckW: number;
}

/** Highway names (SEOUL.md 5.3) that stand on Y pillars; their ramps keep T pillars. */
const Y_PILLAR_ROADS: ReadonlySet<string> = new Set(['내부순환로']);

export function pillarKind(hw: Pick<Highway, 'name' | 'kind'>): PillarKind {
  return hw.kind !== 'ramp' && Y_PILLAR_ROADS.has(hw.name) ? 'Y' : 'T';
}

/** Column cross-section by highway (m): lateral × along. */
export function columnSize(hw: Pick<Highway, 'kind' | 'width'>): { w: number; d: number } {
  if (hw.kind === 'ramp') return { w: 1.8, d: 1.8 };
  return hw.width >= 24 ? { w: 3.2, d: 2.4 } : { w: 2.6, d: 2.6 };
}

/** Tangent of a path near (x, z), from the nearest pair of samples. */
function tangentNear(path: HwPath, x: number, z: number): V3 {
  let best = Infinity;
  let bi = 0;
  path.pts.forEach((p, i) => {
    const d = (p[0] - x) ** 2 + (p[2] - z) ** 2;
    if (d < best) {
      best = d;
      bi = i;
    }
  });
  const a = path.pts[Math.max(0, bi - 1)] as V3;
  const b = path.pts[Math.min(path.pts.length - 1, bi + 1)] as V3;
  return norm(sub(b, a));
}

const columnObb = (p: PillarSpec) => ({
  x: p.x,
  z: p.z,
  hw: p.colW / 2,
  hd: p.colD / 2,
  rotY: p.rotY,
});

/** Shortest column above the ground (m) under the cap or Y arms; below this the deck rests on the slope. */
const MIN_COLUMN_H = 0.5;

/**
 * Pillar specs for every raised highway. Dropped: pillars whose column above the ground (to the
 * cap or Y arms) would be MIN_COLUMN_H or shorter, ramp pillars standing inside another deck at
 * the same level (the parent's own pillars carry the junction), any pillar whose column would
 * pierce a lower deck, and pillars whose column overlaps one already accepted.
 */
export function pillarSpecs(
  L: Layout,
  paths: readonly HwPath[] = L.highways.map((hw) => hwPath(hw)),
): PillarSpec[] {
  const out: PillarSpec[] = [];
  for (const path of paths) {
    const hw = path.hw;
    if (hw.kind === 'atGrade' || hw.pillars.length === 0) continue;
    const size = columnSize(hw);
    for (const pl of hw.pillars) {
      const f = frameAt([pl.x, pl.y, pl.z], tangentNear(path, pl.x, pl.z));
      const spec: PillarSpec = {
        owner: hw.id,
        kind: pillarKind(hw),
        x: pl.x,
        z: pl.z,
        footY: surfaceHeight(pl.x, pl.z),
        deckY: pl.y,
        lat: f.lat,
        rotY: rotYForLateral(f.lat),
        colW: size.w,
        colD: size.d,
        deckW: hw.width,
      };
      let ok = columnTop(spec) - spec.footY > MIN_COLUMN_H;
      for (const o of paths) {
        if (o.hw.id === hw.id || o.hw.kind === 'atGrade') continue;
        const q = nearestOnPath(o, pl.x, pl.z);
        if (q.d > o.hw.width / 2 + Math.max(size.w, size.d)) continue;
        const sameLevel = Math.abs(q.y - pl.y) <= SAME_LEVEL;
        // A ramp pillar inside its parent deck, or a column passing through a lower deck.
        if ((sameLevel && hw.kind === 'ramp') || q.y < pl.y - SAME_LEVEL) ok = false;
      }
      if (ok && out.some((p) => obbOverlap(columnObb(p), columnObb(spec), 0.5))) ok = false;
      if (ok) out.push(spec);
    }
  }
  return out;
}

/** Column top world y: under the cap (T) or where the Y arms start. */
export function columnTop(p: PillarSpec): number {
  const under = p.deckY - DECK_THICKNESS;
  return p.kind === 'T' ? under - capHeight(p) : under - Y_ARM_RISE;
}

const capHeight = (p: PillarSpec): number => (p.deckW >= 24 ? 2.0 : 1.4);
const Y_ARM_RISE = 4.5;

/** Instances for one pillar: its column plus the T cap beam or the two Y arms. */
export function pillarInstances(p: PillarSpec): { column: ColumnInstance; beams: BeamInstance[] } {
  const under = p.deckY - DECK_THICKNESS;
  const top = columnTop(p);
  const column: ColumnInstance = {
    x: p.x,
    z: p.z,
    y0: p.footY - 1,
    y1: top + 0.05,
    w: p.colW,
    d: p.colD,
    rotY: p.rotY,
    owner: p.owner,
  };
  const beams: BeamInstance[] = [];
  if (p.kind === 'T') {
    const h = capHeight(p);
    beams.push({
      center: [p.x, under - h / 2, p.z],
      size: [p.deckW * 0.58, h, p.colD + 0.4],
      rotY: p.rotY,
      roll: 0,
    });
  } else {
    // Y: two arms from the column head to under the deck, plus a tie beam.
    const reach = p.deckW * 0.26;
    const len = Math.hypot(reach, Y_ARM_RISE);
    for (const sgn of [-1, 1] as const) {
      const cx = p.x + p.lat[0] * sgn * (reach / 2);
      const cz = p.z + p.lat[2] * sgn * (reach / 2);
      beams.push({
        center: [cx, top + Y_ARM_RISE / 2, cz],
        size: [len + 0.6, 1.3, p.colD * 0.8],
        rotY: p.rotY,
        roll: sgn * Math.atan2(Y_ARM_RISE, reach),
      });
    }
    beams.push({
      center: [p.x, under - 0.4, p.z],
      size: [reach * 2 + 1.6, 0.8, p.colD * 0.8],
      rotY: p.rotY,
      roll: 0,
    });
  }
  return { column, beams };
}
