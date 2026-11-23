import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NEON, type NeonName } from '../core/palette';
import type { Catalog } from './catalog';
import { ADDITIVE_TAIL, COMMON_PARS, EMISSIVE_TAIL, neonMaterial, type NeonUniforms } from './glsl';
import { hdrColor, setInstanceAttributes, toInstanced } from './geom';
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
  const mat = neonMaterial(shared, {
    additive: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${COMMON_PARS}
      attribute vec4 iPos; attribute vec4 iColor;
      varying vec2 vUv; varying vec3 vCol; varying float vAlpha;
      #include <fog_pars_vertex>
      #if defined(USE_FOG) && defined(FOG_EXP2)
        uniform float fogDensity;
      #endif
      void main() {
        vec4 mvPosition = viewMatrix * vec4(iPos.xyz, 1.0);
        float dist = -mvPosition.z;
        float r = iPos.w * (1.0 + dist / 400.0);
        // Pulled toward the camera so the disc does not clip into the wall behind the sign.
        mvPosition.xyz *= max(0.2, 1.0 - min(r * 0.6, dist * 0.3) / max(dist, 1.0));
        mvPosition.xy += position.xy * r;
        gl_Position = projectionMatrix * mvPosition;
        float fogE = 0.0;
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            fogE = 1.0 - exp(-pow(fogDensity * 0.55 * dist, 2.0));
          #endif
        #endif
        vAlpha = (0.02 + fogE * 0.35) * powerOn(iColor.w, 3.0) * uGain;
        vCol = iColor.rgb;
        vUv = position.xy;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON_PARS}
      varying vec2 vUv; varying vec3 vCol; varying float vAlpha;
      void main() {
        float d = dot(vUv, vUv);
        float a = exp(-d * 4.0) * (1.0 - smoothstep(0.7, 1.0, d));
        gl_FragColor = vec4(vCol * a * vAlpha, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  mat.depthTest = true;
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
  length: number;
  color: [number, number, number];
}

export function buildReflections(shared: NeonUniforms, list: readonly DecalInstance[]): THREE.Mesh {
  const n = list.length;
  const iPos = new Float32Array(n * 3);
  const iSize = new Float32Array(n * 2);
  const iColor = new Float32Array(n * 3);
  list.forEach((d, i) => {
    iPos.set([d.x, d.y, d.z], i * 3);
    iSize.set([d.width, d.length], i * 2);
    iColor.set(d.color, i * 3);
  });
  const geo = setInstanceAttributes(
    toInstanced(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0)),
    n,
    {
      iPos: { size: 3, data: iPos },
      iSize: { size: 2, data: iSize },
      iColor: { size: 3, data: iColor },
    },
  );
  const mat = neonMaterial(shared, {
    additive: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${COMMON_PARS}
      attribute vec3 iPos; attribute vec2 iSize; attribute vec3 iColor;
      varying vec2 vUv; varying vec3 vCol; varying float vFade; varying vec2 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec2 toCam = cameraPosition.xz - iPos.xz;
        float dist = length(toCam);
        vec2 dir = dist > 1e-3 ? toCam / dist : vec2(0.0, 1.0);
        vec2 side = vec2(-dir.y, dir.x);
        float len = min(iSize.y, dist * 0.8);
        vec2 xz = iPos.xz + side * position.x * iSize.x + dir * position.y * len;
        vec3 world = vec3(xz.x, iPos.y, xz.y);
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vUv = vec2(position.x, position.y);
        vCol = iColor;
        vFade = 1.0 - smoothstep(300.0, 400.0, dist);
        vWorld = xz;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON_PARS}
      varying vec2 vUv; varying vec3 vCol; varying float vFade; varying vec2 vWorld;
      #include <fog_pars_fragment>
      float vnoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(nHash2(i), nHash2(i + vec2(1, 0)), f.x), mix(nHash2(i + vec2(0, 1)), nHash2(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        if (vFade <= 0.0) discard;
        float across = exp(-vUv.x * vUv.x * 9.0);
        float along = pow(1.0 - vUv.y, 1.4) * smoothstep(0.0, 0.08, vUv.y);
        vec2 p = vWorld * 0.35 + vec2(0.0, uTime * 0.3 * 0.35);
        float puddle = smoothstep(0.35, 0.75, vnoise(vWorld * 0.06));
        float ripple = 0.6 + 0.4 * vnoise(p + vnoise(p * 2.3) * 0.8);
        float a = uWet * 0.6 * mix(0.35, 1.0, puddle) * ripple * across * along * vFade * uGain * uNight;
        gl_FragColor = vec4(vCol * a, 1.0);
        ${ADDITIVE_TAIL}
      }
    `,
  });
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
