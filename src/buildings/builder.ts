// Vertex layout read by facadeMaterial.ts (keep in sync):
//   aFace (u along the face, y above windowY) in m, float32: values reach ~600 m.
//   aWin  (cellW, cellH, winW, winH); FACADE.dong: (number, digits, height, 0). Half float.
//   aInfo (type * 2 + storefront, seed, lit factor, param). Half float.
//   color sRGB-encoded normalized bytes; the vertex shader decodes them to linear.
import * as THREE from 'three';
import type { FacadeType } from './params';

export interface Style {
  type: FacadeType;
  color: THREE.Color;
  cellW: number;
  cellH: number;
  winW: number;
  winH: number;
  windowY: number;
  seed: number;
  lit: number;
  param: number;
  storefront: boolean;
}

export type V3 = readonly [number, number, number];

class Growable {
  arr: Float32Array;
  len = 0;
  constructor(cap: number) {
    this.arr = new Float32Array(cap);
  }
  reserve(n: number): void {
    if (this.len + n <= this.arr.length) return;
    let cap = this.arr.length * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new Float32Array(cap);
    next.set(this.arr.subarray(0, this.len));
    this.arr = next;
  }
}

class GrowableIdx {
  arr: Uint32Array;
  len = 0;
  constructor(cap: number) {
    this.arr = new Uint32Array(cap);
  }
  reserve(n: number): void {
    if (this.len + n <= this.arr.length) return;
    let cap = this.arr.length * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint32Array(cap);
    next.set(this.arr.subarray(0, this.len));
    this.arr = next;
  }
}

export class GeoBuilder {
  private pos = new Growable(3 * 1024);
  private nrm = new Growable(3 * 1024);
  private col = new Growable(3 * 1024);
  private face = new Growable(2 * 1024);
  private win = new Growable(4 * 1024);
  private info = new Growable(4 * 1024);
  private idx = new GrowableIdx(1536);
  private count = 0;
  constructor(
    readonly ox: number,
    readonly oz: number,
  ) {}

  get vertexCount(): number {
    return this.count;
  }

  vertex(p: V3, n: V3, u: number, s: Style): number {
    this.pos.reserve(3);
    this.nrm.reserve(3);
    this.col.reserve(3);
    this.face.reserve(2);
    this.win.reserve(4);
    this.info.reserve(4);
    let k = this.pos.len;
    this.pos.arr[k] = p[0] - this.ox;
    this.pos.arr[k + 1] = p[1];
    this.pos.arr[k + 2] = p[2] - this.oz;
    this.pos.len += 3;
    k = this.nrm.len;
    this.nrm.arr[k] = n[0];
    this.nrm.arr[k + 1] = n[1];
    this.nrm.arr[k + 2] = n[2];
    this.nrm.len += 3;
    k = this.col.len;
    this.col.arr[k] = s.color.r;
    this.col.arr[k + 1] = s.color.g;
    this.col.arr[k + 2] = s.color.b;
    this.col.len += 3;
    k = this.face.len;
    this.face.arr[k] = u;
    this.face.arr[k + 1] = p[1] - s.windowY;
    this.face.len += 2;
    k = this.win.len;
    this.win.arr[k] = s.cellW;
    this.win.arr[k + 1] = s.cellH;
    this.win.arr[k + 2] = s.winW;
    this.win.arr[k + 3] = s.winH;
    this.win.len += 4;
    k = this.info.len;
    this.info.arr[k] = s.type * 2 + (s.storefront ? 1 : 0);
    // Half floats keep 1/1024 steps exactly below 2; the shader re-quantizes to the same grid.
    this.info.arr[k + 1] = Math.round(s.seed * 1024) / 1024;
    this.info.arr[k + 2] = s.lit;
    this.info.arr[k + 3] = s.param;
    this.info.len += 4;
    return this.count++;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.reserve(3);
    const k = this.idx.len;
    this.idx.arr[k] = a;
    this.idx.arr[k + 1] = b;
    this.idx.arr[k + 2] = c;
    this.idx.len += 3;
  }

  quad(
    a: V3,
    b: V3,
    c: V3,
    d: V3,
    n: V3,
    u: readonly [number, number, number, number],
    s: Style,
  ): void {
    const i0 = this.vertex(a, n, u[0], s);
    const i1 = this.vertex(b, n, u[1], s);
    const i2 = this.vertex(c, n, u[2], s);
    const i3 = this.vertex(d, n, u[3], s);
    this.tri(i0, i1, i2);
    this.tri(i0, i2, i3);
  }

  // Outward normal is (-tz, tx) for t = b - a: outlines must have negative shoelace area.
  wall(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    y0: number,
    y1: number,
    u0: number,
    s: Style,
    na?: V3,
    nb?: V3,
  ): void {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-4 || y1 - y0 < 1e-4) return;
    const tx = (bx - ax) / len;
    const tz = (bz - az) / len;
    const n: V3 = [-tz, 0, tx];
    const i0 = this.vertex([ax, y0, az], na ?? n, u0, s);
    const i1 = this.vertex([bx, y0, bz], nb ?? n, u0 + len, s);
    const i2 = this.vertex([bx, y1, bz], nb ?? n, u0 + len, s);
    const i3 = this.vertex([ax, y1, az], na ?? n, u0, s);
    this.tri(i0, i1, i2);
    this.tri(i0, i2, i3);
  }

  cap(pts: readonly { x: number; z: number }[], y: number, s: Style, down = false): void {
    if (pts.length < 3) return;
    const n: V3 = down ? [0, -1, 0] : [0, 1, 0];
    const base = this.count;
    for (const p of pts) this.vertex([p.x, y, p.z], n, p.x, s);
    for (let i = 1; i < pts.length - 1; i++) {
      if (down) this.tri(base, base + i + 1, base + i);
      else this.tri(base, base + i, base + i + 1);
    }
  }

  geometry(g: THREE.BufferGeometry, m: THREE.Matrix4, s: Style): void {
    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    nm.getNormalMatrix(m);
    const base = this.count;
    for (let i = 0; i < P.count; i++) {
      tv.fromBufferAttribute(P, i).applyMatrix4(m);
      tn.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      this.vertex([tv.x, tv.y, tv.z], [tn.x, tn.y, tn.z], tv.y, s);
    }
    const I = g.getIndex();
    if (I) {
      for (let i = 0; i < I.count; i += 3) {
        this.tri(base + I.getX(i), base + I.getX(i + 1), base + I.getX(i + 2));
      }
    } else {
      for (let i = 0; i < P.count; i += 3) this.tri(base + i, base + i + 1, base + i + 2);
    }
  }

  beam(p: V3, q: V3, sx: number, sy: number, side: V3, s: Style): void {
    ta.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    const len = ta.length();
    if (len < 1e-4) return;
    ta.divideScalar(len);
    tb.set(side[0], side[1], side[2]);
    tb.addScaledVector(ta, -tb.dot(ta));
    if (tb.lengthSq() < 1e-8) tb.set(1, 0, 0).addScaledVector(ta, -ta.x);
    tb.normalize();
    tc.crossVectors(tb, ta).normalize();
    tm.makeBasis(tb, ta, tc);
    tm.scale(ts.set(sx, len, sy));
    tm.setPosition((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2);
    this.geometry(UNIT_BOX, tm, s);
  }

  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    rotY: number,
    s: Style,
    bottom = false,
  ): void {
    tq.setFromAxisAngle(UP, rotY);
    tm.compose(tv.set(x, y + h / 2, z), tq, ts.set(w, h, d));
    this.geometry(bottom ? UNIT_BOX : BOX_NO_BOTTOM, tm, s);
  }

  place(
    g: THREE.BufferGeometry,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rotY: number,
    s: Style,
  ): void {
    tq.setFromAxisAngle(UP, rotY);
    tm.compose(tv.set(x, y, z), tq, ts.set(sx, sy, sz));
    this.geometry(g, tm, s);
  }

  build(): THREE.BufferGeometry | null {
    if (this.count === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.arr.slice(0, this.pos.len), 3));
    const n = this.count;
    const nrm = new Int8Array(n * 3);
    for (let i = 0; i < n * 3; i++) nrm[i] = Math.round((this.nrm.arr[i] ?? 0) * 127);
    // sRGB-encoded bytes (decoded in the vertex shader): linear bytes band the dark facades.
    const col = new Uint8Array(n * 3);
    for (let i = 0; i < n * 3; i++) col[i] = Math.round(linearToSrgb(this.col.arr[i] ?? 0) * 255);
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
    g.setAttribute('aFace', new THREE.BufferAttribute(this.face.arr.slice(0, this.face.len), 2));
    g.setAttribute('aWin', half(this.win.arr.subarray(0, this.win.len), 4));
    g.setAttribute('aInfo', half(this.info.arr.subarray(0, this.info.len), 4));
    const idx = this.idx.arr.subarray(0, this.idx.len);
    g.setIndex(
      this.count < 65536
        ? new THREE.BufferAttribute(Uint16Array.from(idx), 1)
        : new THREE.BufferAttribute(idx.slice(), 1),
    );
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function linearToSrgb(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

// Float16BufferAttribute's constructor takes raw half bits; passing floats truncates them.
function half(src: Float32Array, itemSize: number): THREE.Float16BufferAttribute {
  const bits = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) bits[i] = THREE.DataUtils.toHalfFloat(src[i] ?? 0);
  return new THREE.Float16BufferAttribute(bits, itemSize);
}

const UP = new THREE.Vector3(0, 1, 0);
const tv = new THREE.Vector3();
const tn = new THREE.Vector3();
const ta = new THREE.Vector3();
const tb = new THREE.Vector3();
const tc = new THREE.Vector3();
const ts = new THREE.Vector3();
const tq = new THREE.Quaternion();
const tm = new THREE.Matrix4();
const nm = new THREE.Matrix3();

export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

const BOX_NO_BOTTOM = ((): THREE.BufferGeometry => {
  const src = UNIT_BOX;
  const P = src.getAttribute('position');
  const N = src.getAttribute('normal');
  const I = src.getIndex();
  const keep: number[] = [];
  const remap = new Map<number, number>();
  for (let i = 0; i < P.count; i++) {
    if (N.getY(i) > -0.5) {
      remap.set(i, keep.length);
      keep.push(i);
    }
  }
  const pos: number[] = [];
  const nrm: number[] = [];
  for (const i of keep) {
    pos.push(P.getX(i), P.getY(i), P.getZ(i));
    nrm.push(N.getX(i), N.getY(i), N.getZ(i));
  }
  const idx: number[] = [];
  if (I) {
    for (let k = 0; k < I.count; k += 3) {
      const a = remap.get(I.getX(k));
      const b = remap.get(I.getX(k + 1));
      const c = remap.get(I.getX(k + 2));
      if (a !== undefined && b !== undefined && c !== undefined) idx.push(a, b, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
})();
export const UNIT_CYL8 = new THREE.CylinderGeometry(1, 1, 1, 8, 1).translate(0, 0.5, 0);
export const UNIT_CYL12 = new THREE.CylinderGeometry(1, 1, 1, 12, 1).translate(0, 0.5, 0);
export const UNIT_ICO = new THREE.IcosahedronGeometry(1, 0);
export const UNIT_SPIRE = new THREE.CylinderGeometry(0.08, 1, 1, 4, 1)
  .rotateY(Math.PI / 4)
  .translate(0, 0.5, 0);
export const UNIT_CONE8 = new THREE.ConeGeometry(1, 1, 8, 1).translate(0, 0.5, 0);
