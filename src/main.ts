// Entry point. Owns renderer / camera / controls / loop and wires modules.
// Module contract: see docs/ARCHITECTURE.md and src/core/types.ts.
// Boot UX (loader, camera rig, HUD) lives in src/ux/; feature work never edits this file.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { CITY, LAYOUT } from './city/layout';
import { NIGHT } from './core/palette';
import { CAMERA_LIMITS, parseQuery } from './core/query';
import type { CityModule, CityModuleInstance, Ctx } from './core/types';
import * as lighting from './lighting/index';
import * as terrain from './terrain/index';
import * as buildings from './buildings/index';
import * as infra from './infra/index';
import * as neon from './neon/index';
import * as atmosphere from './atmosphere/index';
import { createLoader, initUx } from './ux/index';

/**
 * Boot progress weights (ART_DIRECTION 9.2); all stages sum to 100:
 * setup (renderer, camera, layout) 5 + modules 77 + shader warm-up 15 + first frame 3.
 */
const BOOT_WEIGHTS = { setup: 5, compile: 15, firstFrame: 3 } as const;

/** Init and update order (ART_DIRECTION 13.1) with boot progress weights (9.2). */
const MODULES: readonly (readonly [name: string, weight: number, module: CityModule])[] = [
  ['lighting', 8, lighting],
  ['terrain', 8, terrain],
  ['buildings', 30, buildings],
  ['infra', 7, infra],
  ['neon', 17, neon],
  ['atmosphere', 7, atmosphere],
];

const query = parseQuery(window.location.search);
const loader = createLoader();
loader.stage('setup', BOOT_WEIGHTS.setup);

const container = document.getElementById('app');
if (!container) throw new Error('#app container missing');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// Exposure is owned by lighting (palette toneMappingExposure × env.powerOn).
renderer.toneMappingExposure = NIGHT.toneMappingExposure;
// Shadow map type/update policy is owned by the lighting module.
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 8000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = CAMERA_LIMITS.minDistance;
controls.maxDistance = CAMERA_LIMITS.maxDistance;
controls.maxPolarAngle = CAMERA_LIMITS.maxPolarAngle; // never go below the horizon
controls.screenSpacePanning = false; // right-drag pans along the ground plane

const gui = new GUI({ title: 'City Controls' });
gui.close();
if (query.nogui) gui.hide();

const resizeHandlers: ((w: number, h: number) => void)[] = [];
/** Shared context handed to every module. Initial env values are night palette defaults. */
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

const ux = initUx(ctx, query.cam ? { preset: query.cam } : {});

// Order matters: lighting computes env first, others consume it in the same frame.
const modules: CityModuleInstance[] = [];
for (const [name, weight, mod] of MODULES) {
  loader.stage(name, weight);
  try {
    modules.push(mod.init(ctx));
  } catch (err) {
    loader.fail(name, err);
    throw err;
  }
}
loader.stage('compile', BOOT_WEIGHTS.compile);
// The post chain (atmosphere) renders into an HDR target, a different program variant than the
// canvas: when it publishes `scene.userData.compile`, that warms up exactly what will be drawn.
const compileScene = (scene.userData as { compile?: () => void }).compile;
if (compileScene) compileScene();
else renderer.compile(scene, camera);
loader.stage('first-frame', BOOT_WEIGHTS.firstFrame);

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  for (const fn of resizeHandlers) fn(w, h);
});

const timer = new THREE.Timer();
timer.connect(document);
let frames = 0;
renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.1);
  const t = timer.getElapsed();

  ux.beforeUpdate(dt, t);
  for (const m of modules) m.update?.(dt, t);
  ux.afterUpdate(dt, t);

  ctx.render();
  frames++;
  if (frames === 1) loader.done();
  window.__city = { ready: true, frames };
});
