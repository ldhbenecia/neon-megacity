// Entry point. Owns renderer / camera / controls / loop and wires modules.
// Module contract (see docs/ARCHITECTURE.md):
//   export function init(ctx) -> { update?(dt, elapsed), dispose?() }
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { CITY, LAYOUT } from './city/layout.js';
import * as lighting from './lighting/index.js';
import * as buildings from './buildings/index.js';
import * as neon from './neon/index.js';
import * as atmosphere from './atmosphere/index.js';

const container = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 6000);
camera.position.set(520, 300, 520);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 60, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 20;
controls.maxDistance = 1800;
controls.maxPolarAngle = Math.PI * 0.495; // never go below ground
controls.screenSpacePanning = false;

const gui = new GUI({ title: 'City Controls' });
gui.close();

const resizeHandlers = [];
/** Shared context handed to every module. */
const ctx = {
  THREE, scene, camera, renderer, controls, gui, CITY, LAYOUT,
  // Environment state. Written by the lighting module every frame, read by others.
  env: {
    timeOfDay: 0.9,                      // 0..1 (0 = midnight, 0.25 = 6am, 0.5 = noon, 0.75 = 6pm)
    sunDirection: new THREE.Vector3(0, -1, 0), // unit vector pointing FROM ground TO sun
    dayFactor: 0,                        // 1 = full day, 0 = full night
    nightFactor: 1,                      // = 1 - dayFactor (convenience)
    rain: 0.6,                           // 0..1 rain intensity (atmosphere owns it)
  },
  // Rendering hook. Atmosphere module may replace this with an EffectComposer render.
  render: () => renderer.render(scene, camera),
  onResize: (fn) => resizeHandlers.push(fn),
};

// Order matters: lighting computes env first, others consume it in the same frame.
const modules = [lighting, buildings, neon, atmosphere].map((m) => m.init(ctx) ?? {});

// Cinematic auto-orbit camera (toggle with C).
let cinematic = false;
const cineState = { angle: Math.atan2(camera.position.z, camera.position.x) };
window.addEventListener('keydown', (e) => {
  if (e.key === 'c' || e.key === 'C') {
    cinematic = !cinematic;
    controls.enabled = !cinematic;
  }
});
gui.add({ get cinematic() { return cinematic; }, set cinematic(v) { cinematic = v; controls.enabled = !v; } }, 'cinematic').name('Cinematic camera [C]').listen();

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  resizeHandlers.forEach((fn) => fn(w, h));
});

const clockEl = document.getElementById('clock');
const timer = new THREE.Timer();
timer.connect(document);
renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.1);
  const t = timer.getElapsed();

  if (cinematic) {
    cineState.angle += dt * 0.05;
    const r = 480 + Math.sin(t * 0.07) * 160;
    camera.position.set(Math.cos(cineState.angle) * r, 140 + Math.sin(t * 0.11) * 90, Math.sin(cineState.angle) * r);
    camera.lookAt(0, 90, 0);
  } else {
    controls.update();
  }

  for (const m of modules) m.update?.(dt, t);

  const mins = Math.floor(ctx.env.timeOfDay * 24 * 60);
  clockEl.textContent = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

  ctx.render();
});
