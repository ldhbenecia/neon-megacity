// Plain-array mesh builder for merged infra geometry. Pure (no GPU objects), so sweeps,
// boxes and caps can be unit tested; index.ts turns a MeshData into one BufferGeometry.
//
// Conventions: world Y up. A sweep frame has a horizontal-ish `lat` (right-hand side when
// facing along the path) and `up` = lat × tangent, so profile points (l, y) map to
// p + lat * l + up * y. Triangles are counter-clockwise seen from the outward normal.

export type V3 = readonly [number, number, number];
/** Linear RGB (may exceed 1 for HDR emissive colors). */
export type RGB = readonly [number, number, number];

export interface Frame {
  p: V3;
  lat: V3;
  up: V3;
}

/** One straight edge of a cross-section (a closed loop is a list of consecutive edges). */
export interface ProfileEdge {
  a: readonly [number, number];
  b: readonly [number, number];
  color: RGB;
}

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Frame for a path point with tangent `t`: lat is horizontal, up ⟂ both. */
export function frameAt(p: V3, t: V3): Frame {
  let lat: V3 = [-t[2], 0, t[0]];
  if (Math.hypot(lat[0], lat[2]) < 1e-6) lat = [1, 0, 0];
  lat = norm(lat);
  const up = norm(cross(lat, norm(t)));
  return { p, lat, up: up[1] < 0 ? scale(up, -1) : up };
}

/** Frames along a polyline (tangent from neighbours). */
export function framesAlong(points: readonly V3[]): Frame[] {
  return points.map((p, i) => {
    const prev = points[Math.max(0, i - 1)] as V3;
    const next = points[Math.min(points.length - 1, i + 1)] as V3;
    return frameAt(p, norm(sub(next, prev)));
  });
}

export class MeshData {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  vertex(p: V3, n: V3, c: RGB): number {
    this.positions.push(p[0], p[1], p[2]);
    this.normals.push(n[0], n[1], n[2]);
    this.colors.push(c[0], c[1], c[2]);
    return this.vertexCount - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  /** Quad a-b-c-d (counter-clockwise from the front) with a flat normal. */
  quad(a: V3, b: V3, c: V3, d: V3, color: RGB): void {
    const n = norm(cross(sub(b, a), sub(d, a)));
    const i = this.vertex(a, n, color);
    this.vertex(b, n, color);
    this.vertex(c, n, color);
    this.vertex(d, n, color);
    this.tri(i, i + 1, i + 2);
    this.tri(i, i + 2, i + 3);
  }

  /**
   * Sweeps profile edges along frames. Each edge becomes a flat-shaded strip whose normal is
   * the outward perpendicular of the edge (edges listed clockwise in the (l, y) plane).
   */
  sweep(frames: readonly Frame[], edges: readonly ProfileEdge[]): void {
    if (frames.length < 2) return;
    for (const e of edges) {
      const dl = e.b[0] - e.a[0];
      const dy = e.b[1] - e.a[1];
      const el = Math.hypot(dl, dy) || 1;
      // Clockwise loop → outward normal is (-dy, dl).
      const nl = -dy / el;
      const ny = dl / el;
      const base = this.vertexCount;
      for (const f of frames) {
        const n = norm(add(scale(f.lat, nl), scale(f.up, ny)));
        this.vertex(at(f, e.a[0], e.a[1]), n, e.color);
        this.vertex(at(f, e.b[0], e.b[1]), n, e.color);
      }
      for (let i = 0; i < frames.length - 1; i++) {
        const a0 = base + i * 2;
        const b0 = a0 + 1;
        const a1 = a0 + 2;
        const b1 = a0 + 3;
        this.tri(a0, b0, a1);
        this.tri(a1, b0, b1);
      }
    }
  }

  /**
   * Flat cap of a convex profile loop at a frame. `facing` = +1 caps the end (normal along
   * the path), -1 caps the start.
   */
  cap(f: Frame, loop: readonly (readonly [number, number])[], color: RGB, facing: 1 | -1): void {
    if (loop.length < 3) return;
    const fwd = norm(cross(f.up, f.lat));
    const n = scale(fwd, facing);
    const base = this.vertexCount;
    for (const [l, y] of loop) this.vertex(at(f, l, y), n, color);
    for (let i = 1; i < loop.length - 1; i++) {
      // Profile loops are clockwise in (l, y); seen from +fwd that is counter-clockwise.
      if (facing === 1) this.tri(base, base + i, base + i + 1);
      else this.tri(base, base + i + 1, base + i);
    }
  }

  /**
   * Box beam from `a` to `b` (centers of the end faces), `w` wide along `side` and `h` tall
   * along the third axis. `side` defaults to a horizontal perpendicular.
   */
  beam(a: V3, b: V3, w: number, h: number, color: RGB, side?: V3): void {
    const t = norm(sub(b, a));
    let s = side ? norm(side) : norm([-t[2], 0, t[0]]);
    if (len(s) < 1e-6 || Math.abs(dot(s, t)) > 0.999) s = [1, 0, 0];
    // Make s exactly perpendicular to t.
    s = norm(sub(s, scale(t, dot(s, t))));
    const u = norm(cross(s, t));
    const hw = w / 2;
    const hh = h / 2;
    const corner = (p: V3, i: number, j: number): V3 =>
      add(p, add(scale(s, i * hw), scale(u, j * hh)));
    const ring = (p: V3): V3[] => [
      corner(p, -1, -1),
      corner(p, 1, -1),
      corner(p, 1, 1),
      corner(p, -1, 1),
    ];
    const A = ring(a);
    const B = ring(b);
    for (let k = 0; k < 4; k++) {
      const k1 = (k + 1) % 4;
      // Side faces, outward.
      this.quad(A[k] as V3, B[k] as V3, B[k1] as V3, A[k1] as V3, color);
    }
    this.quad(A[0] as V3, A[1] as V3, A[2] as V3, A[3] as V3, color);
    this.quad(B[3] as V3, B[2] as V3, B[1] as V3, B[0] as V3, color);
  }
}

function at(f: Frame, l: number, y: number): V3 {
  return [
    f.p[0] + f.lat[0] * l + f.up[0] * y,
    f.p[1] + f.lat[1] * l + f.up[1] * y,
    f.p[2] + f.lat[2] * l + f.up[2] * y,
  ];
}
