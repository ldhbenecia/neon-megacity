// Entry point. Owns renderer / camera / controls / loop and wires modules.
// Module contract: see docs/ARCHITECTURE.md and src/core/types.ts.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { CITY, LAYOUT } from './city/layout';
import { clockMinutes, formatClock } from './core/clock';
import { NIGHT } from './core/palette';
import { CAMERA_LIMITS, CAMERA_PRESETS, parseQuery } from './core/query';
import type { CityModule, CityModuleInstance, Ctx } from './core/types';
import * as lighting from './lighting/index';
import * as buildings from './buildings/index';
import * as neon from './neon/index';
import * as atmosphere from './atmosphere/index';

const query = parseQuery(window.location.search);

const container = document.getElementById('app');
if (!container) throw new Error('#app container missing');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
// Shadow map type/update policy is owned by the lighting module.
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 6000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = CAMERA_LIMITS.minDistance;
controls.maxDistance = CAMERA_LIMITS.maxDistance;
controls.maxPolarAngle = CAMERA_LIMITS.maxPolarAngle; // never go below the horizon
controls.screenSpacePanning = false; // right-drag pans along the ground plane

const preset = CAMERA_PRESETS[query.cam ?? 'overview'];
camera.position.fromArray(preset.position);
controls.target.fromArray(preset.target);
controls.update();

const gui = new GUI({ title: 'City Controls' });
gui.close();
if (query.nogui) gui.hide();

const resizeHandlers: ((w: number, h: number) => void)[] = [];
/** Shared context handed to every module. */
const ctx: Ctx = {
  THREE,
  scene,
  camera,
  renderer,
  controls,
  gui,
  CITY,
  LAYOUT,
  env: {
    timeOfDay: query.time ?? 0.9, // 0 = midnight, 0.25 = 6am, 0.5 = noon, 0.75 = 6pm
    timeLocked: query.time !== undefined,
    sunDirection: new THREE.Vector3(0, -1, 0),
    sunElevation: -1,
    dayFactor: 0,
    nightFactor: 1,
    horizonColor: new THREE.Color(NIGHT.horizonColor),
    skyColor: new THREE.Color(NIGHT.skyColor),
    neonGain: NIGHT.neonGain,
    windowLitRatio: NIGHT.windowLitRatio,
    rain: query.rain ?? 0.35,
    wetness: 0.55,
    fogColor: new THREE.Color(NIGHT.fogColor),
    fogDensity: NIGHT.fogDensity,
    powerOn: 1,
    selectedBuilding: null,
  },
  render: () => renderer.render(scene, camera),
  onResize: (fn) => {
    resizeHandlers.push(fn);
  },
};

// Order matters: lighting computes env first, others consume it in the same frame.
const moduleList: CityModule[] = [lighting, buildings, neon, atmosphere];
const modules: CityModuleInstance[] = moduleList.map((m) => m.init(ctx));

// Cinematic auto-orbit camera (toggle with C).
const cine = { enabled: false, angle: Math.atan2(camera.position.z, camera.position.x) };
const setCinematic = (v: boolean): void => {
  cine.enabled = v;
  controls.enabled = !v;
};
window.addEventListener('keydown', (e) => {
  if (e.key === 'c' || e.key === 'C') setCinematic(!cine.enabled);
});
gui.add(cine, 'enabled').name('Cinematic camera [C]').onChange(setCinematic).listen();

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  for (const fn of resizeHandlers) fn(w, h);
});

const MIN_CAMERA_Y = 2;
const clockEl = document.getElementById('clock');
const timer = new THREE.Timer();
timer.connect(document);
let clockMins = -1;
let frames = 0;
renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.1);
  const t = timer.getElapsed();

  if (cine.enabled) {
    cine.angle += dt * 0.05;
    const r = 480 + Math.sin(t * 0.07) * 160;
    camera.position.set(
      Math.cos(cine.angle) * r,
      140 + Math.sin(t * 0.11) * 90,
      Math.sin(cine.angle) * r,
    );
    camera.lookAt(0, 90, 0);
  } else {
    // Keep the orbit pivot and the camera above ground even while panning.
    controls.target.y = Math.max(controls.target.y, 0);
    controls.update();
    if (camera.position.y < MIN_CAMERA_Y) camera.position.y = MIN_CAMERA_Y;
  }

  for (const m of modules) m.update?.(dt, t);

  // The clock only changes once per in-game minute; skip redundant DOM writes.
  const mins = clockMinutes(ctx.env.timeOfDay);
  if (clockEl && mins !== clockMins) {
    clockMins = mins;
    clockEl.textContent = formatClock(mins);
  }

  ctx.render();
  frames++;
  window.__city = { ready: true, frames };
});
