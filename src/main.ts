// Entry point. Owns renderer / camera / controls / loop and wires modules.
// Module contract: see docs/ARCHITECTURE.md and src/core/types.ts.
// Boot UX (loader, camera rig, HUD, stats) lives in src/ux/; feature work never edits this file.
// Boot is async (ART_DIRECTION 9.2): each stage yields two frames so the #boot skeleton repaints.
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
import { createLoader, initUx, nextFrame, parseUxQuery } from './ux/index';

/**
 * Boot progress weights (ART_DIRECTION 9.2); all stages sum to 100:
 * setup (renderer, camera, layout) 5 + modules 77 + shader warm-up 15 + first frame 3.
 * The loader normalizes by the declared sum anyway.
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

async function boot(): Promise<void> {
  loader.stage('setup', BOOT_WEIGHTS.setup);
  await nextFrame();

  const container = document.getElementById('app');
  if (!container) throw new Error('#app container missing');

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  // Pixel ratio is owned by ux/perf (adaptive, capped at 1.5).
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Exposure is owned by lighting (palette toneMappingExposure × env.powerOn).
  renderer.toneMappingExposure = NIGHT.toneMappingExposure;
  // Shadow map type/update policy is owned by the lighting module.
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 8000);

  // Limits and feel are tuned by the camera rig (src/ux/cameraRig.ts, ART_DIRECTION 8.1).
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = CAMERA_LIMITS.minDistance;
  controls.maxDistance = CAMERA_LIMITS.maxDistance;
  controls.maxPolarAngle = CAMERA_LIMITS.maxPolarAngle; // never go below the horizon
  controls.screenSpacePanning = false; // right-drag pans along the ground plane

  // lil-gui is the developer panel: only with ?debug (and never with ?nogui). Regular users get
  // the ux controls (time scrubber, weather, camera) instead.
  const gui = new GUI({ title: 'City Controls' });
  gui.close();
  if (query.nogui || !parseUxQuery(window.location.search).debug) gui.hide();

  const resizeHandlers: ((w: number, h: number) => void)[] = [];
  const resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    for (const fn of resizeHandlers) fn(w, h);
  };

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
      // Dark until the loader hands over (9.3); ux ramps it to 1.
      powerOn: 0,
      selectedBuilding: null,
    },
    render: () => renderer.render(scene, camera),
    onResize: (fn) => {
      resizeHandlers.push(fn);
    },
  };

  const ux = initUx(ctx, {
    ...(query.cam ? { cam: query.cam } : {}),
    resize,
  });
  loader.detail('buildings', `건물 ${LAYOUT.buildings.length.toLocaleString('ko-KR')}동 조립 완료`);

  // Order matters: lighting computes env first, others consume it in the same frame.
  const modules: CityModuleInstance[] = [];
  for (const [name, weight, mod] of MODULES) {
    loader.stage(name, weight);
    await nextFrame();
    try {
      modules.push(mod.init(ctx));
    } catch (err) {
      loader.fail(name, err);
      throw err;
    }
  }

  // Compile every program up front so the first seconds of flight do not hitch.
  loader.stage('compile', BOOT_WEIGHTS.compile);
  await nextFrame();
  try {
    await renderer.compileAsync(scene, camera);
  } catch (err) {
    loader.fail('compile', err);
    throw err;
  }

  loader.stage('first-frame', BOOT_WEIGHTS.firstFrame);
  window.addEventListener('resize', resize);

  const timer = new THREE.Timer();
  timer.connect(document);
  const cityState = { ready: true, frames: 0, powered: false };
  let bootGone = false;
  const frame = (timestamp?: number): void => {
    timer.update(timestamp);
    const raw = timer.getDelta();
    const dt = Math.min(raw, 0.1);
    const t = timer.getElapsed();

    ux.frameStart();
    ux.beforeUpdate(dt, t);
    for (const m of modules) m.update?.(dt, t);
    ux.afterUpdate(dt, t);
    ctx.render();
    ux.frameEnd(raw);

    cityState.frames++;
    // The boot overlay is removed once and never comes back: stop querying after that.
    bootGone ||= !document.getElementById('boot');
    cityState.powered = ux.powered && bootGone;
    window.__city = cityState;
  };
  frame();
  await nextFrame();

  // 9.3 power on: the loop runs while the loader blinks and fades out over the city.
  ux.powerOn();
  renderer.setAnimationLoop(frame);
  await loader.done();
}

boot().catch((err: unknown) => {
  console.error('[boot] failed', err);
});
