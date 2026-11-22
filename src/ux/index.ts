// ux entry (ART_DIRECTION 8-11). main.ts drives boot through this module: loader, camera rig,
// HUD, power-on ramp (env.powerOn), frame stats / adaptive DPR and the `?stats` test hook.
import type { CameraPreset } from '../core/query';
import type { Ctx } from '../core/types';
import { createCameraRig, type CameraRig, type RigDebug } from './cameraRig';
import { createHud, type Hud } from './hud';
import { createPerf, type FrameStats, type Perf } from './perf';
import { camPose, DEFAULT_PRESET, rigPreset } from './presets';
import { parseUxQuery } from './query';

export { createLoader, nextFrame, type Loader } from './loader';

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
  /** Hide lil-gui when the HUD is hidden (false with ?nogui, which keeps it hidden). */
  guiFollowsHud?: boolean;
  /** Re-run resize handlers (after an adaptive DPR change). */
  resize: () => void;
}

/** Power-on ramp length (s). */
const POWER_S = 1.2;

export function initUx(ctx: Ctx, opts: UxOptions): Ux {
  const q = parseUxQuery(window.location.search);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hud = createHud({
    visible: q.hud,
    onToggle: (v) => {
      if (opts.guiFollowsHud !== false) {
        if (v) ctx.gui.show();
        else ctx.gui.hide();
      }
    },
  });
  // Deterministic starts (?cam / ?preset) skip the boot dolly-in.
  const initial = opts.cam ? camPose(opts.cam) : rigPreset(q.preset ?? DEFAULT_PRESET);
  const rig = createCameraRig(ctx, {
    initial,
    dollyIn: !opts.cam && q.preset === undefined,
    hud,
  });
  const perf = createPerf(ctx, { overlay: q.stats, resize: opts.resize });

  if (q.stats) {
    window.__ramha = {
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
    },
    frameStart() {
      perf.frameStart();
    },
    frameEnd(dt) {
      perf.frameEnd(dt);
    },
    dispose() {
      rig.dispose();
      hud.dispose();
      perf.dispose();
      delete window.__ramha;
    },
  };
}
