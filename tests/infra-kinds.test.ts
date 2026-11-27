// Layout v3 bridge kinds (SEOUL.md 3.3), tunnel portals, sparse highway rings and the geometry
// guards against NaN in shaders (unit normals, no zero-scale instances).
import { describe, expect, it } from 'vitest';
import { CITY, LAYOUT, RIVER, islandAt, type Bridge } from '../src/city/layout';
import { archSpans } from '../src/infra/bridgeArches';
import {
  bridgeFrame,
  bridgePoint,
  bridgeShape,
  buildBridge,
  islandRange,
  lowerDeckAt,
  pierStations,
  spanList,
  type BridgeFrame,
} from '../src/infra/bridges';
import { trussPlanes } from '../src/infra/bridgeTrusses';
import { buildInfra } from '../src/infra/build';
import { infraColors } from '../src/infra/colors';
import { deckRings, hwPath, sparseRings } from '../src/infra/highways';
import type { MeshData } from '../src/infra/mesh';
import { createParts, type InfraParts } from '../src/infra/parts';
import { DECK_THICKNESS } from '../src/infra/profile';

const C = infraColors();
const paths = LAYOUT.highways.map((hw) => hwPath(hw));
const bridge = (id: string): Bridge => LAYOUT.bridges.find((b) => b.id === id)!;

function build(b: Bridge): InfraParts {
  const parts = createParts();
  buildBridge(b, parts, C, LAYOUT.roads, paths);
  return parts;
}

/** Vertices of `m` as (s along the bridge, y). */
function sy(m: MeshData, f: BridgeFrame): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < m.positions.length; i += 3) {
    const x = m.positions[i]! - f.mid[0];
    const z = m.positions[i + 2]! - f.mid[2];
    out.push([x * f.u[0] + z * f.u[2], m.positions[i + 1]!]);
  }
  return out;
}

describe('infra kinds: layout v3 bridges', () => {
  it('every layout bridge builds with its own kind', () => {
    for (const b of LAYOUT.bridges) expect(bridgeShape(b), b.id).toBe(b.kind);
  });

  it('한강대교 and 한강철교 stop on 노들섬: piers on its edges, no structure over it', () => {
    for (const id of ['br-hangang', 'br-hangang-rail']) {
      const b = bridge(id);
      const f = bridgeFrame(b);
      const isl = islandRange(b, f);
      expect(isl, id).toBeDefined();
      const stations = pierStations(b, f);
      expect(stations).toHaveLength(b.spans - 1);
      expect(stations).toContain(isl!.s0);
      expect(stations).toContain(isl!.s1);
      // The island lies under some part of the deck width at both piers and in between.
      for (const s of [isl!.s0, isl!.s1, (isl!.s0 + isl!.s1) / 2]) {
        const ids = [-b.width / 2, 0, b.width / 2].map((l) => {
          const p = bridgePoint(f, s, l, 0);
          return islandAt(p[0], p[2])?.id;
        });
        expect(ids, `${id} at ${s}`).toContain('nodeul');
      }
      const over = sy(build(b).steel, f).filter(
        ([s, y]) => s > isl!.s0 + 1 && s < isl!.s1 - 1 && y > b.deckY + 2,
      );
      expect(over, id).toHaveLength(0);
    }
  });

  it('marsh and park islands pass under the structure', () => {
    for (const id of ['br-seogang', 'br-yanghwa']) {
      const b = bridge(id);
      expect(islandRange(b, bridgeFrame(b)), id).toBeUndefined();
    }
  });

  it('서강대교 has one landmark arch over the middle span; 양화대교 arches every span', () => {
    const seogang = bridge('br-seogang');
    const f = bridgeFrame(seogang);
    const spans = spanList(seogang, f);
    const arched = archSpans(spans, seogang.structureH);
    expect(arched).toHaveLength(1);
    expect(arched[0]).toBe(spans[1]);
    const steel = sy(build(seogang).steel, f);
    const top = Math.max(...steel.map(([, y]) => y));
    expect(top).toBeGreaterThan(seogang.deckY + seogang.structureH);
    expect(top).toBeLessThan(seogang.deckY + seogang.structureH + 2);
    for (const [s, y] of steel) {
      if (y > seogang.deckY + 3) {
        expect(s).toBeGreaterThan(arched[0]!.s0 - 1);
        expect(s).toBeLessThan(arched[0]!.s1 + 1);
      }
    }
    const yanghwa = bridge('br-yanghwa');
    const ys = spanList(yanghwa, bridgeFrame(yanghwa));
    expect(archSpans(ys, yanghwa.structureH)).toHaveLength(ys.length);
  });

  it('성산대교 deck arches stay between the water and the deck underside', () => {
    const b = bridge('br-seongsan');
    const f = bridgeFrame(b);
    const steel = sy(build(b).steel, f);
    expect(steel.length).toBeGreaterThan(0);
    for (const [, y] of steel) {
      expect(y).toBeGreaterThan(RIVER.waterY);
      expect(y).toBeLessThan(b.deckY - DECK_THICKNESS);
    }
  });

  it('올림픽대교 stands a pylon with a ring on every river pier', () => {
    const b = bridge('br-olympic');
    const f = bridgeFrame(b);
    const parts = build(b);
    const piers = parts.columns.filter((c) => c.y0 === -8);
    expect(piers).toHaveLength(b.spans - 1);
    const ringY = b.deckY + b.structureH + 1;
    const ring = sy(parts.glow, f).filter(([, y]) => Math.abs(y - ringY) < 0.5);
    for (const c of piers) {
      const s = (c.x - f.mid[0]) * f.u[0] + (c.z - f.mid[2]) * f.u[2];
      expect(ring.some(([q]) => Math.abs(q - s) < 5)).toBe(true);
    }
    // The mast rises above the ring.
    const top = Math.max(...sy(parts.concrete, f).map(([, y]) => y));
    expect(top).toBeGreaterThan(b.deckY + b.structureH);
  });

  it('한강철교 has a truss plane between every pair of tracks', () => {
    const b = bridge('br-hangang-rail');
    expect(trussPlanes(b)).toHaveLength(b.lanes + 1);
    expect(trussPlanes(bridge('br-seongsu'))).toHaveLength(2);
  });

  it('잠수교 rises mid-span and keeps headroom under 반포대교', () => {
    const b = bridge('br-banpo');
    const f = bridgeFrame(b);
    const low = b.lowerDeckY!;
    expect(lowerDeckAt(b, f, low, f.spanHalf)).toBe(low);
    const mid = lowerDeckAt(b, f, low, 0);
    expect(mid).toBeGreaterThan(low + 3);
    expect(b.deckY - DECK_THICKNESS - (mid + 1.2)).toBeGreaterThanOrEqual(5 - 1e-9);
    // 청담대교's subway deck is high above the water: flat.
    const cd = bridge('br-cheongdam');
    expect(lowerDeckAt(cd, bridgeFrame(cd), cd.lowerDeckY!, 0)).toBe(cd.lowerDeckY);
  });
});

describe('infra: tunnel portals and sparse rings', () => {
  const parts = buildInfra(LAYOUT, C);

  it('내부순환로 ends in a tunnel portal at the north edge, lamps lit', () => {
    const lamps = parts.points.filter((p) => p.color === C.tunnelLamp);
    for (const id of ['hw-naebu-w', 'hw-naebu-e']) {
      const end = LAYOUT.highways.find((hw) => hw.id === id)!.points;
      const north = end.reduce((a, b) => (b.z < a.z ? b : a));
      const near = lamps.filter((p) => Math.hypot(p.p[0] - north.x, p.p[2] - north.z) < 120);
      expect(near.length, id).toBeGreaterThan(3);
      for (const p of near) expect(Math.abs(p.p[2])).toBeLessThan(CITY.halfZ + 20);
    }
  });

  it('sparse rings keep the ends and every flag change, and drop most rings on 강변북로', () => {
    const path = paths.find((p) => p.hw.id === 'hw-river-north')!;
    const rings = deckRings(path, paths);
    const sparse = sparseRings(rings);
    expect(sparse[0]).toBe(rings[0]);
    expect(sparse[sparse.length - 1]).toBe(rings[rings.length - 1]);
    expect(sparse.length).toBeLessThan(rings.length * 0.6);
    const kept = new Set(sparse);
    for (let i = 1; i < rings.length; i++) {
      const a = rings[i - 1]!;
      const b = rings[i]!;
      if (a.barrierL !== b.barrierL || a.barrierR !== b.barrierR || a.hidden !== b.hidden) {
        expect(kept.has(a) && kept.has(b)).toBe(true);
      }
    }
  });
});

describe('infra: no NaN sources for the shaders', () => {
  const parts = buildInfra(LAYOUT, C);
  const meshes = (p: InfraParts): MeshData[] => [
    p.concrete,
    p.steel,
    p.markings,
    p.glow,
    p.wash,
    ...p.bridgeDetail.flatMap((d) => [d.steel, d.glow, d.markings]),
  ];

  it('every vertex normal is unit length (normalize(0) is NaN on the GPU)', () => {
    for (const m of meshes(parts)) {
      for (let i = 0; i < m.normals.length; i += 3) {
        const l = Math.hypot(m.normals[i]!, m.normals[i + 1]!, m.normals[i + 2]!);
        expect(Math.abs(l - 1)).toBeLessThan(1e-6);
      }
    }
  });

  it('no instance has a zero scale (its normal matrix would divide by zero)', () => {
    for (const c of parts.columns) {
      expect(c.y1 - c.y0, c.owner).toBeGreaterThan(0.1);
      expect(Math.min(c.w, c.d), c.owner).toBeGreaterThan(0.1);
    }
    for (const b of parts.beams) for (const v of b.size) expect(v).toBeGreaterThan(0.01);
    for (const p of parts.points) for (const v of p.size) expect(v).toBeGreaterThan(0.01);
  });
});
