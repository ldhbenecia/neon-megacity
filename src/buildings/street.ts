// Street-level LOD0 geometry written into chunk builders: trees (6.2), hillside stairs with
// side walls and alley retaining walls (4.2 hillHouse, 별계단동).
import { createRng } from '../core/random';
import { MATERIAL } from '../core/palette';
import { terrainHeight } from '../city/layout';
import type { Road, StreetSlot } from '../city/types';
import { UNIT_ICO, type GeoBuilder, type V3 } from './builder';
import { hash01, scaleHex, stairSteps } from './params';
import { plain } from './shapes';

/** Street tree: 0.3 m trunk, two low-poly crowns 4-6 m across (6.2). */
export function tree(g: GeoBuilder, s: StreetSlot): void {
  const rng = createRng(s.seed);
  const trunk = plain(0x1a1612, 0.9);
  const leaf = plain(scaleHex(MATERIAL.tree, rng.range(0.9, 1.5)), 0.9);
  const h = rng.range(3.2, 4.5);
  g.box(s.x, s.y, s.z, 0.3, h + 1, 0.3, s.rotY, trunk);
  const r = rng.range(2, 3);
  g.place(UNIT_ICO, s.x, s.y + h + r * 0.4, s.z, r, r * 0.85, r, rng.range(0, 6), leaf);
  g.place(
    UNIT_ICO,
    s.x + rng.range(-0.8, 0.8),
    s.y + h + r * 1.05,
    s.z + rng.range(-0.8, 0.8),
    r * 0.7,
    r * 0.65,
    r * 0.7,
    rng.range(0, 6),
    leaf,
  );
}

/** Concrete stair (0.3 m treads) along a hillside stair road, with low side walls. */
export function stair(g: GeoBuilder, r: Road): void {
  let a = r.a;
  let b = r.b;
  let ya = terrainHeight(a.x, a.z);
  let yb = terrainHeight(b.x, b.z);
  if (ya > yb) {
    [a, b] = [b, a];
    [ya, yb] = [yb, ya];
  }
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 1) return;
  const dx = (b.x - a.x) / len;
  const dz = (b.z - a.z) / len;
  const px = -dz;
  const pz = dx;
  const hw = r.width / 2;
  const step = plain(0x343634, 0.8);
  const riserS = plain(0x262828, 0.85);
  const { n, riser } = stairSteps(len, yb - ya);
  const tread = len / n;
  const up: V3 = [0, 1, 0];
  const back: V3 = [-dx, 0, -dz];
  for (let k = 0; k < n; k++) {
    const s0 = k * tread;
    const s1 = s0 + tread;
    const y = ya + riser * (k + 1) + 0.05;
    const yPrev = y - riser;
    const L = (s: number, side: number): [number, number] => [
      a.x + dx * s + px * hw * side,
      a.z + dz * s + pz * hw * side,
    ];
    const [x0l, z0l] = L(s0, -1);
    const [x0r, z0r] = L(s0, 1);
    const [x1l, z1l] = L(s1, -1);
    const [x1r, z1r] = L(s1, 1);
    // Tread (faces up) and riser (faces downhill).
    g.quad([x0r, y, z0r], [x1r, y, z1r], [x1l, y, z1l], [x0l, y, z0l], up, [0, 0, 0, 0], step);
    g.quad(
      [x0l, yPrev - 0.3, z0l],
      [x0r, yPrev - 0.3, z0r],
      [x0r, y, z0r],
      [x0l, y, z0l],
      back,
      [0, 0, 0, 0],
      riserS,
    );
  }
  // Side walls (low concrete parapets, the stair cut into the slope).
  const wallS = plain(MATERIAL.retainingWall, 0.9);
  const segs = Math.max(1, Math.ceil(len / 4));
  for (const side of [-1, 1]) {
    for (let k = 0; k < segs; k++) {
      const s0 = (len * k) / segs;
      const s1 = (len * (k + 1)) / segs;
      const off = hw + 0.15;
      const x0 = a.x + dx * s0 + px * off * side;
      const z0 = a.z + dz * s0 + pz * off * side;
      const x1 = a.x + dx * s1 + px * off * side;
      const z1 = a.z + dz * s1 + pz * off * side;
      const y0 = ya + ((yb - ya) * s0) / len;
      const y1 = ya + ((yb - ya) * s1) / len;
      const n3: V3 = [px * side, 0, pz * side];
      const nIn: V3 = [-px * side, 0, -pz * side];
      const top = 0.9;
      // Outer and inner faces, then the coping.
      const A: V3 = [x0, y0 - 1, z0];
      const B: V3 = [x1, y1 - 1, z1];
      const C: V3 = [x1, y1 + top, z1];
      const D: V3 = [x0, y0 + top, z0];
      if (side > 0) {
        g.quad(A, B, C, D, n3, [0, 0, 0, 0], wallS);
        g.quad(B, A, D, C, nIn, [0, 0, 0, 0], wallS);
      } else {
        g.quad(B, A, D, C, n3, [0, 0, 0, 0], wallS);
        g.quad(A, B, C, D, nIn, [0, 0, 0, 0], wallS);
      }
    }
  }
}

/**
 * Stepped retaining walls (옹벽) along the uphill edge of cross-slope hillside alleys.
 * Heights vary per 6 m panel so the slope reads as terraces.
 */
export function alleyRetaining(g: GeoBuilder, r: Road): void {
  const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z);
  if (len < 6) return;
  const dx = (r.b.x - r.a.x) / len;
  const dz = (r.b.z - r.a.z) / len;
  // Cross-slope alleys run mostly east-west; skip the uphill ones (they get stairs or ramps).
  if (Math.abs(dz) > 0.5) return;
  // Uphill is -Z (north).
  let px = -dz;
  let pz = dx;
  if (pz > 0) {
    px = -px;
    pz = -pz;
  }
  const off = r.width / 2 + 0.3;
  const wallS = plain(MATERIAL.retainingWall, 0.9);
  const capS = plain(scaleHex(MATERIAL.retainingWall, 1.25), 0.85);
  const panels = Math.floor(len / 6);
  for (let k = 0; k < panels; k++) {
    const h = hash01(r.id * 131 + k);
    if (h < 0.25) continue; // gaps: house entrances, steps
    const s0 = k * 6 + 0.2;
    const s1 = s0 + 5.6;
    const x0 = r.a.x + dx * s0 + px * off;
    const z0 = r.a.z + dz * s0 + pz * off;
    const x1 = r.a.x + dx * s1 + px * off;
    const z1 = r.a.z + dz * s1 + pz * off;
    const yb0 = terrainHeight(x0, z0) - 0.5;
    const yb1 = terrainHeight(x1, z1) - 0.5;
    const up = terrainHeight(x0 + px * 4, z0 + pz * 4);
    const top = Math.max(up, yb0 + 0.5) + 0.6 + h * 1.6;
    // The wall faces the alley (downhill, -p direction).
    const n3: V3 = [-px, 0, -pz];
    const ax = x1;
    const az = z1;
    const bx = x0;
    const bz = z0;
    // Orientation: from a to b with outward normal (-tz, tx) == n3.
    const tx = bx - ax;
    const tz = bz - az;
    const flip = -tz * n3[0] + tx * n3[2] < 0;
    const P0: V3 = flip ? [x0, yb0, z0] : [ax, yb1, az];
    const P1: V3 = flip ? [x1, yb1, z1] : [bx, yb0, bz];
    g.quad(P0, P1, [P1[0], top, P1[2]], [P0[0], top, P0[2]], n3, [0, 0, 0, 0], wallS);
    g.quad(
      [P0[0], top, P0[2]],
      [P1[0], top, P1[2]],
      [P1[0] + px * 0.3, top, P1[2] + pz * 0.3],
      [P0[0] + px * 0.3, top, P0[2] + pz * 0.3],
      [0, 1, 0],
      [0, 0, 0, 0],
      capS,
    );
  }
}
