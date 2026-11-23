// Bakes happen at init only (4 keys), never per frame; lighting owns scene.environment.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DAWN, DAY, NEON, NIGHT, SUNSET, type NeonName, type PaletteKey } from '../core/palette';
import { weighted } from '../city/archetypes';
import { createRng } from '../core/random';
import type { EnvKey } from './sun';

const KEY_PALETTE: Record<EnvKey, PaletteKey> = {
  night: NIGHT,
  dawn: DAWN,
  day: DAY,
  sunset: SUNSET,
};

const PANEL_MIX: readonly (readonly [NeonName, number])[] = [
  ['neonRed', 0.2],
  ['neonOrange', 0.18],
  ['neonCyan', 0.17],
  ['neonTeal', 0.1],
  ['neonAmber', 0.08],
  ['windowWarm', 0.22],
  ['neonMagenta', 0.05],
];

const PANEL_COUNT = 40;
const ENV_KEY_LIST: readonly EnvKey[] = ['night', 'dawn', 'day', 'sunset'];
const DOME_RADIUS = 100;
const PANEL_RADIUS = 60;

const DOME_FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uGround;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, 1.0 - exp(-up * 3.2)) + uGlow * exp(-up / 0.075);
  col = mix(col, uGround, smoothstep(0.0, -0.08, d.y));
  gl_FragColor = vec4(col, 1.0);
}
`;

const DOME_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

function srgb(hex: number, scale = 1): THREE.Color {
  return new THREE.Color().setHex(hex).multiplyScalar(scale);
}

function buildPanels(key: PaletteKey): THREE.BufferGeometry {
  const rng = createRng(6061);
  const parts: THREE.BufferGeometry[] = [];
  const pos = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const look = new THREE.Object3D();
  for (let i = 0; i < PANEL_COUNT; i++) {
    const az = rng.range(0, Math.PI * 2);
    const el = rng.range(-0.02, 0.24);
    const tall = rng.chance(0.35);
    const w = tall ? rng.range(1, 2.6) : rng.range(3, 8);
    const h = tall ? rng.range(4, 11) : rng.range(0.8, 2.6);
    const name = weighted(rng, PANEL_MIX);
    const neon = NEON[name];
    const hdr = rng.range(neon.hdr[0], neon.hdr[1]);
    const c = srgb(neon.hex, hdr * key.neonGain * 0.35);
    const g = new THREE.PlaneGeometry(w, h);
    const n = g.attributes.position?.count ?? 0;
    const colors = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) colors.set([c.r, c.g, c.b], v * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    pos.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    pos.multiplyScalar(PANEL_RADIUS);
    look.position.copy(pos);
    look.lookAt(origin);
    look.updateMatrix();
    g.applyMatrix4(look.matrix);
    parts.push(g);
  }
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return merged;
}

export interface EnvMaps {
  get(key: EnvKey): THREE.Texture;
  // Must run in lighting init, before the boot compile stage.
  bakeAll(): void;
  dispose(): void;
}

export function createEnvMaps(renderer: THREE.WebGLRenderer, size = 256): EnvMaps {
  // Created on demand and dropped once every key is baked (boot in full quality; the low tier bakes
  // lazily and usually keeps it): its blur/convolution programs would otherwise stay compiled.
  let pmrem: THREE.PMREMGenerator | null = null;
  const cache = new Map<EnvKey, THREE.WebGLRenderTarget>();

  function bake(keyName: EnvKey): THREE.WebGLRenderTarget {
    const key = KEY_PALETTE[keyName];
    const scene = new THREE.Scene();
    const domeGeo = new THREE.SphereGeometry(DOME_RADIUS, 32, 16);
    const domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: srgb(key.skyColor) },
        uHorizon: { value: srgb(key.horizonAntiSun).lerp(srgb(key.horizonColor), 0.5) },
        uGlow: { value: srgb(key.cityGlow, key.cityGlowIntensity) },
        uGround: { value: srgb(key.hemiGround, 0.6) },
      },
      vertexShader: DOME_VERTEX,
      fragmentShader: DOME_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const panelGeo = buildPanels(key);
    const panelMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    scene.add(new THREE.Mesh(domeGeo, domeMat), new THREE.Mesh(panelGeo, panelMat));
    pmrem ??= new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromScene(scene, 0.02, 0.1, DOME_RADIUS * 2, { size });
    domeGeo.dispose();
    domeMat.dispose();
    panelGeo.dispose();
    panelMat.dispose();
    return target;
  }

  function releaseGenerator(): void {
    pmrem?.dispose();
    pmrem = null;
  }

  return {
    get(key) {
      let t = cache.get(key);
      if (!t) {
        t = bake(key);
        cache.set(key, t);
        if (cache.size === ENV_KEY_LIST.length) releaseGenerator();
      }
      return t.texture;
    },
    bakeAll() {
      for (const k of ENV_KEY_LIST) this.get(k);
    },
    dispose() {
      for (const t of cache.values()) t.dispose();
      cache.clear();
      releaseGenerator();
    },
  };
}
