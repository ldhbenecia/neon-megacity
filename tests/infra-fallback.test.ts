// Bridges and highways of kinds infra does not know yet (layout v3) must still build: they fall
// back to a plain girder that handles any span, width, deck height, asymmetric ramps and a
// lower deck. Layout v2 bridges keep their own shapes.
import { describe, expect, it } from 'vitest';
import {
  LAYOUT,
  RIVER,
  bridgeDeckY,
  riverFrame,
  type Bridge,
  type Highway,
  type Vec3,
} from '../src/city/layout';
import {
  bridgeFrame,
  bridgePoint,
  bridgeShape,
  buildBridge,
  deckYAt,
  lowerDeckY,
  pierStations,
  spanCount,
} from '../src/infra/bridges';
import { buildInfra } from '../src/infra/build';
import { infraColors } from '../src/infra/colors';
import { hwPath, nearestOnPath, type HwPath } from '../src/infra/highways';
import { MeshData } from '../src/infra/mesh';
import { createParts, type ColumnInstance, type InfraParts } from '../src/infra/parts';
import { DECK_THICKNESS } from '../src/infra/profile';

const C = infraColors();
const unknownKind = (k: string): Bridge['kind'] => k as Bridge['kind'];

interface Spec {
  kind: string;
  /** Abutments and landings, m from the river centerline (north negative). */
  half: number;
  landA: number;
  landB: number;
  deckY: number;
  width: number;
  lanes: number;
  lowerDeckY?: number;
  /** Layout span count; defaults to about 70 m spans. */
  spans?: number;
}

/** Point `k` m south of the v2 river centerline at x, plus `l` m along the river. */
function riverPoint(x: number, k: number, l = 0): { x: number; z: number } {
  const { p, south, along } = riverFrame(x);
  return { x: p.x + south.x * k + along.x * l, z: p.z + south.z * k + along.z * l };
}

/** A synthetic bridge across the v2 river at x, perpendicular to the centerline. */
function makeBridge(x: number, s: Spec): Bridge {
  // Spread a layout bridge so fields this test does not care about stay valid.
  const b: Bridge = {
    ...LAYOUT.bridges[0]!,
    id: `test-${s.kind}`,
    kind: unknownKind(s.kind),
    a: riverPoint(x, -s.half),
    b: riverPoint(x, s.half),
    landA: riverPoint(x, -s.landA),
    landB: riverPoint(x, s.landB),
    deckY: s.deckY,
    width: s.width,
    lanes: s.lanes,
    structureH: 0,
    spans: s.spans ?? Math.max(2, Math.round((2 * s.half) / 70)),
  };
  delete b.lowerDeckY;
  if (s.lowerDeckY !== undefined) b.lowerDeckY = s.lowerDeckY;
  return b;
}

/** A straight highway path through `pts` at height y. */
function straightHighway(pts: { x: number; z: number }[], y: number, width: number): HwPath {
  const base = LAYOUT.highways.find((hw) => hw.kind !== 'atGrade')!;
  const points: Vec3[] = pts.map((p) => ({ x: p.x, y, z: p.z }));
  return hwPath({ ...base, id: 'hw-test', points, closed: false, width, pillars: [] });
}

function expectFinite(parts: InfraParts): void {
  const detail = parts.bridgeDetail.flatMap((d) => [d.steel, d.glow, d.markings]);
  for (const m of [
    parts.concrete,
    parts.steel,
    parts.markings,
    parts.glow,
    parts.wash,
    ...detail,
  ]) {
    for (const arr of [m.positions, m.normals, m.colors]) {
      expect(arr.every(Number.isFinite)).toBe(true);
    }
    expect(m.indices.every((i) => i >= 0 && i < m.vertexCount)).toBe(true);
  }
  for (const c of parts.columns) {
    expect([c.x, c.z, c.y0, c.y1, c.w, c.d, c.rotY].every(Number.isFinite)).toBe(true);
    expect(c.y1).toBeGreaterThan(c.y0);
  }
  for (const q of parts.points) expect([...q.p, ...q.size].every(Number.isFinite)).toBe(true);
}

const maxY = (m: MeshData): number => {
  let y = -Infinity;
  for (let i = 1; i < m.positions.length; i += 3) y = Math.max(y, m.positions[i]!);
  return y;
};

/** Grid of points over a column footprint, edges included. */
function footprint(c: ColumnInstance): { x: number; z: number }[] {
  const cos = Math.cos(c.rotY);
  const sin = Math.sin(c.rotY);
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 2; j++) {
      const lx = (i / 8 - 0.5) * c.w;
      const lz = (j / 2 - 0.5) * c.d;
      out.push({ x: c.x + cos * lx + sin * lz, z: c.z - sin * lx + cos * lz });
    }
  }
  return out;
}

/** No footprint point of `c` lies on a highway deck that runs below the column top. */
function expectClearOfHighways(c: ColumnInstance, paths: readonly HwPath[]): void {
  for (const q of footprint(c)) {
    for (const path of paths) {
      const n = nearestOnPath(path, q.x, q.z);
      if (n.y >= c.y1) continue;
      expect(n.d, `${c.owner} pier on ${path.hw.id}`).toBeGreaterThan(path.hw.width / 2);
    }
  }
}

const CASES: Spec[] = [
  { kind: 'cableStayed', half: 420, landA: 520, landB: 700, deckY: 14, width: 30, lanes: 6 },
  { kind: 'deckArch', half: 300, landA: 360, landB: 480, deckY: 16, width: 28, lanes: 6 },
  { kind: 'tiedArch', half: 150, landA: 190, landB: 300, deckY: 12, width: 32, lanes: 8 },
  { kind: 'girder', half: 120, landA: 180, landB: 260, deckY: 11, width: 12, lanes: 0 },
  {
    kind: 'mystery',
    half: 500,
    landA: 600,
    landB: 760,
    deckY: 16,
    width: 30,
    lanes: 6,
    lowerDeckY: -1,
    spans: 9,
  },
];

describe('infra fallback: bridge kinds', () => {
  it('keeps the v2 shapes and maps every other kind to girder', () => {
    const v2 = new Set<string>(['arch', 'truss', 'doubleDeck']);
    for (const k of v2) expect(bridgeShape(makeBridge(0, { ...CASES[3]!, kind: k }))).toBe(k);
    for (const k of ['deckArch', 'tiedArch', 'girder', 'cableStayed', 'mystery', '']) {
      expect(bridgeShape(makeBridge(0, { ...CASES[0]!, kind: k }))).toBe('girder');
    }
  });

  it('v2 piers stay where they were (240 m span, v2 span counts)', () => {
    const want: [string, number, number[]][] = [
      ['arch', 2, [0]],
      ['truss', 3, [-40, 40]],
      ['doubleDeck', 6, [-80, -40, 0, 40, 80]],
    ];
    for (const [kind, spans, exp] of want) {
      const b = makeBridge(0, { ...CASES[3]!, kind, spans });
      const got = pierStations(b, bridgeFrame(b));
      expect(got).toHaveLength(exp.length);
      got.forEach((s, i) => expect(s).toBeCloseTo(exp[i]!, 9));
    }
  });

  it('reads the layout span count, clamped to the shape minimum; arch always has two', () => {
    const b = makeBridge(-200, { ...CASES[0]!, spans: 9 });
    const f = bridgeFrame(b);
    expect(spanCount(b, f)).toBe(9);
    expect(spanCount({ ...b, spans: 1e7 }, f)).toBe(Math.floor((2 * f.spanHalf) / 10));
    expect(spanCount({ ...b, spans: 3.6 }, f)).toBe(4);
    for (const bad of [1, 0, -3]) {
      expect(spanCount({ ...b, spans: bad }, f)).toBe(2);
      expect(pierStations({ ...b, spans: bad }, f)).toHaveLength(1);
    }
    expect(spanCount({ ...b, spans: Number.NaN }, f)).toBe(
      Math.max(2, Math.round((2 * f.spanHalf) / 70)),
    );
    // Short span: the length fallback alone would give 1.
    const short = makeBridge(-200, { ...CASES[3]!, half: 30, landA: 60, landB: 90 });
    expect(spanCount({ ...short, spans: Number.POSITIVE_INFINITY }, bridgeFrame(short))).toBe(2);
    const truss = makeBridge(0, { ...CASES[3]!, kind: 'truss', spans: 2 });
    expect(spanCount(truss, bridgeFrame(truss))).toBe(3);
    const arch = makeBridge(0, { ...CASES[3]!, kind: 'arch', spans: 7 });
    expect(spanCount(arch, bridgeFrame(arch))).toBe(2);
  });

  it.each(CASES)('$kind builds a finite girder with evenly spaced river piers', (s) => {
    const b = makeBridge(-200, s);
    const f = bridgeFrame(b);
    const parts = createParts();
    buildBridge(b, parts, C);
    expectFinite(parts);

    const n = spanCount(b, f);
    if (s.spans !== undefined) expect(n).toBe(s.spans);
    expect(n).toBeGreaterThanOrEqual(2);
    const stations = pierStations(b, f);
    expect(stations).toHaveLength(n - 1);
    const gap = (2 * f.spanHalf) / n;
    [-f.spanHalf, ...stations, f.spanHalf].reduce((prev, cur) => {
      expect(cur - prev).toBeCloseTo(gap, 6);
      return cur;
    });

    // With nothing to avoid, every river pier stands and reaches the lowest deck's underside.
    const top = (lowerDeckY(b) ?? b.deckY) - DECK_THICKNESS;
    const river = parts.columns.filter((c) => c.y0 === -8);
    expect(river).toHaveLength(n - 1);
    for (const c of river) expect(c.y1).toBeCloseTo(top, 9);

    // Deck profile follows the layout, asymmetric landings included.
    expect(-f.landA).toBeCloseTo(s.landA, 6);
    expect(f.landB).toBeCloseTo(s.landB, 6);
    for (let k = f.landA + 1; k < f.landB; k += 9) {
      const p = bridgePoint(f, k, 0, 0);
      expect(Math.abs(deckYAt(b, f, k) - bridgeDeckY(b, p[0], p[2])!)).toBeLessThan(0.01);
    }
    expect(maxY(parts.concrete)).toBeLessThan(s.deckY + 1);
    expect(maxY(parts.steel)).toBeLessThan(s.deckY + 1.5);
  });

  it('draws a lower deck and skips uplights when it sits too close to the water', () => {
    const s = CASES[4]!;
    const b = makeBridge(-200, s);
    const parts = createParts();
    buildBridge(b, parts, C);
    expect(parts.wash.vertexCount).toBe(0);
    let lower = 0;
    for (let i = 1; i < parts.concrete.positions.length; i += 3) {
      if (Math.abs(parts.concrete.positions[i]! - s.lowerDeckY!) < 1e-6) lower++;
    }
    expect(lower).toBeGreaterThan(0);
    expect(RIVER.waterY).toBeLessThan(s.lowerDeckY!);
  });

  it('a single-deck fallback bridge lights its piers', () => {
    const parts = createParts();
    buildBridge(makeBridge(-200, CASES[0]!), parts, C);
    expect(parts.wash.vertexCount).toBeGreaterThan(0);
  });

  it('arch ignores lowerDeckY, so no lower road runs through its center pier', () => {
    const arch: Bridge = { ...makeBridge(0, { ...CASES[3]!, kind: 'arch' }), structureH: 36 };
    const withLower: Bridge = { ...arch, lowerDeckY: 4 };
    expect(lowerDeckY(withLower)).toBeUndefined();
    const a = createParts();
    const b = createParts();
    buildBridge(arch, a, C);
    buildBridge(withLower, b, C);
    expect(b).toEqual(a);
  });
});

describe('infra fallback: deck rings near slope breaks', () => {
  it('keeps consistent winding when an abutment lands a hair off a 6 m station', () => {
    for (const d of [0.003, 0.027, 0.4, 0.97, 3]) {
      const half = 192 + d;
      const b = makeBridge(-200, { ...CASES[0]!, half, landA: half + 100, landB: half + 256 });
      const parts = createParts();
      buildBridge(b, parts, C);
      const m = parts.concrete;
      const v = (i: number) => [
        m.positions[i * 3]!,
        m.positions[i * 3 + 1]!,
        m.positions[i * 3 + 2]!,
      ];
      let bad = 0;
      for (let t = 0; t < m.indices.length; t += 3) {
        const [p, q, r] = [v(m.indices[t]!), v(m.indices[t + 1]!), v(m.indices[t + 2]!)];
        const e1 = [q[0]! - p[0]!, q[1]! - p[1]!, q[2]! - p[2]!];
        const e2 = [r[0]! - p[0]!, r[1]! - p[1]!, r[2]! - p[2]!];
        const fn = [
          e1[1]! * e2[2]! - e1[2]! * e2[1]!,
          e1[2]! * e2[0]! - e1[0]! * e2[2]!,
          e1[0]! * e2[1]! - e1[1]! * e2[0]!,
        ];
        const l = Math.hypot(fn[0]!, fn[1]!, fn[2]!);
        if (l < 1e-9) continue;
        const i = m.indices[t]! * 3;
        const dotN =
          (fn[0]! * m.normals[i]! + fn[1]! * m.normals[i + 1]! + fn[2]! * m.normals[i + 2]!) / l;
        if (dotN <= 0.5) bad++;
      }
      expect(bad, `abutment ${d} m past a station`).toBe(0);
    }
  });
});

describe('infra fallback: piers and highways', () => {
  const paths = LAYOUT.highways.map((hw) => hwPath(hw));

  it('no pier footprint (river or approach) stands on a highway running below it', () => {
    for (const s of CASES) {
      const parts = createParts();
      // Wider than the v2 channel: some river piers land on the riverside highways.
      buildBridge(makeBridge(400, s), parts, C, LAYOUT.roads, paths);
      for (const c of parts.columns) expectClearOfHighways(c, paths);
    }
    for (const b of LAYOUT.bridges) {
      const parts = createParts();
      buildBridge(b, parts, C, LAYOUT.roads, paths);
      for (const c of parts.columns) expectClearOfHighways(c, paths);
    }
  });

  it('checks the whole rotated footprint, not just the pier center', () => {
    // A narrow at-grade road along the bridge axis, under one end of each approach pier.
    const s = CASES[0]!;
    const b = makeBridge(-200, s);
    const l = (s.width * 0.55) / 2 - 1;
    const road = straightHighway(
      [riverPoint(-200, s.half, l), riverPoint(-200, s.landB, l)],
      0.3,
      4,
    );
    const free = createParts();
    buildBridge(b, free, C);
    const blocked = createParts();
    buildBridge(b, blocked, C, [], [road]);
    const approach = (p: InfraParts) => p.columns.filter((c) => c.y0 !== -8);
    const south = (p: InfraParts) =>
      approach(p).filter(
        (c) => bridgeFrame(b).u[0] * (c.x - b.b.x) + bridgeFrame(b).u[2] * (c.z - b.b.z) > 0,
      );
    expect(south(free).length).toBeGreaterThan(3);
    expect(south(blocked)).toHaveLength(0);
    for (const c of approach(blocked)) expectClearOfHighways(c, [road]);
  });

  it('keeps piers under a highway that passes over the bridge, drops them on one below', () => {
    const s = CASES[0]!;
    const b = makeBridge(-200, s);
    const k = s.half + 55 + 35; // an approach station on the south ramp
    const across = (y: number) =>
      straightHighway([riverPoint(-200, k, -80), riverPoint(-200, k, 80)], y, 20);
    const count = (hw: HwPath) => {
      const parts = createParts();
      buildBridge(b, parts, C, [], [hw]);
      return parts.columns.length;
    };
    const none = createParts();
    buildBridge(b, none, C);
    expect(count(across(40))).toBe(none.columns.length);
    expect(count(across(0.3))).toBe(none.columns.length - 1);
  });
});

describe('infra fallback: whole layout', () => {
  it('builds a layout whose bridges and highways use unknown kinds', () => {
    const L = {
      ...LAYOUT,
      bridges: CASES.map((s, i) => makeBridge(-900 + i * 450, s)),
      highways: LAYOUT.highways.map((hw): Highway =>
        hw.kind === 'elevated' ? { ...hw, kind: 'viaduct' as string as Highway['kind'] } : hw,
      ),
    };
    const parts = buildInfra(L, C);
    expectFinite(parts);
    expect(parts.concrete.triangleCount).toBeGreaterThan(0);
    expect(parts.columns.some((c) => c.owner.startsWith('hw-'))).toBe(true);
  });
});
