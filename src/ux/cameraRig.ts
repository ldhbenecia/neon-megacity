// CameraRig (ART_DIRECTION 8). Owns every camera move on top of OrbitControls:
// damped orbit + smooth cursor-directed zoom, WASD/QE flight scaled by height, F fly mode
// (pointer lock mouse look), click-to-fly arcs, collision, presets 1-8, idle cinematic, touch.
// Pure math lives in motion.ts / collision.ts / presets.ts (unit tested).
import * as THREE from 'three';
import { LAYOUT, surfaceHeight, type Vec3 } from '../city/layout';
import type { Ctx } from '../core/types';
import { cameraFloor, frameBuildingClear, pick, resolveCollision, targetFloor } from './collision';
import type { Hud, RigMode } from './hud';
import {
  dampFactor,
  easeInOutCubic,
  fitPolar,
  flightPose,
  moveSpeed,
  panSpeedFor,
  planFlight,
  type Flight,
  type Pose,
} from './motion';
import { CINEMATIC_ORDER, DEFAULT_PRESET, cinematicKeys, rigPreset, rigPresets } from './presets';
import { CAMERA_LIMITS } from '../core/query';

export interface RigDebug {
  mode: RigMode;
  position: Vec3;
  target: Vec3;
  fov: number;
  selected: number | null;
}

export interface CameraRig {
  /** Runs before the feature modules each frame. */
  update(dt: number, elapsed: number): void;
  readonly mode: RigMode;
  /** Fly to preset 1..8. */
  goPreset(key: number): void;
  /** Last preset flown to, cleared once the user moves the camera. */
  readonly preset: number | null;
  setCinematic(on: boolean): void;
  setFly(on: boolean): void;
  select(id: number | null, fly?: boolean): void;
  debug(): RigDebug;
  dispose(): void;
}

export interface RigOptions {
  initial: Pose;
  /** Start 15% further out and dolly in over 2.5 s (9.3 step 5). */
  dollyIn: boolean;
  hud: Hud;
}

const BASE_FOV = 55;
const IDLE_CINEMATIC_S = 90;
const CINEMATIC_LOOP_S = 150;
const LOOK_SENSITIVITY = 0.0022;
const CLICK_PX = 4;
const TAP_PX = 6;
const TAP_MS = 250;
const DOUBLE_TAP_MS = 320;
const ZOOM_TAU = 0.12;
const MOVE_TAU = 0.25;
const MIN_DISTANCE = 8;
/** Keys that move the camera, by KeyboardEvent.code (layout independent: works with 한글 IME). */
const MOVE_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const UP = new THREE.Vector3(0, 1, 0);

const toV3 = (v: THREE.Vector3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

function isHudButton(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('#hud button') !== null;
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('input, textarea, select, [contenteditable="true"], .lil-gui') !== null
  );
}

export function createCameraRig(ctx: Ctx, opts: RigOptions): CameraRig {
  const { camera, controls, gui, renderer, env } = ctx;
  const { hud } = opts;
  const canvas = renderer.domElement;
  const app = canvas.parentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 8.1 orbit feel. Wheel zoom is ours (smooth, cursor anchored); pinch stays OrbitControls'.
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 1.1;
  controls.zoomToCursor = true;
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = CAMERA_LIMITS.maxDistance;
  controls.maxPolarAngle = CAMERA_LIMITS.maxPolarAngle;
  controls.screenSpacePanning = false;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  camera.fov = BASE_FOV;
  camera.updateProjectionMatrix();

  let mode: RigMode = 'orbit';
  let elapsed = 0;
  let lastInput = 0;
  const pressed = new Set<string>();
  const vel = new THREE.Vector3();
  let zoomPending = 0;
  const zoomAnchor = new THREE.Vector3();
  let lastAnchorAt = -1;
  const lastAnchorPx = { x: -1e9, y: -1e9 };
  let fovTarget = BASE_FOV;

  // Flight (click-to-fly, presets, dolly-in, double-click).
  let flight: Flight | null = null;
  let flightTime = 0;
  let onLanded: (() => void) | null = null;
  const flightOut: Pose = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };

  // Fly mode.
  let yaw = 0;
  let pitch = 0;

  // Cinematic.
  let cine: { pos: THREE.CatmullRomCurve3; tgt: THREE.CatmullRomCurve3 } | null = null;
  let cineU = 0;
  let cineBlend = 0;
  const cineFrom: Pose = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };
  const cineTarget = new THREE.Vector3();

  const setPose = (p: Pose): void => {
    camera.position.set(p.position.x, p.position.y, p.position.z);
    controls.target.set(p.target.x, p.target.y, p.target.z);
  };
  const currentPose = (): Pose => ({
    position: toV3(camera.position),
    target: toV3(controls.target),
  });

  const setMode = (m: RigMode): void => {
    mode = m;
    hud.setMode(m);
    app?.classList.toggle('is-fly', m === 'fly');
    controls.enabled = m === 'orbit' || m === 'flight';
  };

  // --- initial pose ---
  setPose(opts.initial);
  controls.update();
  if (opts.dollyIn && !reduceMotion) {
    const p = opts.initial.position;
    const t = opts.initial.target;
    const start: Pose = {
      target: { ...t },
      position: {
        x: t.x + (p.x - t.x) * 1.15,
        y: t.y + (p.y - t.y) * 1.15,
        z: t.z + (p.z - t.z) * 1.15,
      },
    };
    setPose(start);
    controls.update();
    flight = planFlight(start, opts.initial, 0, 2.5);
    flightTime = 0;
    setMode('flight');
  }

  // --- flights ---
  const flyTo = (to: Pose, landed: (() => void) | null = null, lift = 60): void => {
    exitCinematic();
    if (mode === 'fly') exitFly();
    flight = planFlight(currentPose(), to, lift);
    flightTime = 0;
    onLanded = landed;
    vel.set(0, 0, 0);
    zoomPending = 0;
    setMode('flight');
  };
  const cancelFlight = (): void => {
    if (mode !== 'flight') return;
    flight = null;
    onLanded = null;
    setMode('orbit');
    controls.update();
  };

  const select = (id: number | null, fly = true): void => {
    const b = id === null ? undefined : LAYOUT.buildings[id];
    if (!b) {
      env.selectedBuilding = null;
      hud.showCard(null);
      return;
    }
    env.selectedBuilding = b.id;
    if (!fly) {
      hud.showCard(b);
      return;
    }
    hud.showCard(null);
    flyTo(frameBuildingClear(LAYOUT, b, toV3(camera.position)), () => hud.showCard(b));
  };

  let presetKey: number | null = null;
  const goPreset = (key: number): void => {
    const p = rigPreset(key);
    presetKey = p.key;
    hud.toast(`프리셋 ${p.key} · ${p.name}`);
    flyTo(p);
  };

  // --- fly mode (F) ---
  const enterFly = (): void => {
    exitCinematic();
    cancelFlight();
    camera.getWorldDirection(_v);
    yaw = Math.atan2(-_v.x, -_v.z);
    pitch = Math.asin(Math.max(-1, Math.min(1, _v.y)));
    vel.set(0, 0, 0);
    setMode('fly');
    hud.toast('비행 모드 · 마우스로 시선, W 전진, Esc 해제');
    try {
      const req = canvas.requestPointerLock() as Promise<void> | undefined;
      // Pointer lock can be refused (no user gesture, iframes, headless): drag-look still works.
      req?.catch(() => undefined);
    } catch {
      // Same: older browsers throw instead of rejecting.
    }
  };
  function exitFly(): void {
    if (mode !== 'fly') return;
    camera.getWorldDirection(_v);
    const hit = pick(LAYOUT, toV3(camera.position), toV3(_v));
    const dist = Math.min(400, Math.max(40, hit?.t ?? 120));
    const raw: Pose = {
      position: toV3(camera.position),
      target: {
        x: camera.position.x + _v.x * dist,
        y: camera.position.y + _v.y * dist,
        z: camera.position.z + _v.z * dist,
      },
    };
    const fitted = fitPolar(raw, CAMERA_LIMITS.maxPolarAngle);
    fitted.target.y = Math.max(fitted.target.y, targetFloor(fitted.target.x, fitted.target.z));
    controls.target.set(fitted.target.x, fitted.target.y, fitted.target.z);
    setMode('orbit');
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    controls.update();
  }

  // --- cinematic (C / idle 90 s) ---
  const buildCinematic = (): NonNullable<typeof cine> => {
    const presets = rigPresets();
    const pts = CINEMATIC_ORDER.map((k) => presets[k - 1]).filter((p) => p !== undefined);
    const { positions, targets } = cinematicKeys(pts);
    const curve = (v: Vec3[]): THREE.CatmullRomCurve3 =>
      new THREE.CatmullRomCurve3(
        v.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
        true,
        'centripetal',
      );
    return { pos: curve(positions), tgt: curve(targets) };
  };
  const enterCinematic = (): void => {
    if (mode === 'cinematic') return;
    if (mode === 'fly') exitFly();
    cancelFlight();
    cine ??= buildCinematic();
    // Join the loop at the point nearest to the camera, blending in over 2.5 s.
    let best = Infinity;
    for (let i = 0; i < 200; i++) {
      const d = cine.pos.getPointAt(i / 200, _v).distanceToSquared(camera.position);
      if (d < best) {
        best = d;
        cineU = i / 200;
      }
    }
    Object.assign(cineFrom, currentPose());
    cineBlend = 0;
    setMode('cinematic');
    hud.toast('시네마틱 카메라 · 아무 입력으로 중단');
  };
  function exitCinematic(): void {
    if (mode !== 'cinematic') return;
    const raw: Pose = { position: toV3(camera.position), target: toV3(cineTarget) };
    const fitted = fitPolar(raw, CAMERA_LIMITS.maxPolarAngle);
    fitted.target.y = Math.max(fitted.target.y, targetFloor(fitted.target.x, fitted.target.z));
    controls.target.set(fitted.target.x, fitted.target.y, fitted.target.z);
    fovTarget = BASE_FOV;
    setMode('orbit');
    controls.update();
  }

  /** Any user input: resets the idle timer and stops the cinematic. */
  const markInput = (): void => {
    lastInput = elapsed;
    exitCinematic();
  };
  /** The user steered the camera themselves: no preset is "current" any more. */
  const steered = (): void => {
    presetKey = null;
  };

  // --- picking (click / tap only, never per pointer move) ---
  const raycaster = new THREE.Raycaster();
  const pickAt = (clientX: number, clientY: number): ReturnType<typeof pick> => {
    const r = canvas.getBoundingClientRect();
    _ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(_ndc, camera);
    return pick(LAYOUT, toV3(raycaster.ray.origin), toV3(raycaster.ray.direction));
  };

  // --- listeners ---
  let down: { id: number; x: number; y: number; at: number; button: number; type: string } | null =
    null;
  let lastTap = { at: -1e9, x: 0, y: 0 };

  const onPointerDown = (e: PointerEvent): void => {
    markInput();
    cancelFlight();
    steered();
    down = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      at: performance.now(),
      button: e.button,
      type: e.pointerType,
    };
    canvas.focus({ preventScroll: true });
  };
  const onPointerMove = (e: PointerEvent): void => {
    // Drag-look fallback when pointer lock was refused.
    if (mode === 'fly' && document.pointerLockElement !== canvas && e.buttons !== 0) {
      look(e.movementX, e.movementY);
    }
  };
  const onPointerUp = (e: PointerEvent): void => {
    const d = down;
    down = null;
    if (!d || d.id !== e.pointerId || d.button !== 0 || mode === 'fly') return;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    const now = performance.now();
    if (d.type === 'touch' || d.type === 'pen') {
      if (moved >= TAP_PX || now - d.at >= TAP_MS) return;
      const isDouble =
        now - lastTap.at < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
      lastTap = isDouble ? { at: -1e9, x: 0, y: 0 } : { at: now, x: e.clientX, y: e.clientY };
      const hit = pickAt(e.clientX, e.clientY);
      // 8.6: tap = select (card), double tap = fly there.
      if (hit?.kind === 'building') select(hit.id, isDouble);
      else select(null);
      return;
    }
    if (moved >= CLICK_PX) return;
    const hit = pickAt(e.clientX, e.clientY);
    if (hit?.kind === 'building') {
      if (env.selectedBuilding === hit.id && mode === 'flight') return;
      select(hit.id, true);
    } else {
      select(null);
    }
  };
  const onDblClick = (e: MouseEvent): void => {
    if (mode === 'fly') return;
    const hit = pickAt(e.clientX, e.clientY);
    if (hit?.kind !== 'ground') return;
    // 8.1: move the target to the clicked ground point, keeping the camera offset (0.8 s).
    const off = _v.copy(camera.position).sub(controls.target);
    const target = {
      x: hit.point.x,
      y: Math.max(hit.point.y, targetFloor(hit.point.x, hit.point.z)),
      z: hit.point.z,
    };
    flyTo(
      { target, position: { x: target.x + off.x, y: target.y + off.y, z: target.z + off.z } },
      null,
      0,
    );
    if (flight) flight.duration = 0.8;
  };

  const onWheel = (e: WheelEvent): void => {
    if (e.target !== canvas) return;
    // Capture phase on window: OrbitControls' own (undamped) wheel zoom never sees it.
    e.preventDefault();
    e.stopPropagation();
    markInput();
    cancelFlight();
    steered();
    const px = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    const amount = Math.max(-0.6, Math.min(0.6, -e.deltaY * px * 0.0022 * controls.zoomSpeed));
    if (mode === 'fly') {
      camera.getWorldDirection(_v);
      vel.addScaledVector(_v, amount * 60);
      return;
    }
    // Re-pick the anchor only when the cursor moved or the gesture paused (throttled).
    const moved = Math.hypot(e.clientX - lastAnchorPx.x, e.clientY - lastAnchorPx.y);
    if (moved > 8 || elapsed - lastAnchorAt > 0.25) {
      const hit = pickAt(e.clientX, e.clientY);
      if (hit) zoomAnchor.set(hit.point.x, hit.point.y, hit.point.z);
      else
        zoomAnchor
          .copy(raycaster.ray.direction)
          .multiplyScalar(camera.position.distanceTo(controls.target))
          .add(camera.position);
      lastAnchorPx.x = e.clientX;
      lastAnchorPx.y = e.clientY;
    }
    lastAnchorAt = elapsed;
    zoomPending += amount;
  };

  const look = (dx: number, dy: number): void => {
    yaw -= dx * LOOK_SENSITIVITY;
    pitch = Math.max(-1.45, Math.min(1.45, pitch - dy * LOOK_SENSITIVITY));
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (mode === 'fly' && document.pointerLockElement === canvas) look(e.movementX, e.movementY);
  };
  const onPointerLockChange = (): void => {
    // Esc while locked is eaten by the browser: leaving the lock leaves fly mode.
    if (mode === 'fly' && document.pointerLockElement !== canvas && lockedOnce) exitFly();
    lockedOnce = document.pointerLockElement === canvas;
  };
  let lockedOnce = false;

  const onKeyDown = (e: KeyboardEvent): void => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    // Space / Enter belong to the focused HUD button, not the camera.
    if (isHudButton(e.target) && (e.code === 'Space' || e.code === 'Enter')) return;
    markInput();
    const code = e.code;
    if (MOVE_KEYS.has(code) || code === 'ShiftLeft' || code === 'ShiftRight') {
      pressed.add(code);
      if (MOVE_KEYS.has(code)) {
        cancelFlight();
        steered();
        e.preventDefault();
      }
      return;
    }
    if (e.repeat) return;
    if (e.key === '?' || (code === 'Slash' && e.shiftKey)) {
      hud.toggleHelp();
      return;
    }
    const digit = /^(?:Digit|Numpad)([1-8])$/.exec(code);
    if (digit) {
      goPreset(Number(digit[1]));
      return;
    }
    switch (code) {
      case 'KeyF':
        if (mode === 'fly') exitFly();
        else enterFly();
        break;
      case 'KeyC':
        // markInput() already stopped a running cinematic.
        if (!wasCinematic) enterCinematic();
        break;
      case 'KeyR':
        goPreset(DEFAULT_PRESET);
        break;
      case 'KeyH':
        hud.toggle();
        break;
      case 'Escape':
        if (hud.helpOpen) hud.toggleHelp(false);
        else if (mode === 'fly') exitFly();
        else select(null);
        break;
    }
  };
  // markInput() runs before the C handler; remember whether C should toggle off.
  let wasCinematic = false;
  const onKeyDownCapture = (): void => {
    wasCinematic = mode === 'cinematic';
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    pressed.delete(e.code);
  };
  const onBlur = (): void => pressed.clear();

  // Touch buttons (8.6): hold up / down to climb or descend.
  const touchRoot = document.querySelector('.touch-pad');
  const onTouchButton = (e: PointerEvent): void => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('button');
    if (!el) return;
    e.preventDefault();
    const hold = el.dataset.hold;
    const code = hold === 'up' ? 'KeyE' : hold === 'down' ? 'KeyQ' : null;
    if (e.type === 'pointerdown') {
      markInput();
      cancelFlight();
      if (code) {
        pressed.add(code);
        steered();
        el.setPointerCapture(e.pointerId);
      }
    } else if (code) {
      pressed.delete(code);
    }
  };

  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('keydown', onKeyDownCapture, { capture: true });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('dblclick', onDblClick);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  const touchEvents = ['pointerdown', 'pointerup', 'pointercancel'] as const;
  for (const t of touchEvents) touchRoot?.addEventListener(t, onTouchButton as EventListener);
  canvas.tabIndex = 0;

  const camState = { cinematic: false, fly: false, preset: DEFAULT_PRESET };
  const folder = gui.addFolder('Camera');
  const cineCtrl = folder
    .add(camState, 'cinematic')
    .name('Cinematic [C]')
    .onChange((v: boolean) => (v ? enterCinematic() : exitCinematic()));
  const flyCtrl = folder
    .add(camState, 'fly')
    .name('Fly mode [F]')
    .onChange((v: boolean) => (v ? enterFly() : exitFly()));
  folder
    .add(
      camState,
      'preset',
      Object.fromEntries(rigPresets().map((p) => [`${p.key} ${p.name}`, p.key])),
    )
    .name('Preset [1-8]')
    .onChange((k: number) => goPreset(k));
  folder.close();

  // --- per-frame steps ---
  const keyAxis = (pos: string, alt: string, neg: string, alt2: string): number =>
    (pressed.has(pos) || pressed.has(alt) ? 1 : 0) -
    (pressed.has(neg) || pressed.has(alt2) ? 1 : 0);

  /** WASD/QE velocity with 0.25 s exponential accel/decel; returns the frame displacement. */
  const keyboardStep = (
    dt: number,
    forward: THREE.Vector3,
    right: THREE.Vector3,
  ): THREE.Vector3 => {
    const f = keyAxis('KeyW', 'ArrowUp', 'KeyS', 'ArrowDown');
    const s = keyAxis('KeyD', 'ArrowRight', 'KeyA', 'ArrowLeft');
    const u = keyAxis('KeyE', 'KeyE', 'KeyQ', 'KeyQ');
    const height = camera.position.y - surfaceHeight(camera.position.x, camera.position.z);
    const speed = moveSpeed(height, pressed.has('ShiftLeft') || pressed.has('ShiftRight'));
    _move.set(0, 0, 0).addScaledVector(forward, f).addScaledVector(right, s);
    if (_move.lengthSq() > 1) _move.normalize();
    _move.multiplyScalar(speed);
    _move.y += u * speed * 0.6;
    vel.lerp(_move, dampFactor(dt, MOVE_TAU));
    if (vel.lengthSq() < 1e-4) vel.set(0, 0, 0);
    return _w.copy(vel).multiplyScalar(dt);
  };

  const zoomStep = (dt: number): void => {
    if (zoomPending === 0) return;
    const step = zoomPending * dampFactor(dt, ZOOM_TAU);
    zoomPending -= step;
    if (Math.abs(zoomPending) < 1e-4) zoomPending = 0;
    let s = Math.exp(-step);
    const orbit = camera.position.distanceTo(controls.target);
    const toAnchor = camera.position.distanceTo(zoomAnchor);
    if (s > 1 && orbit * s > CAMERA_LIMITS.maxDistance) {
      s = Math.max(1, CAMERA_LIMITS.maxDistance / orbit);
    }
    // Never zoom closer than 6 m to the surface under the cursor.
    if (s < 1 && toAnchor * s < 6) s = Math.min(1, 6 / Math.max(toAnchor, 1e-6));
    camera.position.sub(zoomAnchor).multiplyScalar(s).add(zoomAnchor);
    controls.target.sub(zoomAnchor).multiplyScalar(s).add(zoomAnchor);
    // Keep the orbit pivot at least minDistance ahead: zooming in flies through, not stops.
    const d = camera.position.distanceTo(controls.target);
    if (d < MIN_DISTANCE) {
      _v.copy(controls.target).sub(camera.position).normalize();
      controls.target.copy(camera.position).addScaledVector(_v, MIN_DISTANCE);
    }
  };

  const clampCamera = (): void => {
    const p = camera.position;
    const fixed = resolveCollision(LAYOUT, p);
    if (fixed) p.set(fixed.x, fixed.y, fixed.z);
    const floor = cameraFloor(p.x, p.z);
    if (p.y < floor) p.y = floor;
  };

  const updateOrbit = (dt: number): void => {
    _fwd.copy(controls.target).sub(camera.position).setY(0);
    if (_fwd.lengthSq() < 1e-6) camera.getWorldDirection(_fwd).setY(0);
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _right.crossVectors(_fwd, UP).normalize();
    const delta = keyboardStep(dt, _fwd, _right);
    camera.position.add(delta);
    controls.target.add(delta);
    zoomStep(dt);
    const height = camera.position.y - surfaceHeight(camera.position.x, camera.position.z);
    controls.panSpeed = panSpeedFor(height);
    const tf = targetFloor(controls.target.x, controls.target.z);
    if (controls.target.y < tf) controls.target.y = tf;
    controls.update();
  };

  const updateFly = (dt: number): void => {
    _euler.set(pitch, yaw, 0);
    camera.quaternion.setFromEuler(_euler);
    camera.getWorldDirection(_fwd);
    _right.crossVectors(_fwd, UP).normalize();
    camera.position.add(keyboardStep(dt, _fwd, _right));
  };

  const updateFlight = (dt: number): void => {
    if (!flight) {
      setMode('orbit');
      return;
    }
    flightTime += dt;
    flightPose(flight, Math.min(flightTime, flight.duration), flightOut);
    setPose(flightOut);
    camera.lookAt(controls.target);
    if (flightTime >= flight.duration) {
      flight = null;
      setMode('orbit');
      controls.update();
      const cb = onLanded;
      onLanded = null;
      cb?.();
    }
  };

  const updateCinematic = (dt: number): void => {
    if (!cine) return;
    cineU = (cineU + dt / CINEMATIC_LOOP_S) % 1;
    const t = cine.pos.getUtoTmapping(cineU, 0);
    cine.pos.getPoint(t, _v);
    cine.tgt.getPoint(t, cineTarget);
    if (cineBlend < 1) {
      cineBlend = Math.min(1, cineBlend + dt / 2.5);
      const e = easeInOutCubic(cineBlend);
      _w.set(cineFrom.position.x, cineFrom.position.y, cineFrom.position.z);
      _v.lerpVectors(_w, _v, e);
      _w.set(cineFrom.target.x, cineFrom.target.y, cineFrom.target.z);
      cineTarget.lerpVectors(_w, cineTarget, e);
    }
    camera.position.copy(_v);
    fovTarget = 54 + 4 * Math.sin((elapsed * Math.PI * 2) / 23);
  };

  const rig: CameraRig = {
    get mode() {
      return mode;
    },
    update(dt, t) {
      elapsed = t;
      if (
        mode === 'orbit' &&
        !reduceMotion &&
        elapsed - lastInput > IDLE_CINEMATIC_S &&
        !document.hidden
      ) {
        enterCinematic();
      }
      switch (mode) {
        case 'orbit':
          updateOrbit(dt);
          break;
        case 'fly':
          updateFly(dt);
          break;
        case 'flight':
          updateFlight(dt);
          break;
        case 'cinematic':
          updateCinematic(dt);
          break;
      }
      clampCamera();
      if (mode === 'cinematic') camera.lookAt(cineTarget);
      else if (mode === 'flight') camera.lookAt(controls.target);
      // FOV breathes in the cinematic and eases back to 55° afterwards.
      const df = fovTarget - camera.fov;
      if (Math.abs(df) > 1e-3) {
        camera.fov += df * dampFactor(dt, 0.4);
        camera.updateProjectionMatrix();
      }
      camState.cinematic = mode === 'cinematic';
      camState.fly = mode === 'fly';
    },
    goPreset,
    get preset() {
      return presetKey;
    },
    setCinematic(on) {
      lastInput = elapsed;
      if (on) enterCinematic();
      else exitCinematic();
    },
    setFly(on) {
      lastInput = elapsed;
      if (on && mode !== 'fly') enterFly();
      else if (!on) exitFly();
    },
    select,
    debug() {
      return {
        mode,
        position: toV3(camera.position),
        target: toV3(mode === 'cinematic' ? cineTarget : controls.target),
        fov: camera.fov,
        selected: env.selectedBuilding,
      };
    },
    dispose() {
      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('keydown', onKeyDownCapture, { capture: true });
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('dblclick', onDblClick);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      for (const t of touchEvents)
        touchRoot?.removeEventListener(t, onTouchButton as EventListener);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      cineCtrl.destroy();
      flyCtrl.destroy();
      folder.destroy();
    },
  };
  return rig;
}
