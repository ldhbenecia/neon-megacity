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

const TOWER_PANELS = 34;
const BRIDGE_PANELS = 10;

const BRIDGE_MIX: readonly (readonly [NeonName, number])[] = [
  ['neonOrange', 0.4],
  ['windowWarm', 0.35],
  ['neonAmber', 0.25],
];
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

interface PanelSpec {
  az: number;
  el: number;
  w: number;
  h: number;
  name: NeonName;
}

// Towers stand on both banks (north -Z, south +Z) and rise high enough to show in the steep
// reflections seen from the overview cameras; bridges cross low on the river axis (east, west).
function panelSpecs(): PanelSpec[] {
  const rng = createRng(6061);
  const specs: PanelSpec[] = [];
  for (let i = 0; i < TOWER_PANELS; i++) {
    const bank = rng.chance(0.5) ? -Math.PI / 2 : Math.PI / 2;
    specs.push({
      az: bank + rng.range(-1.15, 1.15),
      el: rng.range(0.02, 0.5),
      w: rng.range(1.2, 3.5),
      h: rng.range(5, 16),
      name: weighted(rng, PANEL_MIX),
    });
  }
  for (let i = 0; i < BRIDGE_PANELS; i++) {
    const axis = rng.chance(0.5) ? 0 : Math.PI;
    specs.push({
      az: axis + rng.range(-0.6, 0.6),
      el: rng.range(-0.01, 0.05),
      w: rng.range(12, 26),
      h: rng.range(0.4, 0.9),
      name: weighted(rng, BRIDGE_MIX),
    });
  }
  return specs;
}

function buildPanels(key: PaletteKey): THREE.BufferGeometry {
  const rng = createRng(6062);
  const parts: THREE.BufferGeometry[] = [];
  const pos = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const look = new THREE.Object3D();
  for (const p of panelSpecs()) {
    const neon = NEON[p.name];
    const hdr = rng.range(neon.hdr[0], neon.hdr[1]);
    const c = srgb(neon.hex, hdr * key.neonGain * 0.35);
    const g = new THREE.PlaneGeometry(p.w, p.h);
    const n = g.attributes.position?.count ?? 0;
    const colors = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) colors.set([c.r, c.g, c.b], v * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    pos.set(Math.cos(p.az) * Math.cos(p.el), Math.sin(p.el), Math.sin(p.az) * Math.cos(p.el));
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
  const pmrem = new THREE.PMREMGenerator(renderer);
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
    const target = pmrem.fromScene(scene, 0.02, 0.1, DOME_RADIUS * 2, { size });
    domeGeo.dispose();
    domeMat.dispose();
    panelGeo.dispose();
    panelMat.dispose();
    return target;
  }

  return {
    get(key) {
      let t = cache.get(key);
      if (!t) {
        t = bake(key);
        cache.set(key, t);
      }
      return t.texture;
    },
    bakeAll() {
      for (const k of ENV_KEY_LIST) this.get(k);
    },
    dispose() {
      for (const t of cache.values()) t.dispose();
      cache.clear();
      pmrem.dispose();
    },
  };
}
