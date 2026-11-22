// Selection highlight (8.3): cyan 0.15 m lines along the tier edges of env.selectedBuilding,
// pulsing with a 1.5 s period. Rebuilt only when the selection changes; lines thicken with
// distance so they stay at least ~2 px wide.
import * as THREE from 'three';
import { toWorld, type BuildingSpec, type Tier } from '../city/layout';
import { NEON } from '../core/palette';
import { COMMON_PARS, EMISSIVE_TAIL, neonMaterial, type NeonUniforms } from './glsl';

const THICK = 0.15;

export interface Segment3 {
  a: [number, number, number];
  b: [number, number, number];
}

/** Pure: edge segments of every tier (box: 12 edges, cylinder: 24-gon rings + 4 verticals). */
export function tierEdges(b: BuildingSpec): Segment3[] {
  const out: Segment3[] = [];
  const tiers: Tier[] = b.twin ? [...b.tiers, ...b.twin] : b.tiers;
  for (const t of tiers) {
    const ring: [number, number][] = [];
    if (t.shape === 'cylinder') {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        ring.push([t.x + Math.cos(a) * (t.w / 2), t.z + Math.sin(a) * (t.w / 2)]);
      }
    } else {
      const c = t.shape === 'chamfer' ? t.chamfer : 0;
      const hw = t.w / 2;
      const hd = t.d / 2;
      const local: [number, number][] =
        c > 0
          ? [
              [-hw + c, -hd],
              [hw - c, -hd],
              [hw, -hd + c],
              [hw, hd - c],
              [hw - c, hd],
              [-hw + c, hd],
              [-hw, hd - c],
              [-hw, -hd + c],
            ]
          : [
              [-hw, -hd],
              [hw, -hd],
              [hw, hd],
              [-hw, hd],
            ];
      for (const [lx, lz] of local) {
        const p = toWorld(lx, lz, b.rotY);
        ring.push([t.x + p.x, t.z + p.z]);
      }
    }
    const verticals = t.shape === 'cylinder' ? [0, 6, 12, 18] : ring.map((_, i) => i);
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % ring.length] as [number, number];
      out.push({ a: [p[0], t.y0, p[1]], b: [q[0], t.y0, q[1]] });
      out.push({ a: [p[0], t.y1, p[1]], b: [q[0], t.y1, q[1]] });
    });
    for (const i of verticals) {
      const p = ring[i] as [number, number];
      out.push({ a: [p[0], t.y0, p[1]], b: [p[0], t.y1, p[1]] });
    }
  }
  return out;
}

/** Thin boxes along segments; `aAxis` holds the nearest point on the segment for thickening. */
function edgeGeometry(segs: readonly Segment3[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const axis: number[] = [];
  const idx: number[] = [];
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const d = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (const s of segs) {
    A.fromArray(s.a);
    B.fromArray(s.b);
    d.subVectors(B, A).normalize();
    u.set(0, 1, 0);
    if (Math.abs(d.y) > 0.9) u.set(1, 0, 0);
    v.crossVectors(d, u).normalize();
    u.crossVectors(v, d).normalize();
    const base = pos.length / 3;
    for (const end of [A, B]) {
      for (const [su, sv] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        pos.push(
          end.x + (u.x * su + v.x * sv) * THICK * 0.5,
          end.y + (u.y * su + v.y * sv) * THICK * 0.5,
          end.z + (u.z * su + v.z * sv) * THICK * 0.5,
        );
        axis.push(end.x, end.y, end.z);
      }
    }
    for (let k = 0; k < 4; k++) {
      const a0 = base + k;
      const a1 = base + ((k + 1) % 4);
      const b0 = a0 + 4;
      const b1 = a1 + 4;
      idx.push(a0, a1, b1, a0, b1, b0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aAxis', new THREE.Float32BufferAttribute(axis, 3));
  g.setIndex(idx);
  return g;
}

export interface Selection {
  mesh: THREE.Mesh;
  update(id: number | null, specs: readonly BuildingSpec[]): void;
  dispose(): void;
}

export function createSelection(shared: NeonUniforms): Selection {
  const color = new THREE.Color(NEON.neonCyan.hex).multiplyScalar(4);
  const mat = neonMaterial(shared, {
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: color }, uSince: { value: 0 } },
    vertexShader: /* glsl */ `
      ${COMMON_PARS}
      attribute vec3 aAxis;
      #include <fog_pars_vertex>
      void main() {
        float dist = length(cameraPosition - aAxis);
        float k = max(1.0, dist * 0.0023 / ${THICK.toFixed(2)});
        vec3 world = aAxis + (position - aAxis) * k;
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON_PARS}
      uniform vec3 uColor;
      uniform float uSince;
      #include <fog_pars_fragment>
      void main() {
        float pulse = 0.55 + 0.45 * cos((uTime - uSince) * 6.2831853 / 1.5);
        gl_FragColor = vec4(uColor * pulse, 1.0);
        ${EMISSIVE_TAIL}
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.name = 'neon-selection';
  mesh.visible = false;
  mesh.frustumCulled = false;
  let current: number | null = null;
  return {
    mesh,
    update(id, specs) {
      if (id === current) return;
      current = id;
      mesh.geometry.dispose();
      const b = id === null ? undefined : specs[id];
      if (!b) {
        mesh.geometry = new THREE.BufferGeometry();
        mesh.visible = false;
        return;
      }
      mesh.geometry = edgeGeometry(tierEdges(b));
      (mat.uniforms.uSince as THREE.IUniform<number>).value = shared.uTime.value;
      mesh.visible = true;
    },
    dispose() {
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
}
