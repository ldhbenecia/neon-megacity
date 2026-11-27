import * as THREE from 'three';
import { NEON } from '../core/palette';
import type { Catalog } from './catalog';
import { setInstanceAttributes, toInstanced } from './geom';
import type { NeonUniforms } from './glsl';
import { GlowMode, glowMaterial } from './glow';
import type { FlatSign } from './placement';

// Painted lettering on warehouse walls (Seongsu): not emissive, so it is drawn additively only
// where three gooseneck lamps light it. `signs` are the placement's wash signs.
export function buildPaint(
  shared: NeonUniforms,
  atlas: THREE.Texture,
  cat: Catalog,
  signs: readonly FlatSign[],
): THREE.Mesh {
  const n = signs.length;
  const iPos = new Float32Array(n * 4);
  const iParam = new Float32Array(n * 4);
  const iSize = new Float32Array(n * 2);
  const iRect = new Float32Array(n * 4);
  signs.forEach((s, i) => {
    iPos.set([s.x, s.y0, s.z, 0], i * 4);
    iParam.set([s.nx, s.nz, 0, (s.seed % 997) / 997], i * 4);
    iSize.set([s.w, s.h], i * 2);
    iRect.set(cat.cells[s.cell]?.uv ?? [0, 0, 0, 0], i * 4);
  });
  const geo = setInstanceAttributes(
    toInstanced(new THREE.PlaneGeometry(1, 1, 8, 8).translate(0, 0.5, 0)),
    n,
    {
      iPos: { size: 4, data: iPos },
      iParam: { size: 4, data: iParam },
      iSize: { size: 2, data: iSize },
      iRect: { size: 4, data: iRect },
    },
  );
  const mat = glowMaterial(shared, GlowMode.paint, {
    atlas,
    uniforms: {
      // Faded cream paint, tungsten lamps.
      uHead: { value: new THREE.Color(NEON.windowWarm.hex).multiplyScalar(0.9) },
      uTail: { value: new THREE.Color(NEON.neonAmber.hex).multiplyScalar(0.8) },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'neon-wall-paint';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}
