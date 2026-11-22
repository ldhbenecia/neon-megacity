// CameraRig placeholder (ART_DIRECTION 8). Owns every camera move on top of OrbitControls.
// Today: initial preset, cinematic auto-orbit (C) and ground clamping, moved here from main.ts.
// The ux module grows this into fly mode, click-to-fly, collision, presets 1-8 and touch.
import { surfaceHeight } from '../city/layout';
import { CAMERA_PRESETS, type CameraPreset } from '../core/query';
import type { Ctx } from '../core/types';

export interface CameraRig {
  /** Runs before the feature modules each frame. */
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

/** Minimum camera height above the walkable surface (m). */
const MIN_CLEARANCE = 2;

export function createCameraRig(ctx: Ctx, preset: CameraPreset = 'overview'): CameraRig {
  const { camera, controls, gui } = ctx;
  const p = CAMERA_PRESETS[preset];
  camera.position.fromArray(p.position);
  controls.target.fromArray(p.target);
  controls.update();

  const cine = { enabled: false, angle: Math.atan2(camera.position.z, camera.position.x) };
  const setCinematic = (v: boolean): void => {
    cine.enabled = v;
    controls.enabled = !v;
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'c' || e.key === 'C') setCinematic(!cine.enabled);
  };
  window.addEventListener('keydown', onKey);
  const ctrl = gui
    .add(cine, 'enabled')
    .name('Cinematic camera [C]')
    .onChange(setCinematic)
    .listen();

  return {
    update(dt, t) {
      if (cine.enabled) {
        cine.angle += dt * 0.05;
        const r = 900 + Math.sin(t * 0.07) * 200;
        camera.position.set(
          -60 + Math.cos(cine.angle) * r,
          220 + Math.sin(t * 0.11) * 90,
          -200 + Math.sin(cine.angle) * r,
        );
        camera.lookAt(-60, 120, -380);
      } else {
        // Keep the orbit pivot and the camera above ground even while panning.
        controls.target.y = Math.max(controls.target.y, 0);
        controls.update();
      }
      const floor = surfaceHeight(camera.position.x, camera.position.z) + MIN_CLEARANCE;
      if (camera.position.y < floor) camera.position.y = floor;
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      ctrl.destroy();
    },
  };
}
