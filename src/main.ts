import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CITY, LAYOUT } from './city/layout';
import { postEnabled } from './core/gl';
import { NIGHT } from './core/palette';
import { CAMERA_FAR, CAMERA_FOV, CAMERA_LIMITS, parseQuery } from './core/query';
import type { CityModule, CityModuleInstance, CompileHook, Ctx, Quality } from './core/types';
import * as lighting from './lighting/index';
import * as terrain from './terrain/index';
import * as buildings from './buildings/index';
import * as infra from './infra/index';
import * as neon from './neon/index';
import * as atmosphere from './atmosphere/index';
import { createGui } from './ux/gui';
import { createLoader, initUx, nextFrame, parseUxQuery } from './ux/index';
import { QUALITY_STORAGE_KEY, storedTier, tierFromRenderer } from './ux/quality';

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
const uxQuery = parseUxQuery(window.location.search);
const debug = uxQuery.debug;
// Manual picks win: ?quality= (incl. ci), then the stored control-panel choice. Otherwise the tier
// is guessed from the GPU once the renderer exists (see boot()).
const manualQuality: Quality | null = query.quality ?? readStoredTier();
let quality: Quality = manualQuality ?? 'high';

function readStoredTier(): Quality | null {
  try {
    return storedTier(localStorage.getItem(QUALITY_STORAGE_KEY));
  } catch {
    return null;
  }
}

function rendererName(renderer: THREE.WebGLRenderer): string | null {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null;
}
const loader = createLoader();

/**
 * With post (see `postEnabled`) the scene renders into atmosphere's HDR target and only the final
 * full-screen pass reaches the canvas, so canvas MSAA would cost ~74 MB at 2400×1350 for nothing.
 * MSAA is fixed at context creation: start without it and recreate the (rare) renderer whose GPU
 * cannot run post, checking the real context rather than a probe that may land on another GPU.
 */
function createRenderer(): THREE.WebGLRenderer {
  const make = (antialias: boolean): THREE.WebGLRenderer =>
    new THREE.WebGLRenderer({ antialias, powerPreference: 'high-performance' });
  const renderer = make(false);
  if (quality === 'ci' || postEnabled(quality, renderer)) return renderer;
  renderer.dispose();
  renderer.forceContextLoss();
  return make(true);
}

async function boot(): Promise<void> {
  loader.stage('setup', BOOT_WEIGHTS.setup);
  await nextFrame();

  const container = document.getElementById('app');
  if (!container) throw new Error('#app container missing');

  const renderer = createRenderer();
  if (!manualQuality) {
    quality = tierFromRenderer(rendererName(renderer), navigator.maxTouchPoints > 1);
  }
  // Pixel ratio is owned by ux/perf (adaptive, capped at 1.5).
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Exposure is owned by lighting (palette toneMappingExposure × env.powerOn).
  renderer.toneMappingExposure = NIGHT.toneMappingExposure;
  // three's shader error check reads the program info log on a program's first use, which blocks
  // on the driver: a ~500 ms stall the first time the timeline leaves noon (M4, Metal). Kept in
  // dev, under automation (e2e, screenshots) and with ?debug, so shader errors stay diagnosable.
  renderer.debug.checkShaderErrors = import.meta.env.DEV || navigator.webdriver || debug;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    window.innerWidth / window.innerHeight,
    0.5,
    Math.max(8000, CAMERA_FAR),
  );

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = CAMERA_LIMITS.minDistance;
  controls.maxDistance = CAMERA_LIMITS.maxDistance;
  controls.maxPolarAngle = CAMERA_LIMITS.maxPolarAngle;
  controls.screenSpacePanning = false;

  // lil-gui is the developer panel: only with ?debug (and never with ?nogui), loaded on demand.
  // Regular users get the ux controls (time scrubber, weather, camera) and a no-op stand-in.
  const gui = await createGui(debug && !query.nogui);
  gui.close();

  const resizeHandlers: ((w: number, h: number) => void)[] = [];
  // Filled by modules; ux calls them after changing env.quality (the controller lands with ux).
  const qualityHandlers: ((q: Quality) => void)[] = [];
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
    debug: { nan: uxQuery.nan },
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
    onQuality: (fn) => {
      qualityHandlers.push(fn);
      return () => {
        const i = qualityHandlers.indexOf(fn);
        if (i >= 0) qualityHandlers.splice(i, 1);
      };
    },
  };

  const ux = initUx(ctx, {
    ...(query.cam ? { cam: query.cam } : {}),
    resize,
    manualQuality: manualQuality !== null,
    emitQuality: (q) => {
      for (const fn of [...qualityHandlers]) fn(q);
    },
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
  // The post chain (atmosphere) renders into an HDR target, a different program variant than the
  // canvas: when it publishes `scene.userData.compile`, that warms up exactly what will be drawn.
  // Awaited so parallel shader linking (KHR_parallel_shader_compile, SwiftShader) finishes here and
  // not inside the first frame. A failed warm-up is not fatal (programs then link on first use)
  // but logs an error so e2e collectErrors fails on it.
  try {
    const compileScene = (scene.userData as { compile?: CompileHook }).compile;
    if (compileScene) await compileScene();
    else await renderer.compileAsync(scene, camera);
  } catch (err) {
    console.error('shader warm-up failed; programs will link on first draw', err);
  }

  loader.stage('first-frame', BOOT_WEIGHTS.firstFrame);

  const timer = new THREE.Timer();
  timer.connect(document);
  // cpu: moving average of each module's update() in ms, read by `npm run perf`.
  const cpu: Record<string, number> = {};
  const cityState = { ready: true, frames: 0, powered: false, cpu, lod0Pending: 0 };
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
    cityState.lod0Pending = ctx.buildings?.lod0Pending() ?? 0;
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
