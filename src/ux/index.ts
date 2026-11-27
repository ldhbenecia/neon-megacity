import type { CameraPreset } from '../core/query';
import type { Ctx, Quality } from '../core/types';
import { createCameraRig, type CameraRig, type RigDebug } from './cameraRig';
import { createControls } from './controls';
import { createHud, type Hud } from './hud';
import { reducedMotion } from './loader';
import { createPerf, estimateMemory, type FrameStats, type Perf } from './perf';
import { LAYOUT } from '../city/layout';
import { camPose, DEFAULT_PRESET, rigPreset, rigPresets, safePose } from './presets';
import { parseUxQuery, poseInLimits } from './query';

export { createLoader, nextFrame, type Loader } from './loader';
export { parseUxQuery } from './query';

export interface Ux {
  rig: CameraRig;
  hud: Hud;
  perf: Perf;
  beforeUpdate(dt: number, elapsed: number): void;
  afterUpdate(dt: number, elapsed: number): void;
  frameStart(): void;
  frameEnd(dt: number): void;
  powerOn(): void;
  readonly powered: boolean;
  dispose(): void;
}

export interface UxOptions {
  cam?: CameraPreset;
  resize: () => void;
  /** env.quality came from ?quality= or a stored pick: the controller leaves it alone. */
  manualQuality: boolean;
  /** Runs the ctx.onQuality handlers after a runtime tier change. */
  emitQuality: (q: Quality) => void;
}

const POWER_S = 1.2;

export function initUx(ctx: Ctx, opts: UxOptions): Ux {
  const q = parseUxQuery(window.location.search);
  const reduceMotion = reducedMotion();
  // safePose may lower the target onto the camera (e.g. a target straight above it).
  const pose = q.pose ? safePose(LAYOUT, q.pose) : undefined;
  const custom = pose && poseInLimits(pose) ? pose : undefined;
  const deterministic = custom !== undefined || opts.cam !== undefined || q.preset !== undefined;
  const hud = createHud({
    visible: q.hud,
    onDeselect: () => rig.select(null),
  });
  const initial = custom
    ? custom
    : opts.cam
      ? camPose(opts.cam)
      : rigPreset(q.preset ?? DEFAULT_PRESET);
  const rig = createCameraRig(ctx, {
    initial,
    dollyIn: !deterministic,
    idleCinematic: !deterministic,
    hud,
  });
  const controls = createControls(ctx, rig, hud);
  const perf = createPerf(ctx, {
    overlay: q.stats,
    resize: opts.resize,
    manual: opts.manualQuality,
    emitQuality: opts.emitQuality,
  });

  if (q.stats) {
    window.__hangang = {
      stats: (): FrameStats => perf.stats(),
      camera: (): RigDebug => rig.debug(),
      memory: () => estimateMemory(ctx),
      preset: (key: number) => {
        if (!Number.isInteger(key) || key < 1 || key > rigPresets().length) {
          throw new RangeError(`no rig preset ${key}`);
        }
        const { position, target } = rigPreset(key);
        return { position: { ...position }, target: { ...target } };
      },
      buildingPoint: () => rig.buildingPoint(),
    };
  }

  let power: { t: number } | null = null;
  let powered = false;
  return {
    rig,
    hud,
    perf,
    get powered() {
      return powered;
    },
    powerOn() {
      ctx.env.powerOn = 0;
      power = { t: 0 };
    },
    beforeUpdate(dt, t) {
      if (power) {
        power.t += dt;
        const x = Math.min(1, power.t / (reduceMotion ? 0.4 : POWER_S));
        ctx.env.powerOn = x * x * (3 - 2 * x);
        if (x >= 1) {
          power = null;
          powered = true;
          // The hint's 7 s start once the city is lit: on a slow device the ramp itself can take
          // seconds, and the user would otherwise never see the hint.
          if (!deterministic) hud.showHint();
        }
      }
      rig.update(dt, t);
    },
    afterUpdate() {
      hud.update(ctx.env.timeOfDay);
      controls.update();
    },
    frameStart() {
      perf.frameStart();
    },
    frameEnd(dt) {
      perf.frameEnd(dt);
    },
    dispose() {
      controls.dispose();
      rig.dispose();
      hud.dispose();
      perf.dispose();
      delete window.__hangang;
    },
  };
}
