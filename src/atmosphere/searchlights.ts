import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector3,
  Vector4,
  type IUniform,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MATERIAL } from '../core/palette';
import type { Ctx } from '../core/types';
import { type BeamParams, beamLength, searchlightDirection, searchlightMounts } from './logic';

export const BEAMS = {
  length: 1300,
  halfAngle: 0.04,
  alpha: 0.06,
  amplitude: (25 * Math.PI) / 180,
} as const;

interface BeamDef extends BeamParams {
  tower: number;
  color: number;
}

/** The skyline peaks the beams stand on (SEOUL.md 7.3); layouts without them use the tallest. */
export const SEARCHLIGHT_ZONES = ['yongsan', 'yeouido', 'jamsil'] as const;

const DEFS: readonly BeamDef[] = [
  {
    tower: 0,
    color: MATERIAL.searchlightWhite,
    azimuth: 0.4,
    period: 22,
    phase: 0,
    amplitude: BEAMS.amplitude,
    lean: 0.12,
  },
  {
    tower: 2,
    color: MATERIAL.searchlightCyan,
    azimuth: 2.3,
    period: 27,
    phase: 2.1,
    amplitude: BEAMS.amplitude,
    lean: 0.1,
  },
  {
    tower: 1,
    color: MATERIAL.searchlightWhite,
    azimuth: 4.1,
    period: 19,
    phase: 4.0,
    amplitude: BEAMS.amplitude,
    lean: 0.14,
  },
];

const VERTEX = /* glsl */ `
attribute float aBeam;
uniform vec4 uOrigin[3];
uniform vec4 uDir[3];
varying float vT;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vBeam;
void main() {
  int i = int( aBeam + 0.5 );
  vec4 O = uOrigin[ i ];
  vec4 D = uDir[ i ];
  vec3 dir = D.xyz;
  vec3 up = abs( dir.y ) < 0.99 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
  vec3 t1 = normalize( cross( up, dir ) );
  vec3 t2 = cross( dir, t1 );
  float L = D.w;
  vT = position.y;
  vBeam = aBeam;
  vec3 world = O.xyz + dir * position.y * L + ( t1 * position.x + t2 * position.z ) * L;
  vWorld = world;
  vNormalW = normalize( t1 * normal.x + t2 * normal.z );
  gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
}
`;

const FRAGMENT = /* glsl */ `
uniform vec4 uOrigin[3];
uniform vec3 uColor[3];
varying float vT;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vBeam;
void main() {
  int i = int( vBeam + 0.5 );
  vec3 V = normalize( cameraPosition - vWorld );
  float facing = pow( abs( dot( normalize( vNormalW ), V ) ), 1.5 );
  float along = pow( max( 1.0 - vT, 0.0 ), 1.4 ) * smoothstep( 0.0, 0.01, vT );
  float nearFade = smoothstep( 8.0, 60.0, length( cameraPosition - vWorld ) );
  float a = facing * along * nearFade * uOrigin[ i ].w;
  gl_FragColor = vec4( uColor[ i ] * a, 1.0 );
}
`;

export interface Searchlights {
  readonly spots: readonly Vector4[];
  readonly colors: readonly Color[];
  update(elapsed: number, level: number, fogK: number, cloudY: number): void;
  dispose(): void;
}

export function createSearchlights(ctx: Ctx): Searchlights {
  const { scene, LAYOUT } = ctx;
  const mounts = searchlightMounts(LAYOUT.buildings, SEARCHLIGHT_ZONES.length, SEARCHLIGHT_ZONES);

  const cones: BufferGeometry[] = DEFS.map((_, i) => {
    const g = new CylinderGeometry(BEAMS.halfAngle, 0.002, 1, 18, 1, true);
    g.translate(0, 0.5, 0);
    g.deleteAttribute('uv');
    const count = g.getAttribute('position').count;
    g.setAttribute('aBeam', new Float32BufferAttribute(new Array<number>(count).fill(i), 1));
    return g;
  });
  const geometry = mergeGeometries(cones);
  for (const c of cones) c.dispose();

  const origins = DEFS.map(() => new Vector4());
  const dirs = DEFS.map(() => new Vector4(0, 1, 0, 1));
  const colors = DEFS.map((d) => new Color(d.color));
  const spots = DEFS.map(() => new Vector4());
  const uniforms: Record<string, IUniform> = {
    uOrigin: { value: origins },
    uDir: { value: dirs },
    uColor: { value: colors },
  };
  const material = new ShaderMaterial({
    name: 'atmosphere.searchlights',
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'atmosphere.searchlights';
  mesh.frustumCulled = false;
  // Before the clouds, so dense cloud hides the beam above the deck.
  mesh.renderOrder = 15;
  scene.add(mesh);

  const origin = DEFS.map((d) => {
    const m = mounts[d.tower] ?? mounts[0];
    return m ? new Vector3(m.x, m.y, m.z) : null;
  });
  const dir: [number, number, number] = [0, 1, 0];

  return {
    spots,
    colors,
    update(elapsed, level, fogK, cloudY) {
      mesh.visible = level > 0.002 && mounts.length > 0;
      for (let i = 0; i < DEFS.length; i++) {
        const def = DEFS[i] as BeamDef;
        const o = origin[i];
        const od = origins[i] as Vector4;
        const dd = dirs[i] as Vector4;
        const sp = spots[i] as Vector4;
        if (!o) {
          od.w = 0;
          sp.w = 0;
          continue;
        }
        searchlightDirection(elapsed, def, dir);
        od.set(o.x, o.y, o.z, BEAMS.alpha * level * fogK);
        dd.set(dir[0], dir[1], dir[2], BEAMS.length);
        const hit = beamLength(o.y, dir[1], cloudY, BEAMS.length);
        const reaches = hit < BEAMS.length && mesh.visible;
        sp.set(
          o.x + dir[0] * hit,
          cloudY,
          o.z + dir[2] * hit,
          reaches ? level * (1 - hit / BEAMS.length) : 0,
        );
      }
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
