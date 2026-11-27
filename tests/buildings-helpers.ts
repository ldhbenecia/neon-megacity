import type * as THREE from 'three';
import { GeoBuilder } from '../src/buildings/builder';
import type { Targets } from '../src/buildings/archetypes';

export const targets = (): Targets => ({
  l0: new GeoBuilder(0, 0),
  l1: new GeoBuilder(0, 0),
  l2: new GeoBuilder(0, 0),
});

export function windingAgreement(g: THREE.BufferGeometry): number {
  const P = g.getAttribute('position');
  const N = g.getAttribute('normal');
  const I = g.getIndex();
  if (!I) return 0;
  let ok = 0;
  let total = 0;
  for (let i = 0; i < I.count; i += 3) {
    const [a, b, c] = [I.getX(i), I.getX(i + 1), I.getX(i + 2)];
    const ux = P.getX(b) - P.getX(a);
    const uy = P.getY(b) - P.getY(a);
    const uz = P.getZ(b) - P.getZ(a);
    const vx = P.getX(c) - P.getX(a);
    const vy = P.getY(c) - P.getY(a);
    const vz = P.getZ(c) - P.getZ(a);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-6) continue;
    const sx = N.getX(a) + N.getX(b) + N.getX(c);
    const sy = N.getY(a) + N.getY(b) + N.getY(c);
    const sz = N.getZ(a) + N.getZ(b) + N.getZ(c);
    total++;
    if (nx * sx + ny * sy + nz * sz > 0) ok++;
  }
  return total ? ok / total : 0;
}
