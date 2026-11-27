import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NEON, type NeonName } from '../core/palette';
import type { Catalog } from './catalog';
import { COMMON_PARS, EMISSIVE_TAIL, neonMaterial, type NeonUniforms } from './glsl';
import { hdrColor, setInstanceAttributes, toInstanced } from './geom';
import { GlowMode, glowMaterial } from './glow';
import type { FlatSign } from './placement';

export function neonHdr(name: NeonName, t: number): number {
  const [a, b] = NEON[name].hdr;
  return a + (b - a) * t;
}

const FAR_FADE_KINDS = new Set(['band', 'blade', 'panel', 'ad', 'tent']);

export function buildFlatSigns(
  shared: NeonUniforms,
  atlas: THREE.Texture,
  cat: Catalog,
  flats: readonly FlatSign[],
): THREE.Mesh {
  const n = flats.length;
  const iPos = new Float32Array(n * 3);
  const iDir = new Float32Array(n * 4);
  const iSize = new Float32Array(n * 4);
  const iRect = new Float32Array(n * 4);
  const iAnim = new Float32Array(n * 4);
  flats.forEach((s, i) => {
    const cell = cat.cells[s.cell];
    iPos.set([s.x, s.y, s.z], i * 3);
    iDir.set([s.nx, s.nz, s.doubleSided ? 1 : 0, FAR_FADE_KINDS.has(s.kind) ? 1 : 0], i * 4);
    iSize.set(
      [
        s.w,
        s.h,
        cell?.aspect ?? 1,
        // Glyph count for the broken-glyph animation; negative marks vertical text (index by y).
        Math.max(1, cell?.chars || Array.from(cell?.text ?? 'x').length) *
          (s.kind === 'vtext' || s.kind === 'blade' ? -1 : 1),
      ],
      i * 4,
    );
    iRect.set(cell?.uv ?? [0, 0, 0, 0], i * 4);
    const hdr =
      s.kind === 'ad' || s.kind === 'tent'
        ? 1.6
        : s.kind === 'crown'
          ? 1.5
          : neonHdr(s.color, (s.seed % 97) / 97) * 0.75;
    iAnim.set([s.anim, (s.seed % 9973) / 9973, s.zone, hdr], i * 4);
  });
  const geo = toInstanced(new THREE.PlaneGeometry(1, 1));
  setInstanceAttributes(geo, n, {
    iPos: { size: 3, data: iPos },
    iDir: { size: 4, data: iDir },
    iSize: { size: 4, data: iSize },
    iRect: { size: 4, data: iRect },
    iAnim: { size: 4, data: iAnim },
  });
  const mat = neonMaterial(shared, {
    side: THREE.DoubleSide,
    uniforms: { uAtlas: { value: atlas } },
    vertexShader: /* glsl */ `
      ${COMMON_PARS}
      attribute vec3 iPos; attribute vec4 iDir; attribute vec4 iSize; attribute vec4 iRect; attribute vec4 iAnim;
      varying vec2 vUv; varying vec4 vRect; varying vec4 vSize; varying vec4 vAnim; varying float vDouble;
      varying float vFar; varying float vPower;
      #include <fog_pars_vertex>
      void main() {
        vec3 n = vec3(iDir.x, 0.0, iDir.y);
        vec3 t = vec3(iDir.y, 0.0, -iDir.x);
        vec3 world = iPos + t * position.x * iSize.x + vec3(0.0, position.y * iSize.y, 0.0);
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vUv = uv; vRect = iRect; vSize = iSize; vAnim = iAnim; vDouble = iDir.z;
        float dist = length(cameraPosition - iPos);
        vFar = iDir.w > 0.5 ? 1.0 - smoothstep(600.0, 700.0, dist) : 1.0;
        vPower = powerOn(iAnim.z, iAnim.y * 50.0);
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON_PARS}
      uniform sampler2D uAtlas;
      varying vec2 vUv; varying vec4 vRect; varying vec4 vSize; varying vec4 vAnim; varying float vDouble;
      varying float vFar; varying float vPower;
      #include <fog_pars_fragment>
      void main() {
        if (vFar < 1.0 && nHash2(gl_FragCoord.xy) > vFar) discard;
        vec2 uv = vUv;
        if (!gl_FrontFacing) {
          if (vDouble < 0.5) { gl_FragColor = vec4(0.004, 0.005, 0.006, 1.0); ${EMISSIVE_TAIL} return; }
          uv.x = 1.0 - uv.x;
        }
        float quadAspect = vSize.x / vSize.y;
        float cellAspect = vSize.z;
        vec2 q = uv;
        float mode = vAnim.x;
        if (mode > 1.5 && mode < 2.5) {
          float glyphs = max(4.0, cellAspect * 1.4);
          q.x = fract(uv.x * quadAspect / cellAspect + uTime * uScroll * mix(0.5, 1.5, vAnim.y) / glyphs);
        } else if (quadAspect > cellAspect) {
          q.x = (uv.x - 0.5) * quadAspect / cellAspect + 0.5;
        } else {
          q.y = (uv.y - 0.5) * cellAspect / quadAspect + 0.5;
        }
        q = clamp(q, vec2(0.004), vec2(0.996));
        vec3 col = texture2D(uAtlas, vRect.xy + q * vRect.zw).rgb;
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        float on = vPower;
        if (mode > 0.5 && mode < 1.5) on *= flicker(vAnim.y * 100.0);
        if (mode > 2.5 && mode < 3.5 && uMotion > 0.5) {
          float glyphs = abs(vSize.w);
          float glyph = floor((vSize.w < 0.0 ? q.y : q.x) * glyphs);
          float target = floor(vAnim.y * glyphs);
          float rate = mix(0.5, 2.0, fract(vAnim.y * 7.0));
          if (glyph == target) on *= step(0.45, nHash(floor(uTime * rate * 2.0) + vAnim.y * 31.0));
        }
        float boost = mix(1.0, vAnim.w, smoothstep(0.08, 0.55, lum));
        vec3 board = col * 0.6;
        gl_FragColor = vec4(mix(board, col * boost * uGain, on), 1.0);
        ${EMISSIVE_TAIL}
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'neon-flat-signs';
  mesh.frustumCulled = false;
  return mesh;
}

export interface SolidInstance {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rotY: number;
  color: [number, number, number];
  anim: number;
  seed: number;
  zone: number;
  minPx?: number;
}

export function emissiveSolidMaterial(
  shared: NeonUniforms,
  opts: { additive?: boolean; alpha?: number } = {},
): THREE.ShaderMaterial {
  return neonMaterial(shared, {
    additive: opts.additive ?? false,
    side: opts.additive ? THREE.DoubleSide : THREE.FrontSide,
    uniforms: { uAlpha: { value: opts.alpha ?? 1 } },
    vertexShader: /* glsl */ `
      ${COMMON_PARS}
      attribute vec4 iPos;
      attribute vec3 iScale;
      attribute vec3 iColor;
      attribute vec4 iAnim;
      varying vec3 vCol; varying float vY; varying vec4 vAnim; varying float vPower;
      #include <fog_pars_vertex>
      void main() {
        float c = cos(iPos.w); float s = sin(iPos.w);
        vec3 p = position * iScale;
        if (iAnim.w > 0.5) {
          float dist = length(cameraPosition - iPos.xyz - vec3(0.0, p.y, 0.0));
          p.xz *= max(1.0, dist * 0.0012 / max(iScale.x, 1e-3));
        }
        vec3 world = iPos.xyz + vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vCol = iColor; vY = position.y; vAnim = iAnim;
        vPower = powerOn(iAnim.z, iAnim.y * 50.0);
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON_PARS}
      uniform float uAlpha;
      varying vec3 vCol; varying float vY; varying vec4 vAnim; varying float vPower;
      #include <fog_pars_fragment>
      void main() {
        float on = vPower;
        float mode = vAnim.x;
        if (mode > 0.5 && mode < 1.5) on *= flicker(vAnim.y * 100.0);
        if (mode > 3.5) {
          float rise = mix(1.2, 2.5, vAnim.y);
          float ph = mod(uTime + vAnim.y * 13.0, rise + 0.5);
          float level = uMotion > 0.5 ? min(ph / rise, 1.0) : 1.0;
          on *= mix(0.12, 1.0, step(vY, level));
        }
        vec3 col = vCol * uGain * on;
        gl_FragColor = vec4(col * uAlpha, 1.0);
        ${EMISSIVE_TAIL}
      }
    `,
  });
}

export function buildEmissiveSolids(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  list: readonly SolidInstance[],
  name: string,
): THREE.Mesh {
  const n = list.length;
  const iPos = new Float32Array(n * 4);
  const iScale = new Float32Array(n * 3);
  const iColor = new Float32Array(n * 3);
  const iAnim = new Float32Array(n * 4);
  list.forEach((s, i) => {
    iPos.set([s.x, s.y, s.z, s.rotY], i * 4);
    iScale.set([s.sx, s.sy, s.sz], i * 3);
    iColor.set(s.color, i * 3);
    iAnim.set([s.anim, (s.seed % 9973) / 9973, s.zone, s.minPx ?? 0], i * 4);
  });
  const geo = setInstanceAttributes(toInstanced(geometry), n, {
    iPos: { size: 4, data: iPos },
    iScale: { size: 3, data: iScale },
    iColor: { size: 3, data: iColor },
    iAnim: { size: 4, data: iAnim },
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  return mesh;
}

export function tubeGeometry(): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
}

export const CROSS_REF_H = 6;
export function crossGeometry(): THREE.BufferGeometry {
  const t = 0.35;
  const h = CROSS_REF_H;
  const parts = [
    new THREE.BoxGeometry(t, h, t).translate(0, h / 2, 0),
    new THREE.BoxGeometry(0.55 * h, t, t).translate(0, h * 0.7, 0),
  ];
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return g;
}

export interface HaloInstance {
  x: number;
  y: number;
  z: number;
  size: number;
  color: [number, number, number];
  zone: number;
}

export function buildHalos(shared: NeonUniforms, list: readonly HaloInstance[]): THREE.Mesh {
  const n = list.length;
  const iPos = new Float32Array(n * 4);
  const iColor = new Float32Array(n * 4);
  list.forEach((h, i) => {
    iPos.set([h.x, h.y, h.z, h.size], i * 4);
    iColor.set([...h.color, h.zone], i * 4);
  });
  const geo = setInstanceAttributes(toInstanced(new THREE.PlaneGeometry(2, 2)), n, {
    iPos: { size: 4, data: iPos },
    iColor: { size: 4, data: iColor },
  });
  const mat = glowMaterial(shared, GlowMode.halo);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'neon-halos';
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

export interface DecalInstance {
  x: number;
  y: number;
  z: number;
  width: number;
  /** Negative marks a round light pool of radius `width` (no camera stretch). */
  length: number;
  color: [number, number, number];
}

export function buildReflections(shared: NeonUniforms, list: readonly DecalInstance[]): THREE.Mesh {
  const n = list.length;
  const iPos = new Float32Array(n * 4);
  const iSize = new Float32Array(n * 2);
  const iColor = new Float32Array(n * 4);
  list.forEach((d, i) => {
    iPos.set([d.x, d.y, d.z, 0], i * 4);
    iSize.set([d.width, d.length], i * 2);
    iColor.set([...d.color, 0], i * 4);
  });
  const geo = setInstanceAttributes(
    toInstanced(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0)),
    n,
    {
      iPos: { size: 4, data: iPos },
      iSize: { size: 2, data: iSize },
      iColor: { size: 4, data: iColor },
    },
  );
  const mat = glowMaterial(shared, GlowMode.decal);
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -2;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'neon-reflections';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

export function signColor(name: NeonName, mult: number): [number, number, number] {
  return hdrColor(NEON[name].hex, mult);
}
