import * as THREE from 'three';
import { LAYOUT, buildingTop, surfaceHeight, type Vec3 } from '../city/layout';
import type { Ctx } from '../core/types';
import {
  WALL_MARGIN,
  cameraFloor,
  frameBuildingClear,
  pick,
  resolveCollision,
  targetFloor,
} from './collision';
import type { Hud, RigMode } from './hud';
import { reducedMotion } from './loader';
import {
  clamp,
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
  update(dt: number, elapsed: number): void;
  readonly mode: RigMode;
  goPreset(key: number): void;
  readonly preset: number | null;
  setCinematic(on: boolean): void;
  setFly(on: boolean): void;
  select(id: number | null, fly?: boolean): void;
  debug(): RigDebug;
  dispose(): void;
}

export interface RigOptions {
  initial: Pose;
  dollyIn: boolean;
  idleCinematic: boolean;
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
const MIN_DISTANCE = CAMERA_LIMITS.minDistance;
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

/** Above this height no building volume (spires included) can be within the wall margin. */
const SKY_CLEAR = LAYOUT.buildings.reduce((m, b) => Math.max(m, buildingTop(b)), 0) + WALL_MARGIN;

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
  const reduceMotion = reducedMotion();

  // Wheel zoom is handled by the rig (onWheel); pinch zoom stays with OrbitControls.
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
  let idleFor = 0;
  const pressed = new Set<string>();
  const vel = new THREE.Vector3();
  let zoomPending = 0;
  const zoomAnchor = new THREE.Vector3();
  let lastAnchorAt = -1;
  const lastAnchorPx = { x: -1e9, y: -1e9 };
  let fovTarget = BASE_FOV;

  let flight: Flight | null = null;
  let flightTime = 0;
  let onLanded: (() => void) | null = null;
  /** The running flight is the boot dolly-in, not something the user asked for. */
  let dolly = false;
  const flightOut: Pose = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };

  let yaw = 0;
  let pitch = 0;

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
    dolly = true;
    setMode('flight');
  }

  const flyTo = (to: Pose, landed: (() => void) | null = null, lift = 60): void => {
    exitCinematic();
    if (mode === 'fly') exitFly();
    flight = planFlight(currentPose(), to, lift);
    flightTime = 0;
    dolly = false;
    onLanded = landed;
    vel.set(0, 0, 0);
    zoomPending = 0;
    setMode('flight');
  };
  const cancelFlight = (): void => {
    if (mode !== 'flight') return;
    flight = null;
    dolly = false;
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

  const orbitAround = (raw: Pose): void => {
    const { target } = fitPolar(raw, CAMERA_LIMITS.maxPolarAngle);
    controls.target.set(target.x, Math.max(target.y, targetFloor(target.x, target.z)), target.z);
  };

  const enterFly = (): void => {
    exitCinematic();
    cancelFlight();
    camera.getWorldDirection(_v);
    yaw = Math.atan2(-_v.x, -_v.z);
    pitch = Math.asin(clamp(_v.y, -1, 1));
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
    const dist = clamp(hit?.t ?? 120, 40, 400);
    const raw: Pose = {
      position: toV3(camera.position),
      target: {
        x: camera.position.x + _v.x * dist,
        y: camera.position.y + _v.y * dist,
        z: camera.position.z + _v.z * dist,
      },
    };
    orbitAround(raw);
    setMode('orbit');
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    controls.update();
  }

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
    orbitAround(raw);
    fovTarget = BASE_FOV;
    setMode('orbit');
    controls.update();
  }

  const markInput = (): void => {
    idleFor = 0;
    exitCinematic();
  };
  const touchIdle = (): void => {
    idleFor = 0;
  };
  const steered = (): void => {
    presetKey = null;
  };

  const raycaster = new THREE.Raycaster();
  const setRayFromPointer = (clientX: number, clientY: number): void => {
    const r = canvas.getBoundingClientRect();
    _ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(_ndc, camera);
  };
  const pickRay = (): ReturnType<typeof pick> =>
    pick(LAYOUT, toV3(raycaster.ray.origin), toV3(raycaster.ray.direction));
  const pickAt = (clientX: number, clientY: number): ReturnType<typeof pick> => {
    setRayFromPointer(clientX, clientY);
    return pickRay();
  };

  interface Down {
    id: number;
    x: number;
    y: number;
    at: number;
    button: number;
    type: string;
    /** Rig mode when the press started: a press that stops a cinematic or the boot dolly-in
     * must not also pick (and fly to) whatever is under the cursor. */
    mode: RigMode;
    dolly: boolean;
    flyingTo: number | null;
    resume: { flight: Flight; time: number; landed: (() => void) | null } | null;
  }
  let down: Down | null = null;
  let lastTap = { at: -1e9, x: 0, y: 0 };

  const onPointerDown = (e: PointerEvent): void => {
    const startMode = mode;
    const startDolly = dolly;
    const flyingTo = mode === 'flight' ? env.selectedBuilding : null;
    const resume =
      mode === 'flight' && flight ? { flight, time: flightTime, landed: onLanded } : null;
    // Capture phase: this runs before OrbitControls' own pointerdown, so leaving the cinematic
    // re-enables the controls in time for this very drag.
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
      mode: startMode,
      dolly: startDolly,
      flyingTo,
      resume,
    };
    canvas.focus({ preventScroll: true });
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (mode === 'fly' && document.pointerLockElement !== canvas && e.buttons !== 0) {
      look(e.movementX, e.movementY);
    }
  };
  const onPointerUp = (e: PointerEvent): void => {
    const d = down;
    down = null;
    if (!d || d.id !== e.pointerId || d.button !== 0 || mode === 'fly') return;
    if (d.mode === 'cinematic' || d.dolly) return;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    const now = performance.now();
    if (d.type === 'touch' || d.type === 'pen') {
      if (moved >= TAP_PX || now - d.at >= TAP_MS) return;
      const isDouble =
        now - lastTap.at < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
      lastTap = isDouble ? { at: -1e9, x: 0, y: 0 } : { at: now, x: e.clientX, y: e.clientY };
      const hit = pickAt(e.clientX, e.clientY);
      if (hit?.kind === 'building') select(hit.id, isDouble);
      else select(null);
      return;
    }
    if (moved >= CLICK_PX) return;
    const hit = pickAt(e.clientX, e.clientY);
    if (hit?.kind === 'building') {
      if (d.flyingTo === hit.id && d.resume) {
        flight = d.resume.flight;
        flightTime = d.resume.time;
        onLanded = d.resume.landed;
        setMode('flight');
        return;
      }
      select(hit.id, true);
    } else {
      select(null);
    }
  };
  const onDblClick = (e: MouseEvent): void => {
    if (mode === 'fly') return;
    const hit = pickAt(e.clientX, e.clientY);
    if (hit?.kind !== 'ground') return;
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
    const amount = clamp(-e.deltaY * px * 0.0022 * controls.zoomSpeed, -0.6, 0.6);
    if (mode === 'fly') {
      camera.getWorldDirection(_v);
      vel.addScaledVector(_v, amount * 60);
      return;
    }
    // Keep one anchor through a continuous scroll (re-picking every event would jitter), but
    // re-pick when the cursor moved, the gesture paused, the camera has nearly reached the
    // anchor, or the anchor drifted off the cursor ray (pan / rotate between wheel events).
    setRayFromPointer(e.clientX, e.clientY);
    const moved = Math.hypot(e.clientX - lastAnchorPx.x, e.clientY - lastAnchorPx.y);
    const toAnchor = _w.copy(zoomAnchor).sub(raycaster.ray.origin);
    const near = toAnchor.length() < MIN_DISTANCE;
    const offRay = toAnchor.normalize().dot(raycaster.ray.direction) < Math.cos(0.04);
    if (moved > 8 || elapsed - lastAnchorAt > 0.25 || near || offRay) {
      const hit = pickRay();
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
    pitch = clamp(pitch - dy * LOOK_SENSITIVITY, -1.45, 1.45);
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
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) {
      touchIdle();
      return;
    }
    // Space / Enter belong to the focused HUD button, not the camera.
    if (isHudButton(e.target) && (e.code === 'Space' || e.code === 'Enter')) {
      touchIdle();
      return;
    }
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
  canvas.addEventListener('pointerdown', onPointerDown, { capture: true });
  const hudRoot = document.getElementById('hud');
  hudRoot?.addEventListener('pointerdown', touchIdle);
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

  const keyAxis = (pos: string, alt: string, neg: string, alt2: string): number =>
    (pressed.has(pos) || pressed.has(alt) ? 1 : 0) -
    (pressed.has(neg) || pressed.has(alt2) ? 1 : 0);

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
    if (s < 1 && toAnchor * s < 6) s = Math.min(1, 6 / Math.max(toAnchor, 1e-6));
    camera.position.sub(zoomAnchor).multiplyScalar(s).add(zoomAnchor);
    controls.target.sub(zoomAnchor).multiplyScalar(s).add(zoomAnchor);
    const d = camera.position.distanceTo(controls.target);
    if (d < MIN_DISTANCE) {
      _v.copy(controls.target).sub(camera.position).normalize();
      controls.target.copy(camera.position).addScaledVector(_v, MIN_DISTANCE);
    }
  };

  // Collision is skipped when the camera has not moved since the last resolved frame (the
  // result is idempotent, see tests) or flies above the tallest building plus the wall margin.
  const resolvedAt = new THREE.Vector3(Infinity, Infinity, Infinity);
  const clampCamera = (): void => {
    const p = camera.position;
    if (p.equals(resolvedAt)) return;
    if (p.y <= SKY_CLEAR) {
      const fixed = resolveCollision(LAYOUT, p);
      if (fixed) p.set(fixed.x, fixed.y, fixed.z);
    }
    const floor = cameraFloor(p.x, p.z);
    if (p.y < floor) p.y = floor;
    resolvedAt.copy(p);
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
    if (flightTime >= flight.duration) {
      flight = null;
      dolly = false;
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
      // Clamped frame time, not wall time: a slow first load must not count as idling.
      idleFor += dt;
      if (
        opts.idleCinematic &&
        mode === 'orbit' &&
        !reduceMotion &&
        idleFor > IDLE_CINEMATIC_S &&
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
      idleFor = 0;
      if (on) enterCinematic();
      else exitCinematic();
    },
    setFly(on) {
      idleFor = 0;
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
      canvas.removeEventListener('pointerdown', onPointerDown, { capture: true });
      hudRoot?.removeEventListener('pointerdown', touchIdle);
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
