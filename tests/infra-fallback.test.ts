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
import { hwPath, nearestOnPath } from '../src/infra/highways';
import { MeshData } from '../src/infra/mesh';
import { createParts, type InfraParts } from '../src/infra/parts';
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
  spans?: number;
}

/** A synthetic bridge across the v2 river at x, perpendicular to the centerline. */
function makeBridge(x: number, s: Spec): Bridge {
  const { p, south } = riverFrame(x);
  const at = (k: number) => ({ x: p.x + south.x * k, z: p.z + south.z * k });
  const b: Bridge & { spans?: number } = {
    id: `test-${s.kind}`,
    kind: unknownKind(s.kind),
    a: at(-s.half),
    b: at(s.half),
    landA: at(-s.landA),
    landB: at(s.landB),
    deckY: s.deckY,
    width: s.width,
    lanes: s.lanes,
    structureH: 0,
  };
  if (s.lowerDeckY !== undefined) b.lowerDeckY = s.lowerDeckY;
  if (s.spans !== undefined) b.spans = s.spans;
  return b;
}

function expectFinite(parts: InfraParts): void {
  for (const m of [parts.concrete, parts.steel, parts.markings, parts.glow, parts.wash]) {
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
    expect(LAYOUT.bridges.map(bridgeShape)).toEqual(LAYOUT.bridges.map((b) => b.kind));
    for (const k of ['deckArch', 'tiedArch', 'girder', 'cableStayed', 'mystery', '']) {
      expect(bridgeShape(makeBridge(0, { ...CASES[0]!, kind: k }))).toBe('girder');
    }
  });

  it('v2 piers stay where they were', () => {
    const want: Record<string, number[]> = {
      arch: [0],
      truss: [-40, 40],
      doubleDeck: [-80, -40, 0, 40, 80],
    };
    for (const b of LAYOUT.bridges) {
      const got = pierStations(b, bridgeFrame(b));
      const exp = want[b.kind]!;
      expect(got).toHaveLength(exp.length);
      got.forEach((s, i) => expect(s).toBeCloseTo(exp[i]!, 9));
    }
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

    // River piers reach the lowest deck's underside.
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

  it('approach piers never stand on a highway deck', () => {
    const paths = LAYOUT.highways.map((hw) => hwPath(hw));
    for (const s of CASES) {
      const parts = createParts();
      buildBridge(makeBridge(400, s), parts, C, LAYOUT.roads, paths);
      for (const c of parts.columns.filter((col) => col.y0 !== -8)) {
        for (const path of paths) {
          expect(nearestOnPath(path, c.x, c.z).d).toBeGreaterThan(path.hw.width / 2 + c.d / 2);
        }
      }
    }
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
