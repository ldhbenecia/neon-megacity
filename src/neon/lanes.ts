import * as THREE from 'three';
import type { Bridge, Highway, Road, SkyLane, Vec3 } from '../city/layout';
import { createRng } from '../core/random';
import { isDivided, laneOffsets } from '../infra/profile';

export interface Path {
  id: string;
  points: Vec3[];
  length: number;
  closed: boolean;
  kind: 'ground' | 'bridge' | 'highway' | 'flying' | 'rail';
  /** Rail tracks run one way; alternate tracks take turns. */
  oneWay?: 1 | -1;
  fade: number;
  altitude?: readonly [number, number];
  /** Ground paths on arterials keep full traffic when the ground cap thins side streets. */
  arterial?: boolean;
}

export interface Vehicle {
  path: number;
  u0: number;
  speed: number;
  dir: 1 | -1;
  lane: number;
  lift: number;
  seed: number;
}

export const LANE_W = 3.3;

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

export function endFade(u: number, path: Pick<Path, 'closed' | 'fade' | 'length'>): number {
  if (path.closed || path.fade <= 0) return 1;
  const f = Math.min(0.45, path.fade / Math.max(path.length, 1e-6));
  const s = (e0: number, e1: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  return s(0, f, u) * s(1, 1 - f, u);
}

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
      arterial: r.kind === 'arterial',
    });
  }
  return out;
}

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

/** Rail track polylines (rail top, approach slopes included) from infra, one path per track. */
export function railPaths(
  tracks: ReadonlyMap<string, readonly { points: readonly Vec3[] }[]>,
): Path[] {
  const out: Path[] = [];
  for (const [id, list] of tracks) {
    list.forEach((t, i) => {
      if (t.points.length < 2) return;
      const r = resample([...t.points], Math.max(2, t.points.length));
      out.push({
        id: `rail-${id}-${i}`,
        points: r.points,
        length: r.length,
        closed: false,
        kind: 'rail',
        fade: 40,
        oneWay: i % 2 === 0 ? 1 : -1,
      });
    });
  }
  return out;
}

const SKY_SAMPLES_PER_100M = 4;

// Drone lanes come from the layout (Layout.skyLanes), never from highway ids. Path y is 0, so
// `altitude` is an absolute height band that vehicleStreams lifts each drone into.
export function skyPaths(lanes: readonly SkyLane[]): Path[] {
  const out: Path[] = [];
  for (const lane of lanes) {
    // A broken lane must fail loudly, not vanish like hw-ring did.
    if (lane.points.length < 2) throw new Error(`sky lane ${lane.id} has fewer than 2 points`);
    // Prefer the layout's own samples: its clearance is measured on exactly that path.
    let pts: Vec3[];
    if (lane.samples && lane.samples.length >= 2) {
      pts = lane.samples.map((p) => ({ x: p.x, y: 0, z: p.z }));
    } else {
      const curve = new THREE.CatmullRomCurve3(
        lane.points.map((p) => new THREE.Vector3(p.x, 0, p.z)),
        lane.closed,
        'centripetal',
      );
      const n = Math.max(8, Math.round((curve.getLength() / 100) * SKY_SAMPLES_PER_100M));
      pts = curve.getSpacedPoints(n).map((v) => ({ x: v.x, y: 0, z: v.z }));
    }
    // Closed lanes keep the repeated end point: the shader wraps u with fract().
    const r = resample(pts, pts.length);
    out.push({
      id: lane.id,
      points: r.points,
      length: r.length,
      closed: lane.closed,
      kind: 'flying',
      fade: lane.closed ? 0 : 30,
      altitude: lane.altitude,
    });
  }
  return out;
}

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
  density?: Partial<Record<Path['kind'], number>>;
  groundCap?: number;
}

// laneOffsets: + = right of the curve direction. The reverse direction's frame is mirrored, so
// divided highways reuse the positive offsets for both directions; ramps are one-way.
export function laneSlots(
  p: Path,
  hw: ReadonlyMap<string, Highway>,
): { dir: 1 | -1; lane: number }[] {
  const both = (offs: number[]): { dir: 1 | -1; lane: number }[] =>
    ([1, -1] as const).flatMap((dir) => offs.map((lane) => ({ dir, lane })));
  if (p.kind === 'flying') return both([0]);
  if (p.kind === 'rail') return [{ dir: p.oneWay ?? 1, lane: 0 }];
  if (p.kind === 'ground')
    return both(p.length > 300 ? [LANE_W * 0.5, LANE_W * 1.5] : [LANE_W * 0.5]);
  if (p.kind === 'bridge') return both([LANE_W * 0.5 + 0.6, LANE_W * 1.5 + 0.6]);
  const h = hw.get(p.id);
  if (!h) return both([LANE_W * 0.5]);
  const offs = laneOffsets(h);
  if (!isDivided(h)) return offs.map((lane) => ({ dir: 1 as const, lane }));
  return both(offs.filter((o) => o > 0));
}

/** Ground vehicles on the whole map (art direction 6.2, v3 decision). */
export const GROUND_CAP = 1200;

export function vehicleStreams(
  paths: readonly Path[],
  highways: readonly Highway[],
  opts: StreamOptions = {},
): Vehicle[] {
  const rng = createRng(opts.seed ?? 6060);
  const hw = new Map(highways.map((h) => [h.id, h]));
  const density = { ground: 2.2, bridge: 26, highway: 34, flying: 3, rail: 1.2, ...opts.density };
  const perLane = (p: Path): number => Math.max(1, Math.round((density[p.kind] * p.length) / 1000));
  // Over the cap, side streets lose cars first (some none); arterials shrink only if they alone
  // exceed the cap. A no-op on maps under the cap, so their streams stay identical.
  const groundCount = (art: boolean): number =>
    paths
      .filter((p) => p.kind === 'ground' && !!p.arterial === art)
      .reduce((n, p) => n + perLane(p) * laneSlots(p, hw).length, 0);
  const arterialCars = groundCount(true);
  const sideCars = groundCount(false);
  const cap = opts.groundCap ?? GROUND_CAP;
  let sideScale = 1;
  let mainScale = 1;
  if (arterialCars + sideCars > cap) {
    mainScale = Math.min(1, cap / Math.max(1, arterialCars));
    sideScale = sideCars > 0 ? Math.max(0, (cap - arterialCars * mainScale) / sideCars) : 1;
  }
  const out: Vehicle[] = [];
  const carry = { main: 0, side: 0 };
  paths.forEach((p, pi) => {
    for (const slot of laneSlots(p, hw)) {
      const dir = slot.dir;
      let count = perLane(p);
      const scale = p.kind !== 'ground' ? 1 : p.arterial ? mainScale : sideScale;
      if (scale < 1) {
        // Carry the fraction across lanes so short streets do not all round down to zero.
        const key = p.arterial ? 'main' : 'side';
        carry[key] += count * scale;
        count = Math.floor(carry[key]);
        carry[key] -= count;
      }
      const kmh =
        p.kind === 'ground'
          ? rng.range(30, 50)
          : p.kind === 'flying'
            ? rng.range(110, 160)
            : p.kind === 'rail'
              ? rng.range(55, 75)
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

export function pathPoint(p: Path, u: number): Vec3 {
  const n = p.points.length;
  const f = Math.min(Math.max(u, 0), 1) * (n - 1);
  const i = Math.min(Math.floor(f), n - 2);
  const a = p.points[i] as Vec3;
  const b = p.points[i + 1] as Vec3;
  const t = f - i;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}
