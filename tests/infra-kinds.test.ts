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
  fountainNozzles,
  islandRange,
  lowerDeckAt,
  pierStations,
  railTracks,
  spanList,
  type BridgeFrame,
} from '../src/infra/bridges';
import { trussPlanes } from '../src/infra/bridgeTrusses';
import { buildInfra } from '../src/infra/build';
import { infraColors } from '../src/infra/colors';
import { deckRings, hwPath, sparseRings, visiblePoints } from '../src/infra/highways';
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

describe('infra: geometry neon matches (InfraApi)', () => {
  it('rail tracks: 한강철교 4, 동호대교 2 in the middle, 청담대교 2 on the lower deck', () => {
    const count = Object.fromEntries(LAYOUT.bridges.map((b) => [b.id, railTracks(b).length]));
    expect(count['br-hangang-rail']).toBe(4);
    expect(count['br-dongho']).toBe(2);
    expect(count['br-cheongdam']).toBe(2);
    for (const b of LAYOUT.bridges) if (!b.rail) expect(count[b.id], b.id).toBe(0);
    const cd = bridge('br-cheongdam');
    for (const t of railTracks(cd)) {
      for (const p of t) expect(p[1]).toBeCloseTo(cd.lowerDeckY! + 0.41, 9);
    }
    // 동호대교's tracks sit inside its center bed, on the deck and its ramps.
    const dh = bridge('br-dongho');
    const f = bridgeFrame(dh);
    for (const t of railTracks(dh)) {
      const l = (t[0]![0] - f.mid[0]) * f.v[0] + (t[0]![2] - f.mid[2]) * f.v[2];
      expect(Math.abs(l)).toBeLessThan(4);
      expect(Math.max(...t.map((p) => p[1]))).toBeCloseTo(dh.deckY + 0.46, 9);
      expect(Math.min(...t.map((p) => p[1]))).toBeLessThan(1);
    }
  });

  it('fountain nozzles run along both upper deck edges of 반포대교, facing out', () => {
    const b = bridge('br-banpo');
    const f = bridgeFrame(b);
    const lines = fountainNozzles(b);
    expect(lines).toHaveLength(2);
    for (const q of lines) {
      expect(q.a[1]).toBeCloseTo(b.deckY - 0.3, 9);
      const l = (q.a[0] - f.mid[0]) * f.v[0] + (q.a[2] - f.mid[2]) * f.v[2];
      expect(Math.abs(l)).toBeCloseTo(b.width / 2 + 0.05, 6);
      expect(Math.sign(q.outward[0] * f.v[0] + q.outward[2] * f.v[2])).toBe(Math.sign(l));
    }
    for (const o of LAYOUT.bridges)
      if (o.motif !== 'fountain') expect(fountainNozzles(o)).toEqual([]);
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
    // Dashes ride the true curve 0.02 m up: the sparse chords must not sag above it by that much.
    for (let j = 0; j < sparse.length - 1; j++) {
      const a = sparse[j]!.p;
      const b = sparse[j + 1]!.p;
      const i0 = rings.indexOf(sparse[j]!);
      const i1 = rings.indexOf(sparse[j + 1]!);
      for (let i = i0 + 1; i < i1; i++) {
        const p = rings[i]!.p;
        const u =
          Math.hypot(p[0] - a[0], p[2] - a[2]) / (Math.hypot(b[0] - a[0], b[2] - a[2]) || 1);
        expect(Math.abs(a[1] + (b[1] - a[1]) * u - p[1])).toBeLessThan(0.015);
      }
    }
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

describe('infra: traffic curves stop where the decks stop', () => {
  const inMap = (p: readonly number[], pad: number): boolean =>
    Math.abs(p[0]!) <= CITY.halfX + pad && Math.abs(p[2]!) <= CITY.halfZ + pad;

  it('each highway has one drawn stretch; its curve covers it and nothing beyond', () => {
    for (const path of paths) {
      const vis = visiblePoints(path);
      const inside = path.pts.filter((p) => inMap(p, 10));
      expect(path.hw.closed, path.hw.id).toBe(false);
      // One run: every sample inside the map is on the curve (no second stretch dropped).
      const onCurve = vis.filter((p) => inMap(p, 10));
      expect(onCurve.length, path.hw.id).toBe(inside.length);
      // Only a tunnel portal extension may poke past the pad, by PORTAL_TRAFFIC.
      for (const p of vis) expect(inMap(p, 10 + 6 + 1e-6), path.hw.id).toBe(true);
    }
  });

  it('a closed highway lies wholly inside the map (its drawn range is every sample)', () => {
    // drawn = longest in-map run equals the old per-ring test only with one run per open road
    // (above) and no closed road leaving the map.
    for (const path of paths.filter((p) => p.hw.closed)) {
      for (const p of path.pts) expect(inMap(p, 10), path.hw.id).toBe(true);
    }
  });

  it('every placed bridge column lies inside the landA–landB box pushPiers prefilters with', () => {
    const parts = buildInfra(LAYOUT, C);
    for (const b of LAYOUT.bridges) {
      const pad = b.width;
      const minX = Math.min(b.landA.x, b.landB.x) - pad;
      const maxX = Math.max(b.landA.x, b.landB.x) + pad;
      const minZ = Math.min(b.landA.z, b.landB.z) - pad;
      const maxZ = Math.max(b.landA.z, b.landB.z) + pad;
      for (const c of parts.columns.filter((q) => q.owner === b.id)) {
        expect(c.x >= minX && c.x <= maxX && c.z >= minZ && c.z <= maxZ, b.id).toBe(true);
      }
    }
  });

  it('내부순환로 traffic ends inside its tunnel portal block', () => {
    for (const id of ['hw-naebu-w', 'hw-naebu-e']) {
      const vis = visiblePoints(paths.find((p) => p.hw.id === id)!);
      const north = vis.reduce((a, b) => (b[2] < a[2] ? b : a));
      expect(north[2]).toBeLessThan(-CITY.halfZ);
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
