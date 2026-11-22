// ux entry (ART_DIRECTION 9, 8). main.ts drives boot through this module and never needs
// editing for ux work: loader, camera rig and HUD all live under src/ux/.
import { clockMinutes, formatClock } from '../core/clock';
import type { CameraPreset } from '../core/query';
import type { Ctx } from '../core/types';
import { createCameraRig, type CameraRig } from './cameraRig';

export { createLoader, type Loader } from './loader';

export interface Ux {
  rig: CameraRig;
  /** Before the feature modules: camera input / motion. */
  beforeUpdate(dt: number, elapsed: number): void;
  /** After the feature modules, before render: HUD. */
  afterUpdate(dt: number, elapsed: number): void;
  dispose(): void;
}

export function initUx(ctx: Ctx, opts: { preset?: CameraPreset } = {}): Ux {
  const rig = createCameraRig(ctx, opts.preset);
  const clockEl = document.getElementById('clock');
  let clockMins = -1;
  return {
    rig,
    beforeUpdate(dt, t) {
      rig.update(dt, t);
    },
    afterUpdate() {
      // The clock only changes once per in-game minute; skip redundant DOM writes.
      const mins = clockMinutes(ctx.env.timeOfDay);
      if (clockEl && mins !== clockMins) {
        clockMins = mins;
        clockEl.textContent = formatClock(mins);
      }
    },
    dispose() {
      rig.dispose();
    },
  };
}
