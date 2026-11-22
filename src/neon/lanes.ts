// Traffic paths and vehicle streams (ART_DIRECTION 6.2). Pure: produces path polylines
// (ground roads, bridge decks, elevated highway curves, flying lanes) and per-vehicle stream
// parameters. The GPU evaluates `u = fract(u0 + speed * t / length)` along a path texture,
// so no vehicle is ever moved on the CPU.
import type { Bridge, Highway, Road, Vec3 } from '../city/layout';
import { createRng } from '../core/random';
import { isDivided, laneOffsets } from '../infra/profile';

/** Arc-length parameterized polyline (evenly spaced samples). */
export interface Path {
  id: string;
  points: Vec3[];
  length: number;
  closed: boolean;
  kind: 'ground' | 'bridge' | 'highway' | 'flying';
  /** Distance (m) over which vehicles fade in / out at open ends (0 for closed paths). */
  fade: number;
  /** Flying lanes: world altitude band [min, max] (m). */
  altitude?: readonly [number, number];
}

export interface Vehicle {
  path: number;
  /** Start parameter 0..1. */
  u0: number;
  /** Normalized speed: (m/s) / path length. */
  speed: number;
  /** +1 travels in increasing u, -1 reverse. */
  dir: 1 | -1;
  /** Lateral offset to the right of travel (m). */
  lane: number;
  /** Height above the path (m). */
  lift: number;
  seed: number;
}

export const LANE_W = 3.3;

/** Resample a polyline to `n` evenly spaced points (arc length). */
export function resample(pts: readonly Vec3[], n: number): { points: Vec3[]; length: number } {
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Vec3;
    const b = pts[i] as Vec3;
    cum.push((cum[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  const length = cum[cum.length - 1] ?? 0;
  const out: Vec3[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (length * k) / (n - 1);
    while (j < pts.length - 2 && (cum[j + 1] ?? 0) < s) j++;
    const a = pts[j] as Vec3;
    const b = pts[j + 1] ?? a;
    const span = (cum[j + 1] ?? 0) - (cum[j] ?? 0);
    const t = span > 0 ? (s - (cum[j] ?? 0)) / span : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
  }
  return { points: out, length };
}

/** Vehicle fade at the open ends of a path: 0 at both ends, 1 inside (closed paths: always 1). */
export function endFade(u: number, path: Pick<Path, 'closed' | 'fade' | 'length'>): number {
  if (path.closed || path.fade <= 0) return 1;
  const f = Math.min(0.45, path.fade / Math.max(path.length, 1e-6));
  const s = (e0: number, e1: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  return s(0, f, u) * s(1, 1 - f, u);
}

/** Ground roads with traffic (arterials and streets; alleys and stairs stay empty). */
export function groundPaths(
  roads: readonly Road[],
  roadY: (x: number, z: number) => number,
): Path[] {
  const out: Path[] = [];
  for (const r of roads) {
    if (r.kind !== 'arterial' && r.kind !== 'street') continue;
    const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z);
    if (len < 40) continue;
    const a = { x: r.a.x, y: roadY(r.a.x, r.a.z), z: r.a.z };
    const b = { x: r.b.x, y: roadY(r.b.x, r.b.z), z: r.b.z };
    out.push({
      id: `road-${r.id}`,
      points: [a, b],
      length: len,
      closed: false,
      kind: 'ground',
      fade: 10,
    });
  }
  return out;
}

/** Bridge decks from landing to landing (deck height profile from `deckY`). */
export function bridgePaths(
  bridges: readonly Bridge[],
  deckY: (x: number, z: number) => number,
): Path[] {
  return bridges.map((br) => {
    const pts: Vec3[] = [];
    const n = 24;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = br.landA.x + (br.landB.x - br.landA.x) * t;
      const z = br.landA.z + (br.landB.z - br.landA.z) * t;
      pts.push({ x, y: deckY(x, z), z });
    }
    const r = resample(pts, n);
    return {
      id: br.id,
      points: r.points,
      length: r.length,
      closed: false,
      kind: 'bridge' as const,
      fade: 12,
    };
  });
}

/**
 * Highway path from curve samples (InfraApi.curves or layout `highwayCurve`).
 * Open highways fade over 30 m at their ends: ramps merge into their parent highway there and
 * the riverside highways end outside the map, so no vehicle ever pops in on screen.
 */
export function highwayPath(
  id: string,
  samples: readonly Vec3[],
  closed: boolean,
  kind: Path['kind'] = 'highway',
): Path {
  const r = resample(samples, Math.max(2, samples.length));
  return { id, points: r.points, length: r.length, closed, kind, fade: closed ? 0 : 30 };
}

export interface StreamOptions {
  seed?: number;
  /** Vehicles per lane per km by path kind. */
  density?: Partial<Record<Path['kind'], number>>;
}

/** Lanes per direction for a path. */
/**
 * Lane slots of a path. Highways use infra's real lane centers (`laneOffsets`, + = right of the
 * curve direction): divided roads drive on the right half in both directions (the reverse
 * direction's frame is mirrored, so it reuses the positive offsets); ramps are one-way.
 */
export function laneSlots(
  p: Path,
  hw: ReadonlyMap<string, Highway>,
): { dir: 1 | -1; lane: number }[] {
  const both = (offs: number[]): { dir: 1 | -1; lane: number }[] =>
    ([1, -1] as const).flatMap((dir) => offs.map((lane) => ({ dir, lane })));
  if (p.kind === 'flying') return both([0]);
  if (p.kind === 'ground')
    return both(p.length > 300 ? [LANE_W * 0.5, LANE_W * 1.5] : [LANE_W * 0.5]);
  if (p.kind === 'bridge') return both([LANE_W * 0.5 + 0.6, LANE_W * 1.5 + 0.6]);
  const h = hw.get(p.id);
  if (!h) return both([LANE_W * 0.5]);
  const offs = laneOffsets(h);
  if (!isDivided(h)) return offs.map((lane) => ({ dir: 1 as const, lane }));
  return both(offs.filter((o) => o > 0));
}

export function vehicleStreams(
  paths: readonly Path[],
  highways: readonly Highway[],
  opts: StreamOptions = {},
): Vehicle[] {
  const rng = createRng(opts.seed ?? 6060);
  const hw = new Map(highways.map((h) => [h.id, h]));
  const density = { ground: 2.2, bridge: 26, highway: 34, flying: 6, ...opts.density };
  const out: Vehicle[] = [];
  paths.forEach((p, pi) => {
    for (const slot of laneSlots(p, hw)) {
      const dir = slot.dir;
      const count = Math.max(1, Math.round((density[p.kind] * p.length) / 1000));
      const kmh =
        p.kind === 'ground'
          ? rng.range(30, 50)
          : p.kind === 'flying'
            ? rng.range(110, 160)
            : rng.range(65, 100);
      const speed = kmh / 3.6 / p.length;
      const base = rng.next();
      const [amin, amax] = p.altitude ?? [80, 260];
      const lift = p.kind === 'flying' ? rng.range(amin, amax) - (p.points[0]?.y ?? 0) : 0;
      const lane = p.kind === 'flying' ? rng.range(-6, 6) : slot.lane;
      for (let k = 0; k < count; k++) {
        out.push({
          path: pi,
          u0: (base + (k + rng.range(-0.3, 0.3)) / count + 1) % 1,
          speed,
          dir,
          lane,
          lift: p.kind === 'flying' ? lift + rng.range(-3, 3) : 0,
          seed: rng.int(0, 1e6),
        });
      }
    }
  });
  return out;
}

/** Texture rows: one path per row, `width` samples per row (xyz, w = sample count). */
export function packPaths(paths: readonly Path[], width: number): Float32Array {
  const data = new Float32Array(width * paths.length * 4);
  paths.forEach((p, row) => {
    const pts = p.points.length > width ? resample(p.points, width).points : p.points;
    pts.forEach((v, i) => {
      const o = (row * width + i) * 4;
      data[o] = v.x;
      data[o + 1] = v.y;
      data[o + 2] = v.z;
      data[o + 3] = pts.length;
    });
  });
  return data;
}

/** CPU mirror of the shader path lookup (for tests): position at parameter u. */
export function pathPoint(p: Path, u: number): Vec3 {
  const n = p.points.length;
  const f = Math.min(Math.max(u, 0), 1) * (n - 1);
  const i = Math.min(Math.floor(f), n - 2);
  const a = p.points[i] as Vec3;
  const b = p.points[i + 1] as Vec3;
  const t = f - i;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}
