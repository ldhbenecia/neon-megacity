// ux entry (ART_DIRECTION 8-11). main.ts drives boot through this module: loader, camera rig,
// HUD, power-on ramp (env.powerOn), frame stats / adaptive DPR and the `?stats` test hook.
import type { CameraPreset } from '../core/query';
import type { Ctx } from '../core/types';
import { createCameraRig, type CameraRig, type RigDebug } from './cameraRig';
import { createControls } from './controls';
import { createHud, type Hud } from './hud';
import { reducedMotion } from './loader';
import { createPerf, type FrameStats, type Perf } from './perf';
import { camPose, DEFAULT_PRESET, rigPreset } from './presets';
import { parseUxQuery } from './query';

export { createLoader, nextFrame, type Loader } from './loader';
export { parseUxQuery } from './query';

export interface Ux {
  rig: CameraRig;
  hud: Hud;
  perf: Perf;
  /** Before the feature modules: power-on ramp, camera input / motion. */
  beforeUpdate(dt: number, elapsed: number): void;
  /** After the feature modules, before render: HUD. */
  afterUpdate(dt: number, elapsed: number): void;
  /** Around the whole frame (renderer.info is aggregated over every pass). */
  frameStart(): void;
  frameEnd(dt: number): void;
  /** 9.3: ramp env.powerOn 0 → 1 (lighting multiplies exposure, neon lights up by zone). */
  powerOn(): void;
  /** True once the power-on ramp has finished. */
  readonly powered: boolean;
  dispose(): void;
}

export interface UxOptions {
  /** `?cam=` preset (wins over `?preset=`). */
  cam?: CameraPreset;
  /** Re-run resize handlers (after an adaptive DPR change). */
  resize: () => void;
}

/** Power-on ramp length (s). */
const POWER_S = 1.2;

export function initUx(ctx: Ctx, opts: UxOptions): Ux {
  const q = parseUxQuery(window.location.search);
  const reduceMotion = reducedMotion();
  const deterministic = opts.cam !== undefined || q.preset !== undefined;
  const hud = createHud({
    visible: q.hud,
    onDeselect: () => rig.select(null),
  });
  // Deterministic starts (?cam / ?preset) skip the boot dolly-in.
  const initial = opts.cam ? camPose(opts.cam) : rigPreset(q.preset ?? DEFAULT_PRESET);
  const rig = createCameraRig(ctx, {
    initial,
    dollyIn: !deterministic,
    hud,
  });
  const controls = createControls(ctx, rig, hud);
  const perf = createPerf(ctx, { overlay: q.stats, resize: opts.resize });

  if (q.stats) {
    window.__hangang = {
      stats: (): FrameStats => perf.stats(),
      camera: (): RigDebug => rig.debug(),
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
      // Screenshot / test URLs pin the camera; keep their frames free of the intro hint.
      if (!deterministic) hud.showHint();
    },
    beforeUpdate(dt, t) {
      if (power) {
        power.t += dt;
        const x = Math.min(1, power.t / (reduceMotion ? 0.4 : POWER_S));
        // smoothstep: a soft start like a grid coming online.
        ctx.env.powerOn = x * x * (3 - 2 * x);
        if (x >= 1) {
          power = null;
          powered = true;
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
