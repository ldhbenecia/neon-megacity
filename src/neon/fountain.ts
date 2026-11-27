import * as THREE from 'three';
import type { Bridge, Vec2, Vec3 } from '../city/layout';
import { NEON } from '../core/palette';
import { setInstanceAttributes, toInstanced } from './geom';
import type { NeonUniforms } from './glsl';
import { GlowMode, glowMaterial } from './glow';

/** Jets per deck side; the one knob a lower quality tier turns down. */
export const FOUNTAIN_JETS_PER_SIDE = 48;
const END_INSET = 8;
const ARC_SEGMENTS = 16;

// Neighbouring jets share a colour; groups of 8 step a little along the bridge, so colours drift as waves.
function jetPhase(i: number, side: 1 | -1): number {
  return (Math.floor(i / 8) * 0.07 + (i % 8) * 0.004 + (side > 0 ? 0 : 0.5)) % 1;
}

export interface Jet {
  x: number;
  y: number;
  z: number;
  /** Length along the deck edge (m). */
  len: number;
  alongX: number;
  alongZ: number;
  /** +1 / -1: which deck edge, also the outward direction. */
  side: 1 | -1;
  phase: number;
  /** Horizontal reach and fall to the water (m). */
  reach: number;
  drop: number;
}

// Water curtains along both edges of the upper deck of every 'fountain' bridge (SEOUL.md 3.3,
// Banpo). Geometry comes only from the layout: abutments, width, deck height and water level.
export function fountainJets(
  bridges: readonly Bridge[],
  waterY: number,
  perSide = FOUNTAIN_JETS_PER_SIDE,
): Jet[] {
  const out: Jet[] = [];
  for (const br of bridges) {
    if (br.motif !== 'fountain' || perSide <= 0) continue;
    const dx = br.b.x - br.a.x;
    const dz = br.b.z - br.a.z;
    const span = Math.hypot(dx, dz);
    if (span <= 2 * END_INSET) continue;
    const ax = dx / span;
    const az = dz / span;
    const len = (span - 2 * END_INSET) / perSide;
    for (const side of [1, -1] as const) {
      const ox = -az * side * (br.width / 2 + 0.3);
      const oz = ax * side * (br.width / 2 + 0.3);
      for (let i = 0; i < perSide; i++) {
        const t = END_INSET + i * len;
        out.push({
          x: br.a.x + ax * t + ox,
          y: br.deckY,
          z: br.a.z + az * t + oz,
          len,
          alongX: ax,
          alongZ: az,
          side,
          phase: jetPhase(i, side),
          reach: 10 + 4 * (((i * 0.37) % 1) - 0.5),
          drop: br.deckY - waterY,
        });
      }
    }
  }
  return out;
}

/** Same jets from infra's nozzle lines (deck edge, y = nozzle height, outward = spray side). */
export function fountainJetsFromNozzles(
  nozzles: ReadonlyMap<string, readonly { a: Vec3; b: Vec3; outward: Vec2 }[]>,
  waterY: number,
  perSide = FOUNTAIN_JETS_PER_SIDE,
): Jet[] {
  const out: Jet[] = [];
  for (const lines of nozzles.values()) {
    for (const line of lines) {
      const dx = line.b.x - line.a.x;
      const dz = line.b.z - line.a.z;
      const span = Math.hypot(dx, dz);
      if (perSide <= 0 || span <= 2 * END_INSET) continue;
      const ax = dx / span;
      const az = dz / span;
      // The shader sprays toward (-along.z, along.x) * side.
      const side: 1 | -1 = -az * line.outward.x + ax * line.outward.z >= 0 ? 1 : -1;
      const len = (span - 2 * END_INSET) / perSide;
      for (let i = 0; i < perSide; i++) {
        const t = END_INSET + i * len;
        out.push({
          x: line.a.x + ax * t,
          y: line.a.y + (line.b.y - line.a.y) * (t / span),
          z: line.a.z + az * t,
          len,
          alongX: ax,
          alongZ: az,
          side,
          phase: jetPhase(i, side),
          reach: 10 + 4 * (((i * 0.37) % 1) - 0.5),
          drop: line.a.y - waterY,
        });
      }
    }
  }
  return out;
}

export function buildFountains(shared: NeonUniforms, jets: readonly Jet[]): THREE.Mesh {
  const n = jets.length;
  const iPos = new Float32Array(n * 4);
  const iParam = new Float32Array(n * 4);
  const iSize = new Float32Array(n * 2);
  jets.forEach((j, i) => {
    iPos.set([j.x, j.y, j.z, j.len], i * 4);
    iParam.set([j.alongX, j.alongZ, j.side, j.phase], i * 4);
    iSize.set([j.reach, j.drop], i * 2);
  });
  const plane = new THREE.PlaneGeometry(1, 1, 1, ARC_SEGMENTS).translate(0.5, 0.5, 0);
  const geo = setInstanceAttributes(toInstanced(plane), n, {
    iPos: { size: 4, data: iPos },
    iParam: { size: 4, data: iParam },
    iSize: { size: 2, data: iSize },
  });
  const c = (hex: number, k: number): THREE.Color => new THREE.Color(hex).multiplyScalar(k);
  const mat = glowMaterial(shared, GlowMode.fountain, {
    uniforms: {
      uGlowA: { value: c(NEON.neonCyan.hex, 1.4) },
      uHead: { value: c(NEON.neonWhite.hex, 1.2) },
      uGlowB: { value: c(NEON.neonMagenta.hex, 1.4) },
      // Daylight: plain white water.
      uTail: { value: c(NEON.neonWhite.hex, 1.6) },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'neon-fountains';
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}
