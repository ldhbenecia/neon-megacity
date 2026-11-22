// Giant vertical screens, ring billboards and holograms (5.2, 5.4). Fully procedural shaders:
// screens draw a fictional SDF face, a walking silhouette or flowing Korean type, switching every
// 12–20 s through a 0.4 s glitch. Nothing here is a real person, brand or logo.
import * as THREE from 'three';
import { NEON } from '../core/palette';
import type { Catalog } from './catalog';
import { ADDITIVE_TAIL, COMMON_PARS, EMISSIVE_TAIL, neonMaterial, type NeonUniforms } from './glsl';
import { setInstanceAttributes, toInstanced } from './geom';
import type { Holo, Ring, Screen } from './placement';

const lin = (hex: number): THREE.Color => new THREE.Color(hex);

export function buildScreens(
  shared: NeonUniforms,
  atlas: THREE.Texture,
  cat: Catalog,
  list: readonly Screen[],
): THREE.Mesh {
  const n = list.length;
  const iPos = new Float32Array(n * 3);
  const iDir = new Float32Array(n * 4); // nx, nz, w, h
  const iRect = new Float32Array(n * 4);
  const iLogo = new Float32Array(n * 4);
  const iParam = new Float32Array(n * 4); // hue, seed, zone, chars
  list.forEach((s, i) => {
    iPos.set([s.x, s.y, s.z], i * 3);
    iDir.set([s.nx, s.nz, s.w, s.h], i * 4);
    const c = cat.cells[s.cell];
    iRect.set(c?.uv ?? [0, 0, 0, 0], i * 4);
    iLogo.set(cat.cells[s.logo]?.uv ?? [0, 0, 0, 0], i * 4);
    iParam.set([s.hue, (s.seed % 9973) / 9973, s.zone, Math.max(1, c?.chars ?? 4)], i * 4);
  });
  const geo = setInstanceAttributes(toInstanced(new THREE.PlaneGeometry(1, 1)), n, {
    iPos: { size: 3, data: iPos },
    iDir: { size: 4, data: iDir },
    iRect: { size: 4, data: iRect },
    iLogo: { size: 4, data: iLogo },
    iParam: { size: 4, data: iParam },
  });
  const mat = neonMaterial(shared, {
    uniforms: {
      uAtlas: { value: atlas },
      uHueA: { value: lin(NEON.neonCyan.hex) },
      uHueB: { value: lin(NEON.neonOrange.hex) },
      uHueC: { value: lin(NEON.neonMagenta.hex) },
    },
    vertexShader: /* glsl */ `
      ${COMMON_PARS}
      attribute vec3 iPos; attribute vec4 iDir; attribute vec4 iRect; attribute vec4 iLogo; attribute vec4 iParam;
      varying vec2 vUv; varying vec2 vSize; varying vec4 vRect; varying vec4 vLogo; varying vec4 vParam; varying float vPower;
      #include <fog_pars_vertex>
      void main() {
        vec3 t = vec3(iDir.y, 0.0, -iDir.x);
        vec3 world = iPos + t * position.x * iDir.z + vec3(0.0, position.y * iDir.w, 0.0);
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vUv = uv; vSize = iDir.zw; vRect = iRect; vLogo = iLogo; vParam = iParam;
        vPower = powerOn(iParam.z, iParam.y * 40.0);
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON_PARS}
      uniform sampler2D uAtlas;
      uniform vec3 uHueA; uniform vec3 uHueB; uniform vec3 uHueC;
      varying vec2 vUv; varying vec2 vSize; varying vec4 vRect; varying vec4 vLogo; varying vec4 vParam; varying float vPower;
      #include <fog_pars_fragment>
      float sdEllipse(vec2 p, vec2 r) { return (length(p / r) - 1.0) * min(r.x, r.y); }
      float sdCapsule(vec2 p, vec2 a, vec2 b, float r) {
        vec2 pa = p - a; vec2 ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        return length(pa - ba * h) - r;
      }
      float fill(float d, float px) { return 1.0 - smoothstep(-px, px, d); }

      // Scene 0: a fictional face close-up (oval face, hair, blinking eyes, talking mouth).
      vec3 sceneFace(vec2 p, vec3 hue, float seed, float t) {
        float px = 0.01;
        vec3 col = mix(hue * 0.05, hue * 0.25, smoothstep(-1.5, 1.2, p.y));
        p.x += 0.02 * sin(t * 0.4 + seed * 6.0);
        float hair = fill(min(sdEllipse(p - vec2(0.0, 0.1), vec2(0.42, 0.55)),
                              sdCapsule(p, vec2(0.0, 0.0), vec2(0.0, -0.75), 0.36)), px);
        float shoulders = fill(sdEllipse(p - vec2(0.0, -1.15), vec2(0.75, 0.42)), px);
        float neck = fill(sdCapsule(p, vec2(0.0, -0.5), vec2(0.0, -0.85), 0.11), px);
        float face = fill(sdEllipse(p - vec2(0.0, 0.02), vec2(0.27, 0.38)), px);
        col = mix(col, hue * 0.03, max(hair, shoulders));
        col = mix(col, mix(hue, vec3(1.0), 0.55) * 0.55, neck * (1.0 - hair * 0.0));
        col = mix(col, mix(hue, vec3(1.0), 0.6) * 0.85, face);
        // Rim light from the hair edge.
        col += hue * 0.6 * hair * (1.0 - face) * smoothstep(0.25, 0.42, abs(p.x));
        float period = mix(4.0, 7.0, seed);
        float bt = mod(t + seed * 9.0, period);
        float open = 1.0 - smoothstep(0.0, 0.06, bt) * (1.0 - smoothstep(0.1, 0.18, bt));
        vec2 e = vec2(abs(p.x) - 0.105, p.y - 0.06);
        float eye = fill(sdEllipse(e, vec2(0.055, 0.022 * open + 0.002)), px * 0.6);
        float iris = fill(length(e - vec2(0.008 * sin(t * 0.7), 0.0)) - 0.018 * open, px * 0.5);
        col = mix(col, vec3(0.9), eye * face);
        col = mix(col, hue * 0.15, iris * eye * face);
        float talk = 0.5 + 0.5 * sin(t * 7.0 + sin(t * 2.3) * 2.0);
        float mouth = fill(sdEllipse(p - vec2(0.0, -0.19), vec2(0.06, 0.008 + 0.022 * talk * step(0.5, fract(t * 0.13 + seed)))), px * 0.6);
        col = mix(col, hue * 0.35 + vec3(0.25, 0.0, 0.05), mouth * face);
        float brow = fill(sdCapsule(vec2(abs(p.x), p.y), vec2(0.06, 0.12), vec2(0.15, 0.115), 0.008), px * 0.5);
        col = mix(col, hue * 0.1, brow * face);
        return col;
      }

      // Scene 1: a walking silhouette against a glowing backdrop.
      vec3 sceneWalk(vec2 p, vec3 hue, float seed, float t) {
        float px = 0.012;
        vec3 col = mix(hue * 0.9, hue * 0.2, smoothstep(-1.0, 1.5, p.y));
        col += hue * 0.3 * step(0.5, fract(p.y * 3.0 - t * 0.3)) * 0.3;
        float ph = t * 3.2 + seed * 10.0;
        vec2 q = p - vec2(0.0, -0.1);
        q.y -= abs(sin(ph)) * 0.02;
        float body = sdCapsule(q, vec2(0.0, 0.05), vec2(0.0, 0.5), 0.1);
        body = min(body, length(q - vec2(0.0, 0.68)) - 0.09);
        float sw = sin(ph) * 0.35;
        body = min(body, sdCapsule(q, vec2(0.0, 0.05), vec2(sin(sw) * 0.45, 0.05 - cos(sw) * 0.45), 0.055));
        body = min(body, sdCapsule(q, vec2(0.0, 0.05), vec2(-sin(sw) * 0.45, 0.05 - cos(sw) * 0.45), 0.055));
        body = min(body, sdCapsule(q, vec2(0.0, 0.45), vec2(-sin(sw) * 0.3, 0.45 - cos(sw) * 0.32), 0.04));
        body = min(body, sdCapsule(q, vec2(0.0, 0.45), vec2(sin(sw) * 0.3, 0.45 - cos(sw) * 0.32), 0.04));
        col = mix(col, vec3(0.005), fill(body, px));
        col = mix(col, hue * 0.05, step(p.y, -0.42));
        return col;
      }

      // Scene 2: Korean type flowing upward under a corp mark.
      vec3 sceneType(vec2 uv, vec3 hue, float t) {
        vec3 col = hue * 0.04;
        if (uv.y > 0.78) {
          vec2 l = vec2(uv.x, (uv.y - 0.78) / 0.22);
          vec2 q = (l - 0.5) * vec2(1.0, 0.22 * vSize.y / vSize.x * 0.5) + 0.5;
          if (q.y > 0.0 && q.y < 1.0) col += texture2D(uAtlas, vLogo.xy + clamp(q, 0.01, 0.99) * vLogo.zw).rgb;
        } else {
          float chars = vParam.w;
          float rep = (0.78 * vSize.y / vSize.x) / chars;
          float y = fract(uv.y / 0.78 * rep + t * 0.06 * uScroll);
          vec3 g = texture2D(uAtlas, vRect.xy + clamp(vec2(uv.x, y), 0.01, 0.99) * vRect.zw).rgb;
          col += g * mix(hue, vec3(1.0), 0.3) * 1.2;
        }
        return col;
      }

      void main() {
        float seed = vParam.y;
        vec3 hue = vParam.x < 0.5 ? uHueA : (vParam.x < 1.5 ? uHueB : uHueC);
        float t = uTime;
        vec2 cells = vSize / 0.25;
        vec2 uv = vUv;
        float period = mix(12.0, 20.0, seed);
        float k = (t + seed * 50.0) / period;
        float idx = floor(k);
        float local = fract(k) * period;
        float glitch = (local < 0.4 && uMotion > 0.5) ? 1.0 : 0.0;
        if (glitch > 0.5) {
          float band = floor(uv.y * 24.0);
          uv.x = fract(uv.x + (nHash(band + floor(t * 30.0)) - 0.5) * 0.25);
        }
        vec2 cuv = (floor(uv * cells) + 0.5) / cells;
        float scene = mod(idx + floor(seed * 3.0), 3.0);
        vec2 p = vec2(cuv.x - 0.5, (cuv.y - 0.62) * vSize.y / vSize.x) * 1.1;
        vec3 col;
        if (scene < 0.5) col = sceneFace(p, hue, seed, t);
        else if (scene < 1.5) col = sceneWalk(p * 0.8, hue, seed, t);
        else col = sceneType(cuv, hue, t);
        if (glitch > 0.5) col = vec3(col.r * 1.4, col.g * 0.7, col.b * 1.3) + hue * 0.2 * nHash(floor(cuv.y * 40.0) + t);
        vec2 led = fract(uv * cells);
        float mask = smoothstep(0.0, 0.18, led.x) * smoothstep(1.0, 0.82, led.x) * smoothstep(0.0, 0.18, led.y) * smoothstep(1.0, 0.82, led.y);
        float scan = 0.85 + 0.15 * sin(uv.y * vSize.y * 1.3 - t * 2.0);
        float bright = mix(1.5, 2.2, fract(seed * 13.0));
        col *= mix(0.45, 1.0, mask) * scan * bright * uScreenGain * vPower;
        // Thin bezel.
        float edge = min(min(vUv.x, 1.0 - vUv.x) * vSize.x, min(vUv.y, 1.0 - vUv.y) * vSize.y);
        col *= smoothstep(0.2, 0.5, edge);
        gl_FragColor = vec4(col, 1.0);
        ${EMISSIVE_TAIL}
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'neon-screens';
  mesh.frustumCulled = false;
  return mesh;
}

export function buildRings(
  shared: NeonUniforms,
  atlas: THREE.Texture,
  cat: Catalog,
  list: readonly Ring[],
): THREE.Mesh {
  const n = list.length;
  const iPos = new Float32Array(n * 4); // x, y, z, radius
  const iRect = new Float32Array(n * 4);
  const iParam = new Float32Array(n * 4); // h, rate, cellAspect, zone
  const iColor = new Float32Array(n * 3);
  const col = new THREE.Color();
  list.forEach((r, i) => {
    iPos.set([r.x, r.y, r.z, r.radius], i * 4);
    const c = cat.cells[r.cell];
    iRect.set(c?.uv ?? [0, 0, 0, 0], i * 4);
    iParam.set([r.h, r.rate, c?.aspect ?? 16, r.zone], i * 4);
    col.setHex(NEON[r.color].hex);
    iColor.set([col.r * 5, col.g * 5, col.b * 5], i * 3);
  });
  const geo = setInstanceAttributes(
    toInstanced(new THREE.CylinderGeometry(1, 1, 1, 64, 1, true)),
    n,
    {
      iPos: { size: 4, data: iPos },
      iRect: { size: 4, data: iRect },
      iParam: { size: 4, data: iParam },
      iColor: { size: 3, data: iColor },
    },
  );
  const mat = neonMaterial(shared, {
    uniforms: { uAtlas: { value: atlas } },
    vertexShader: /* glsl */ `
      ${COMMON_PARS}
      attribute vec4 iPos; attribute vec4 iRect; attribute vec4 iParam; attribute vec3 iColor;
      varying vec2 vUv; varying vec4 vRect; varying vec4 vParam; varying vec3 vColor; varying float vPower;
      #include <fog_pars_vertex>
      void main() {
        vec3 world = iPos.xyz + vec3(position.x * iPos.w, position.y * iParam.x, position.z * iPos.w);
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vUv = uv; vRect = iRect; vColor = iColor;
        vParam = vec4(iParam.x, iParam.y, iParam.z, 6.2831853 * iPos.w);
        vPower = powerOn(iParam.w, iPos.w);
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON_PARS}
      uniform sampler2D uAtlas;
      varying vec2 vUv; varying vec4 vRect; varying vec4 vParam; varying vec3 vColor; varying float vPower;
      #include <fog_pars_fragment>
      void main() {
        float h = vParam.x;
        float border = 0.3 / h;
        vec3 col;
        if (vUv.y < border || vUv.y > 1.0 - border) {
          col = vColor;
        } else {
          float inner = (vUv.y - border) / (1.0 - 2.0 * border);
          float innerH = h * (1.0 - 2.0 * border);
          float reps = max(1.0, floor(vParam.w / (innerH * vParam.z) + 0.5));
          float u = fract(vUv.x * reps + uTime * vParam.y * reps * uScroll);
          col = texture2D(uAtlas, vRect.xy + clamp(vec2(u, inner), 0.005, 0.995) * vRect.zw).rgb;
          float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col *= mix(1.0, 3.5, smoothstep(0.1, 0.6, lum));
        }
        gl_FragColor = vec4(col * uScreenGain * vPower, 1.0);
        ${EMISSIVE_TAIL}
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'neon-rings';
  mesh.frustumCulled = false;
  return mesh;
}

export function buildHolograms(
  shared: NeonUniforms,
  atlas: THREE.Texture,
  cat: Catalog,
  list: readonly Holo[],
): THREE.Mesh {
  const n = list.length;
  const iPos = new Float32Array(n * 4); // x, y, z, size
  const iRect = new Float32Array(n * 4);
  const iParam = new Float32Array(n * 4); // spin, alpha, seed, zone
  list.forEach((h, i) => {
    iPos.set([h.x, h.y, h.z, h.size], i * 4);
    iRect.set(cat.cells[h.cell]?.uv ?? [0, 0, 0, 0], i * 4);
    iParam.set([h.spin, h.alpha, (h.seed % 9973) / 9973, h.zone], i * 4);
  });
  // Two crossed vertical quads.
  const a = new THREE.PlaneGeometry(1, 1);
  const b = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2);
  const merged = new THREE.BufferGeometry();
  const pos = [...a.getAttribute('position').array, ...b.getAttribute('position').array];
  const uv = [...a.getAttribute('uv').array, ...b.getAttribute('uv').array];
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  merged.setIndex([0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5]);
  a.dispose();
  b.dispose();
  const geo = setInstanceAttributes(toInstanced(merged), n, {
    iPos: { size: 4, data: iPos },
    iRect: { size: 4, data: iRect },
    iParam: { size: 4, data: iParam },
  });
  const mat = neonMaterial(shared, {
    additive: true,
    side: THREE.DoubleSide,
    uniforms: { uAtlas: { value: atlas }, uTint: { value: lin(NEON.neonCyan.hex) } },
    vertexShader: /* glsl */ `
      ${COMMON_PARS}
      attribute vec4 iPos; attribute vec4 iRect; attribute vec4 iParam;
      varying vec2 vUv; varying vec4 vRect; varying vec4 vParam; varying float vWorldY; varying float vPower;
      #include <fog_pars_vertex>
      void main() {
        float ang = uTime * iParam.x + iParam.z * 6.28;
        float c = cos(ang); float s = sin(ang);
        vec3 p = position * iPos.w;
        // Vertical jitter of 1–2% every 3–7 s (5.4).
        float period = mix(3.0, 7.0, iParam.z);
        float jt = mod(uTime + iParam.z * 20.0, period);
        float jitter = (jt < 0.12 && uMotion > 0.5) ? (nHash(floor(uTime * 20.0) + iParam.z) - 0.5) * 0.04 : 0.0;
        vec3 world = iPos.xyz + vec3(c * p.x + s * p.z, p.y + jitter * iPos.w, -s * p.x + c * p.z);
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vUv = uv; vRect = iRect; vParam = iParam; vWorldY = world.y;
        vPower = powerOn(iParam.w, iParam.z * 30.0);
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON_PARS}
      uniform sampler2D uAtlas; uniform vec3 uTint;
      varying vec2 vUv; varying vec4 vRect; varying vec4 vParam; varying float vWorldY; varying float vPower;
      #include <fog_pars_fragment>
      void main() {
        vec3 tex = texture2D(uAtlas, vRect.xy + clamp(vUv, 0.01, 0.99) * vRect.zw).rgb;
        float lum = max(tex.r, max(tex.g, tex.b));
        float scan = 0.55 + 0.45 * step(0.5, fract(vWorldY / 0.4));
        vec3 col = mix(tex, uTint * lum, 0.35) * 3.0;
        float a = vParam.y * scan * smoothstep(0.03, 0.25, lum) * vPower * uGain;
        gl_FragColor = vec4(col * a, 1.0);
        ${ADDITIVE_TAIL}
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'neon-holograms';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return mesh;
}
