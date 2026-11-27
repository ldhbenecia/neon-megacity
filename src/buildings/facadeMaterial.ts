import * as THREE from 'three';
import { MATERIAL, NEON, WINDOW_MIX } from '../core/palette';
import { FACADE_DAY, NIGHT_FILL } from './colors';

const glsl = (v: number): string => v.toFixed(4);
const vec3 = (c: readonly [number, number, number]): string => `vec3(${c.map(glsl).join(', ')})`;

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
  tex.colorSpace = THREE.NoColorSpace;
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
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
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

vec4 roomLight(vec2 key, float office) {
  float hC = fhash(key + 5.7);
  float h2 = fhash(key + 11.3);
  float warmT = ${WINDOW_MIX.windowWarm.toFixed(3)} - office * 0.25;
  float amberT = warmT + ${WINDOW_MIX.windowAmber.toFixed(3)};
  float coolT = amberT + ${WINDOW_MIX.windowCool.toFixed(3)} + office * 0.25;
  if (hC < warmT) return vec4(mix(uWinColors[1], uWinColors[0], 0.4 + 0.6 * h2), ${NEON.windowWarm.hdr[0].toFixed(2)} + 0.3 * h2);
  if (hC < amberT) return vec4(uWinColors[1], ${NEON.windowAmber.hdr[0].toFixed(2)} + 0.25 * h2);
  if (hC < coolT) return vec4(mix(uWinColors[0], uWinColors[2], 0.5 + 0.5 * h2), ${NEON.windowCool.hdr[0].toFixed(2)} + 0.25 * h2);
  return vec4(uWinColors[3], ${NEON.windowTV.hdr[0].toFixed(2)} + 0.2 * h2);
}

#ifdef INTERIOR
float boxHit(vec3 o, vec3 d, vec3 bmin, vec3 bmax) {
  vec3 t0 = (bmin - o) / d;
  vec3 t1 = (bmax - o) / d;
  vec3 tn = min(t0, t1);
  vec3 tf = max(t0, t1);
  float a = max(max(tn.x, tn.y), tn.z);
  float b = min(min(tf.x, tf.y), tf.z);
  return (b > max(a, 0.0)) ? a : 1e9;
}

// Room space: x 0..R.x along the face, y 0..R.y up, z -R.z..0 into the building; p0 is on the glass.
vec3 roomInterior(vec3 p0, vec3 d, vec3 R, vec2 key, vec3 light, float lit) {
  d.x = abs(d.x) < 1e-4 ? 1e-4 : d.x;
  d.y = abs(d.y) < 1e-4 ? 1e-4 : d.y;
  d.z = min(d.z, -0.02);
  float tx = ((d.x > 0.0 ? R.x : 0.0) - p0.x) / d.x;
  float ty = ((d.y > 0.0 ? R.y : 0.0) - p0.y) / d.y;
  float tz = (-R.z - p0.z) / d.z;
  float t = min(min(tx, ty), tz);
  vec3 h = p0 + d * t;
  float hA = fhash(key + 31.7);
  float hB = fhash(key + 47.3);
  float hF = fhash(key + 59.1);
  vec3 wallC = mix(vec3(0.62, 0.56, 0.46), vec3(0.46, 0.52, 0.5), hA);
  vec3 floorC = mix(vec3(0.24, 0.15, 0.09), vec3(0.32, 0.3, 0.27), hB);
  vec3 col = wallC;
  float fixture = 0.0;
  vec3 L = vec3(R.x * 0.5, R.y - 0.1, -R.z * 0.5);
  if (t == ty) {
    if (d.y > 0.0) {
      col = vec3(0.34);
      vec2 q = abs(h.xz - L.xz);
      fixture = (1.0 - smoothstep(0.35, 0.45, q.x)) * (1.0 - smoothstep(0.2, 0.3, q.y));
    } else {
      col = floorC;
    }
  } else if (t == tz) {
    col = wallC * 0.85;
  }
  float shade = 1.0 / (1.0 + dot(h - L, h - L) * 0.3);
  if (hF < 0.7) {
    float fw0 = R.x * (0.1 + 0.3 * fhash(key + 61.0));
    float fw1 = min(R.x - 0.2, fw0 + R.x * (0.3 + 0.3 * hF));
    float fz = R.z * (0.35 + 0.4 * fhash(key + 67.0));
    float fh = hF < 0.35 ? 0.75 : 0.95;
    float tb = boxHit(p0, d, vec3(fw0, 0.0, -fz - 0.9), vec3(fw1, fh, -fz));
    if (tb < t) {
      col = vec3(0.05, 0.045, 0.04);
      shade = 0.6;
      fixture = 0.0;
    }
  }
  float deep = clamp(-h.z / R.z, 0.0, 1.0);
  vec3 on = (col * shade * 2.2 * mix(1.0, 0.5, deep) + fixture * 1.1) * light;
  vec3 off = col * (0.012 + 0.01 * shade);
  return mix(off, on, lit);
}
#endif
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
        // Silhouettes read as counters, shelves and the odd person, not a bar chart.
        float ux = f.x / 2.4;
        float uid = floor(ux);
        float uh = fhash(vec2(uid, fSeed * 41.0));
        float objH = uh < 0.55 ? 0.95 : 1.5;
        float obj = step(0.3, uh) * fpulse(ux, 0.1, 0.9, fwidth(ux)) * step(f.y, objH);
        obj *= 1.0 - 0.6 * step(1.2, objH) * fpulse(f.y / 0.5, 0.0, 0.1, fwidth(f.y / 0.5));
        float pc = (uid + 0.2 + 0.6 * fhash(vec2(uid, fSeed * 7.0 + 3.0))) * 2.4;
        float dx = abs(f.x - pc);
        float person = step(0.8, fhash(vec2(uid, fSeed * 13.0))) * (1.0 - step(0.3, uh));
        float head = 1.72 - dx * dx * 6.0 - f.y;
        float hw = fwidth(f.y);
        person *= (1.0 - smoothstep(0.16, 0.22, dx)) * smoothstep(-hw, hw, head);
        g *= 1.0 - 0.75 * max(obj, person);
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
    float cw = max(vWin.x, 0.05);
    float chh = max(vWin.y, 0.05);
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
    float present = 1.0;
    float corridor = 0.0;
    vec4 rect = vec4(0.0, 1.0, 0.0, 1.0);
    float roomCells = 1.0;

    if (fType < 1.5) {
      float ax = 0.5 * (1.0 - vWin.z / cw);
      float ay = 0.55 / chh;
      float by = (0.55 + vWin.w) / chh;
      mask = fpulse(c.x, ax, 1.0 - ax, fw.x) * fpulse(c.y, ay, by, fw.y);
      cover = (1.0 - 2.0 * ax) * (by - ay);
      rect = vec4(ax, 1.0 - ax, ay, by);
      unit = vec2(floor(id.x / 4.0), id.y);
      roomCells = 4.0;
      fAlbedo *= 1.0 + 0.25 * (1.0 - mask);
      fAlbedo *= 1.0 - 0.45 * fpulse(c.y, 0.0, 0.3 / chh, fw.y);
    } else if (fType < 2.5 || fType > 6.5) {
      float sill = fType > 6.5 ? chh - vWin.w - 0.8 : 0.9;
      float ax = 0.5 * (1.0 - vWin.z / cw);
      float ay = sill / chh;
      float by = (sill + vWin.w) / chh;
      mask = fpulse(c.x, ax, 1.0 - ax, fw.x) * fpulse(c.y, ay, by, fw.y);
      cover = (1.0 - 2.0 * ax) * (by - ay);
      rect = vec4(ax, 1.0 - ax, ay, by);
      if (fParam > 0.0) {
        present = step(fhash(id + fSeed * 31.0), fParam);
        mask *= mix(present, 1.0, far);
        cover *= fParam;
      }
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
      rect = fr.x < 0.55
        ? vec4(0.3 / 6.0, 2.9 / 6.0, 0.25 / chh, 2.25 / chh)
        : vec4(3.7 / 6.0, 5.1 / 6.0, 0.8 / chh, 2.3 / chh);
    } else {
      float ax = 0.5 * (1.0 - vWin.z / cw);
      mask = fpulse(c.x, ax, 1.0 - ax, fw.x) * fpulse(c.y, 1.1 / chh, 2.0 / chh, fw.y);
      cover = (1.0 - 2.0 * ax) * (0.9 / chh);
      rect = vec4(ax, 1.0 - ax, 1.1 / chh, 2.0 / chh);
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
    if (hT < 0.002) lit = step(0.5, fract(uTime / (120.0 + 120000.0 * hT) + hT * 37.0));

    vec4 light = roomLight(key, office);
    vec3 lightC = light.rgb * light.a;
    float wy = clamp((fr.y - rect.z) / max(rect.w - rect.z, 1e-3), 0.0, 1.0);
    float edgeM = min(min(fr.x - rect.x, rect.y - fr.x) * cw, min(fr.y - rect.z, rect.w - fr.y) * chh);
    float frame = 1.0 - smoothstep(0.03, 0.07, edgeM);
    float inner = mix(0.5, 1.0, smoothstep(0.05, 0.45, edgeM));
    vec3 nearE;
#ifdef INTERIOR
    if (far < 0.99 && mask > 0.001) {
      vec3 nV = normalize(vNormal);
      vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
      // A face whose normal is parallel to view-up (a horizontal face) would make the tangent
      // normalize(0) = NaN, which bloom spreads into black blocks; fall back to another axis.
      vec3 cr = cross(upV, nV);
      vec3 tV = dot(cr, cr) > 1e-8 ? normalize(cr) : normalize(cross(vec3(1.0, 0.0, 0.0), nV) + vec3(0.0, 0.0, 1e-4));
      vec3 dv = normalize(-vViewPosition);
      vec3 dl = vec3(dot(dv, tV), dot(dv, upV), dot(dv, nV));
      float roomW = roomCells * cw;
      float rx = roomCells > 1.5 ? fract(c.x / roomCells) * roomW : fr.x * cw;
      vec3 R = vec3(roomW, chh, 3.5 + 4.0 * fhash(key + 23.1));
      // dv points at the camera; the room ray runs the other way, into the building (-z).
      vec3 room = roomInterior(vec3(rx, fr.y * chh, 0.0), -dl, R, key, lightC, lit);
      float hCur = fhash(key + 9.1);
      if (hCur < 0.2) {
        float level = 1.0 - (0.25 + 0.5 * fhash(key + 3.3));
        float curtain = smoothstep(level - 0.02, level + 0.02, wy);
        float folds = 0.8 + 0.2 * sin(rx * 9.0 + hCur * 40.0);
        vec3 cloth = mix(vec3(0.75, 0.68, 0.55), vec3(0.55, 0.6, 0.62), fhash(key + 71.0));
        room = mix(room, cloth * folds * mix(vec3(0.006), lightC * 0.4, lit), curtain);
      }
      float mx = max(max(room.r, room.g), room.b);
      room *= mx > 1.1 ? 1.1 / mx : 1.0;
      nearE = room * inner * (1.0 - frame) * mask * present;
    } else
#endif
    {
      nearE = lightC * (0.68 + 0.42 * wy) * inner * lit * mask * present;
    }
    vec3 farE = uWinColors[0] * 0.8 * ratio * cover * 0.55;
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
    // Daytime material split (ART_DIRECTION 4.3 #6): precast concrete reads lighter, metal panels
    // catch the sky, and glass reflects it instead of staying a black hole. Night is unchanged.
    float day = 1.0 - uNight;
    float matPick = fhash(vec2(fSeed * 53.0, 7.0));
    float concrete = step(matPick, 0.4);
    float metal = step(0.4, matPick) * step(matPick, 0.7);
    float wallRough = mix(0.8, 0.35, metal * day);
    fAlbedo *= 1.0 + day * (${glsl(FACADE_DAY.concreteGain)} * concrete + ${glsl(FACADE_DAY.metalGain)} * metal);
    float gm = clamp(mask, 0.0, 1.0) * (1.0 - 0.5 * far);
    float fm = frame * gm * (1.0 - far);
    vec3 glass = mix(${vec3(FACADE_DAY.glassNight)}, ${vec3(FACADE_DAY.glassDay)}, day);
    fAlbedo = mix(fAlbedo, glass, gm);
    fAlbedo = mix(fAlbedo, vec3(0.03), fm);
    fRough = mix(wallRough, 0.05, gm);
    fRough = mix(fRough, 0.5, fm);
    fMetal = mix(mix(0.04, 0.45, metal * day), 0.55 * day, gm);
    fMetal = mix(fMetal, 0.6, fm);
  }
  // Every wall type except self-lit ones (5 emissive, 6 동 number), which carry their own light.
  if (fType < 4.5 || fType > 6.5) {
    // f.y is measured from the window start, about one ground floor above the street.
    float bounce = exp(-max(f.y + 4.0, 0.0) / ${glsl(NIGHT_FILL.bounceFalloff)});
    fEmit += (${vec3(NIGHT_FILL.ambient)} + ${vec3(NIGHT_FILL.bounce)} * bounce) * uNight;
  }
  diffuseColor.rgb = fAlbedo;
`;

export function createFacadeUniforms(): FacadeUniforms {
  return {
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
}

// `interior` (LOD0 only) enables per-pixel interior mapping; LOD1/2 keep the cheap flat path.
export function createFacadeMaterial(
  uniforms: FacadeUniforms,
  interior: boolean,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    metalness: 0.05,
  });
  material.name = interior ? 'facadeNear' : 'facade';
  if (interior) material.defines = { INTERIOR: '' };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvFace = aFace;\nvWin = aWin;\nvInfo = aInfo;',
      )
      .replace(
        '#include <color_vertex>',
        '#include <color_vertex>\nvColor.rgb = srgbToLinear(vColor.rgb);',
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
  material.customProgramCacheKey = () =>
    interior ? 'hangang-facade-near-v4' : 'hangang-facade-v4';
  material.userData.uLitRatio = uniforms.uLitRatio;
  return material;
}
