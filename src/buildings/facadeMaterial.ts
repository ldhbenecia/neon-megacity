import * as THREE from 'three';
import { MATERIAL, NEON, WINDOW_MIX } from '../core/palette';

export interface FacadeUniforms {
  uLitRatio: { value: number };
  uNight: { value: number };
  uPower: { value: number };
  uTime: { value: number };
  uDigits: { value: THREE.Texture };
  uWinColors: { value: THREE.Color[] };
  uWhite: { value: THREE.Color };
  uDong: { value: THREE.Color };
  uShop: { value: THREE.Color };
}

const lin = (hex: number): THREE.Color => new THREE.Color().setHex(hex);

function digitAtlas(): THREE.CanvasTexture {
  const cw = 64;
  const ch = 96;
  const canvas = document.createElement('canvas');
  canvas.width = cw * 10;
  canvas.height = ch;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2d canvas unavailable');
  g.fillStyle = '#000';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 84px "Helvetica Neue", Arial, sans-serif';
  for (let i = 0; i < 10; i++) g.fillText(String(i), cw * (i + 0.5), ch * 0.54);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace; // mask, not color
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

const VERT_PARS = /* glsl */ `
attribute vec2 aFace;
attribute vec4 aWin;
attribute vec4 aInfo;
varying vec2 vFace;
varying vec4 vWin;
varying vec4 vInfo;
`;

const FRAG_PARS = /* glsl */ `
varying vec2 vFace;
varying vec4 vWin;
varying vec4 vInfo;
uniform float uLitRatio;
uniform float uNight;
uniform float uPower;
uniform float uTime;
uniform sampler2D uDigits;
uniform vec3 uWinColors[4];
uniform vec3 uWhite;
uniform vec3 uDong;
uniform vec3 uShop;

float fhash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float pulseI(float x, float a, float b) { return floor(x) * (b - a) + clamp(fract(x), a, b) - a; }
float fpulse(float x, float a, float b, float w) {
  w = max(w, 1e-4);
  return (pulseI(x + 0.5 * w, a, b) - pulseI(x - 0.5 * w, a, b)) / w;
}

vec3 windowLight(vec2 key, float office, float fx, float fy, float vy) {
  float hC = fhash(key + 5.7);
  float h2 = fhash(key + 11.3);
  float warmT = ${WINDOW_MIX.windowWarm.toFixed(3)} - office * 0.25;
  float amberT = warmT + ${WINDOW_MIX.windowAmber.toFixed(3)};
  float coolT = amberT + ${WINDOW_MIX.windowCool.toFixed(3)} + office * 0.25;
  vec3 c;
  float hdr;
  if (hC < warmT) { c = uWinColors[0]; hdr = ${NEON.windowWarm.hdr[0].toFixed(2)} + 0.3 * h2; }
  else if (hC < amberT) { c = uWinColors[1]; hdr = ${NEON.windowAmber.hdr[0].toFixed(2)} + 0.25 * h2; }
  else if (hC < coolT) { c = uWinColors[2]; hdr = ${NEON.windowCool.hdr[0].toFixed(2)} + 0.25 * h2; }
  else {
    c = uWinColors[3];
    hdr = ${NEON.windowTV.hdr[0].toFixed(2)} + 0.12 * (1.0 + sin(uTime * 6.2832 * (0.3 + 0.7 * h2)));
  }
  if (fhash(key + 9.1) < 0.1) {
    float level = 0.35 + 0.5 * fhash(key + 3.3);
    hdr *= (0.4 + 0.3 * h2) * mix(1.0, 0.45, smoothstep(level - 0.04, level + 0.04, fy));
  }
  hdr *= 0.68 + 0.42 * fy;
  hdr *= 0.7 + 0.3 * fhash(key + floor(fx * 3.0) * 7.31);
  return c * hdr;
}
`;

const FRAG_MAIN = /* glsl */ `
  float fType = floor(vInfo.x * 0.5 + 0.01);
  float fShop = vInfo.x - fType * 2.0;
  // Interpolated constants jitter in the last bits and would re-roll every hash per pixel.
  float fSeed = floor(vInfo.y * 1024.0 + 0.5) / 1024.0;
  float fLit = vInfo.z;
  float fParam = vInfo.w;
  vec3 fAlbedo = diffuseColor.rgb;
  float fRough = 0.82;
  float fMetal = 0.04;
  vec3 fEmit = vec3(0.0);
  vec2 f = vFace;
  float dayDim = 0.35 + 0.65 * uNight;

  if (fType < 0.5) {
    fRough = fParam > 0.0 ? fParam : 0.82;
  } else if (fType > 4.5 && fType < 5.5) {
    float g = fParam;
    if (fShop > 0.5) {
      float bay = floor(f.x / 3.2);
      float hb = fhash(vec2(bay, fSeed * 97.0));
      float bx = fract(f.x / 3.2);
      float mull = fpulse(f.x / 3.2, 0.03, 0.97, fwidth(f.x / 3.2));
      if (hb < 0.14) {
        fAlbedo = vec3(0.09) * (0.75 + 0.25 * fpulse(f.y * 6.0, 0.0, 0.5, fwidth(f.y * 6.0)));
        g = 0.0;
      } else {
        g *= (0.6 + 0.4 * hb) * mull;
        float side = abs(bx - 0.5) * 2.0;
        g *= 0.5 + 0.5 * (1.0 - side * side);
        g *= mix(0.22, 1.0, smoothstep(0.3, 2.6, f.y));
        g *= mix(0.45, 1.0, smoothstep(0.85, 1.0, f.y));
        float shelves = step(0.55, hb) * step(1.0, f.y);
        g *= 1.0 - shelves * 0.45 * fpulse(f.y / 0.45, 0.0, 0.18, fwidth(f.y / 0.45));
        float sx = floor(f.x / 0.7);
        float sh = fhash(vec2(sx, fSeed * 41.0 + bay));
        g *= 1.0 - 0.75 * step(0.68, sh) * step(f.y, 0.6 + 1.3 * fract(sh * 13.0));
        fAlbedo = vec3(0.015);
      }
      fRough = 0.15;
      vec3 tint = vec3(1.0, 0.86 + 0.14 * hb, 0.68 + 0.3 * hb);
      fEmit = diffuseColor.rgb * tint * g * dayDim;
    } else {
      float seg = fpulse(f.x / 1.5, 0.12, 0.88, fwidth(f.x / 1.5));
      fEmit = diffuseColor.rgb * g * dayDim * mix(0.35, 1.0, seg);
      fAlbedo = diffuseColor.rgb * 0.2;
      fRough = 0.3;
    }
  } else if (fType > 5.5 && fType < 6.5) {
    float digits = max(vWin.y, 1.0);
    float charW = vWin.z * 0.62;
    float total = charW * digits;
    float lx = f.x / charW;
    float idx = floor(lx);
    float inside = step(0.0, f.x) * step(f.x, total) * step(0.0, f.y) * step(f.y, vWin.z);
    float d = mod(floor(vWin.x / pow(10.0, digits - 1.0 - idx) + 0.001), 10.0);
    vec2 auv = vec2((d + clamp(fract(lx), 0.0, 1.0)) / 10.0, clamp(f.y / vWin.z, 0.0, 1.0));
    float glyph = texture2D(uDigits, auv).r * inside;
    fAlbedo = mix(fAlbedo, uDong, glyph);
    fEmit = uDong * 0.9 * uNight * glyph;
  } else if (fType > 7.5) {
    float s = fpulse(f.x / 0.9, 0.0, 0.5, fwidth(f.x / 0.9));
    fAlbedo = mix(fAlbedo, vec3(0.42, 0.40, 0.36), s * 0.7);
    fRough = 0.7;
  } else {
    float cw = vWin.x;
    float chh = vWin.y;
    vec2 c = vec2(f.x / cw, f.y / chh);
    vec2 fw = fwidth(c);
    vec2 id = floor(c);
    vec2 fr = fract(c);
    float far = smoothstep(0.7, 2.2, max(fw.x, fw.y));
    float ratio = clamp(uLitRatio * fLit, 0.0, 1.0);
    float office = step(0.5, fType) * step(fType, 1.5);
    float mask = 0.0;
    float cover = 0.0;
    vec2 unit = id;
    float fy = fr.y;
    float present = 1.0;
    float corridor = 0.0;

    if (fType < 1.5) {
      float ax = 0.5 * (1.0 - vWin.z / cw);
      float ay = 0.55 / chh;
      float by = (0.55 + vWin.w) / chh;
      mask = fpulse(c.x, ax, 1.0 - ax, fw.x) * fpulse(c.y, ay, by, fw.y);
      cover = (1.0 - 2.0 * ax) * (by - ay);
      unit = vec2(floor(id.x / 4.0), id.y);
      fy = clamp((fr.y - ay) / (by - ay), 0.0, 1.0);
      fAlbedo *= 1.0 + 0.25 * (1.0 - mask);
    } else if (fType < 2.5 || fType > 6.5) {
      float sill = fType > 6.5 ? chh - vWin.w - 0.8 : 0.9;
      float ax = 0.5 * (1.0 - vWin.z / cw);
      float ay = sill / chh;
      float by = (sill + vWin.w) / chh;
      mask = fpulse(c.x, ax, 1.0 - ax, fw.x) * fpulse(c.y, ay, by, fw.y);
      cover = (1.0 - 2.0 * ax) * (by - ay);
      if (fParam > 0.0) {
        present = step(fhash(id + fSeed * 31.0), fParam);
        mask *= mix(present, 1.0, far);
        cover *= fParam;
      }
      fy = clamp((fr.y - ay) / (by - ay), 0.0, 1.0);
      float mw = 0.035 / cw;
      float mull = fpulse(c.x, 0.5 - mw, 0.5 + mw, fw.x);
      float tr = fpulse(c.y, ay + (by - ay) * 0.72, ay + (by - ay) * 0.72 + 0.05 / chh, fw.y);
      mask *= 1.0 - 0.85 * max(mull, tr) * (1.0 - far);
      if (fType > 6.5) {
        float rib = fpulse(f.x / 0.3, 0.0, 0.5, fwidth(f.x / 0.3));
        fAlbedo *= 0.8 + 0.25 * rib;
      }
    } else if (fType < 3.5) {
      float m1 = fpulse(c.x, 0.3 / 6.0, 2.9 / 6.0, fw.x) * fpulse(c.y, 0.25 / chh, 2.25 / chh, fw.y);
      float m2 = fpulse(c.x, 3.7 / 6.0, 5.1 / 6.0, fw.x) * fpulse(c.y, 0.8 / chh, 2.3 / chh, fw.y);
      mask = m1 + m2;
      cover = (2.6 / 6.0) * (2.0 / chh) + (1.4 / 6.0) * (1.5 / chh);
      fy = clamp((fr.y - 0.1) / 0.8, 0.0, 1.0);
    } else {
      float ax = 0.5 * (1.0 - vWin.z / cw);
      mask = fpulse(c.x, ax, 1.0 - ax, fw.x) * fpulse(c.y, 1.1 / chh, 2.0 / chh, fw.y);
      cover = (1.0 - 2.0 * ax) * (0.9 / chh);
      float strip = fpulse(c.y, (chh - 0.42) / chh, (chh - 0.3) / chh, fw.y);
      float segOn = step(fhash(vec2(floor(c.x / 2.0), id.y) + fSeed * 13.0), 0.85);
      corridor = strip * mix(segOn, 0.85, far);
    }

    vec2 key = unit + fSeed * vec2(113.1, 71.7);
    float rowSel = fhash(vec2(id.y * 1.37, fSeed * 91.3));
    float lit = rowSel < 0.2
      ? step(fhash(vec2(id.y * 1.7 + 3.1, fSeed * 53.1)), ratio)
      : step(fhash(key), ratio);
    float hT = fhash(key + 17.3);
    if (hT < 0.01) lit = step(0.5, fract(uTime / (6.0 + 1400.0 * hT) + hT * 37.0));

    vec3 nearE = windowLight(key, office, fr.x, fy, f.y) * lit * mask * present;
    vec3 avgC = uWinColors[0] * 0.8;
    vec3 farE = avgC * ratio * cover * 0.55;
    fEmit = mix(nearE, farE, far);
    fEmit += uWhite * 1.2 * corridor * uNight;

    if (f.y < 0.0) {
      fEmit = vec3(0.0);
      mask = 0.0;
      if (fShop > 0.5) {
        float b = fhash(vec2(floor(f.x / 3.2), fSeed * 7.0));
        fEmit = uShop * (0.3 + 0.35 * b) * step(0.15, b) * dayDim * (1.0 - smoothstep(-1.2, -0.6, f.y));
      }
    }
    vec3 glass = vec3(0.012, 0.016, 0.02);
    float gm = clamp(mask, 0.0, 1.0) * (1.0 - 0.5 * far);
    fAlbedo = mix(fAlbedo, glass, gm);
    fRough = mix(0.8, 0.1, gm);
    fMetal = mix(0.04, 0.75, gm);
  }
  diffuseColor.rgb = fAlbedo;
`;

export function createFacadeMaterial(): {
  material: THREE.MeshStandardMaterial;
  uniforms: FacadeUniforms;
} {
  const uniforms: FacadeUniforms = {
    uLitRatio: { value: 0.32 },
    uNight: { value: 1 },
    uPower: { value: 1 },
    uTime: { value: 0 },
    uDigits: { value: digitAtlas() },
    uWinColors: {
      value: [
        lin(NEON.windowWarm.hex),
        lin(NEON.windowAmber.hex),
        lin(NEON.windowCool.hex),
        lin(NEON.windowTV.hex),
      ],
    },
    uWhite: { value: lin(NEON.neonWhite.hex) },
    uDong: { value: lin(MATERIAL.dongNumber) },
    uShop: { value: lin(NEON.windowAmber.hex) },
  };
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    metalness: 0.05,
  });
  material.name = 'facade';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvFace = aFace;\nvWin = aWin;\nvInfo = aInfo;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_MAIN}`)
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = fRough;',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\nmetalnessFactor = fMetal;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fEmit * uPower;',
      );
  };
  material.customProgramCacheKey = () => 'ramha-facade-v1';
  material.userData.uLitRatio = uniforms.uLitRatio;
  return { material, uniforms };
}
