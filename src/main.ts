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

const BOOT_WEIGHTS = { setup: 5, compile: 15, firstFrame: 3 } as const;

const MODULES: readonly (readonly [name: string, weight: number, module: CityModule])[] = [
  ['lighting', 8, lighting],
  ['terrain', 8, terrain],
  ['buildings', 30, buildings],
  ['infra', 7, infra],
  ['neon', 17, neon],
  ['atmosphere', 7, atmosphere],
];

const query = parseQuery(window.location.search);
const quality = query.quality ?? 'high';
const loader = createLoader();

/** Same test as atmosphere's `supportsHalfFloatTargets`, before the real context exists. */
function halfFloatTargets(): boolean {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return false;
  const ok = ['EXT_color_buffer_float', 'EXT_color_buffer_half_float'].some(
    (name) => gl.getExtension(name) !== null,
  );
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return ok;
}

async function boot(): Promise<void> {
  loader.stage('setup', BOOT_WEIGHTS.setup);
  await nextFrame();

  const container = document.getElementById('app');
  if (!container) throw new Error('#app container missing');

  const renderer = new THREE.WebGLRenderer({
    // With half-float targets atmosphere renders into its own multisampled HDR target and only the
    // final full-screen pass reaches the canvas: canvas MSAA would cost ~74 MB at 2400×1350.
    antialias: quality === 'high' && !halfFloatTargets(),
    powerPreference: 'high-performance',
  });
  // Pixel ratio is owned by ux/perf (adaptive, capped at 1.5).
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Exposure is owned by lighting (palette toneMappingExposure × env.powerOn).
  renderer.toneMappingExposure = NIGHT.toneMappingExposure;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 8000);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = CAMERA_LIMITS.minDistance;
  controls.maxDistance = CAMERA_LIMITS.maxDistance;
  controls.maxPolarAngle = CAMERA_LIMITS.maxPolarAngle;
  controls.screenSpacePanning = false;

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
  // Registered right away: boot is async, the window may resize or rotate during compile.
  window.addEventListener('resize', resize);

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
      timeOfDay: query.time ?? 0.9,
      timeLocked: query.time !== undefined,
      quality,
      sunDirection: new THREE.Vector3(0, -1, 0),
      sunElevation: -1,
      dayFactor: 0,
      nightFactor: 1,
      horizonColor: new THREE.Color(NIGHT.horizonColor),
      skyColor: new THREE.Color(NIGHT.skyColor),
      neonGain: NIGHT.neonGain,
      windowLitRatio: NIGHT.windowLitRatio,
      rain: query.rain ?? 0.35,
      rainTarget: query.rain ?? 0.35,
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
  const modules: (readonly [name: string, instance: CityModuleInstance])[] = [];
  for (const [name, weight, mod] of MODULES) {
    loader.stage(name, weight);
    await nextFrame();
    try {
      modules.push([name, mod.init(ctx)]);
    } catch (err) {
      loader.fail(name, err);
      throw err;
    }
  }

  loader.stage('compile', BOOT_WEIGHTS.compile);
  await nextFrame();
  try {
    // The post chain (atmosphere) renders into an HDR target, a different program variant than the
    // canvas: when it publishes `scene.userData.compile`, that warms up exactly what will be drawn.
    const compileScene = (scene.userData as { compile?: () => void }).compile;
    if (compileScene) compileScene();
    else await renderer.compileAsync(scene, camera);
  } catch (err) {
    loader.fail('compile', err);
    throw err;
  }

  loader.stage('first-frame', BOOT_WEIGHTS.firstFrame);

  const timer = new THREE.Timer();
  timer.connect(document);
  // cpu: moving average of each module's update() in ms, read by `npm run perf`.
  const cpu: Record<string, number> = {};
  const cityState = { ready: true, frames: 0, powered: false, cpu };
  let bootGone = false;
  const frame = (timestamp?: number): void => {
    timer.update(timestamp);
    const raw = timer.getDelta();
    const dt = Math.min(raw, 0.1);
    const t = timer.getElapsed();

    ux.frameStart();
    ux.beforeUpdate(dt, t);
    for (const [name, m] of modules) {
      const start = performance.now();
      m.update?.(dt, t);
      cpu[name] = (cpu[name] ?? 0) * 0.95 + (performance.now() - start) * 0.05;
    }
    ux.afterUpdate(dt, t);
    ctx.render();
    ux.frameEnd(raw);

    cityState.frames++;
    // The boot overlay is removed once and never comes back: stop querying after that.
    bootGone ||= !document.getElementById('boot');
    cityState.powered = ux.powered && bootGone;
    window.__city = cityState;
  };
  // Modules registered resize handlers during init: sync them to the current size once.
  resize();
  frame();
  await nextFrame();

  ux.powerOn();
  renderer.setAnimationLoop(frame);
  await loader.done();
}

// Any failure (no WebGL, setup errors) turns the loader red instead of hanging on it.
// loader.fail is idempotent, so stages that already reported are not logged twice.
boot().catch((err: unknown) => {
  loader.fail('boot', err);
});
