// Frame stats, `?stats` overlay, window.__ramha and adaptive DPR (ART_DIRECTION 11).
// renderer.info.autoReset is off, so info counts the whole frame including composer passes;
// main calls frameStart() before the module updates and frameEnd() after ctx.render().
import type { Ctx } from '../core/types';
import { AdaptiveDpr } from './dpr';

export interface FrameStats {
  calls: number;
  triangles: number;
  programs: number;
  textures: number;
  geometries: number;
  fps: number;
  dpr: number;
}

export interface Perf {
  frameStart(): void;
  /** `dt` = real frame delta (s). */
  frameEnd(dt: number): void;
  stats(): FrameStats;
  dispose(): void;
}

/** DPR cap (11): min(devicePixelRatio, 1.5). */
export const DPR_CAP = 1.5;

export function createPerf(ctx: Ctx, opts: { overlay: boolean; resize: () => void }): Perf {
  const { renderer, gui } = ctx;
  renderer.info.autoReset = false;
  const adaptive = new AdaptiveDpr({ max: Math.min(window.devicePixelRatio || 1, DPR_CAP) });
  renderer.setPixelRatio(adaptive.dpr);

  const last: FrameStats = {
    calls: 0,
    triangles: 0,
    programs: 0,
    textures: 0,
    geometries: 0,
    fps: 0,
    dpr: adaptive.dpr,
  };
  // fps over a 0.5 s window.
  let acc = 0;
  let count = 0;

  const quality = { dpr: adaptive.dpr, adaptive: true, avgMs: 0 };
  const folder = gui.addFolder('Performance');
  const applyDpr = (v: number): void => {
    renderer.setPixelRatio(v);
    last.dpr = v;
    quality.dpr = v;
    opts.resize();
  };
  folder
    .add(quality, 'adaptive')
    .name('Adaptive DPR')
    // Off means "full quality": restore the cap instead of freezing the last lowered value.
    .onChange(() => applyDpr(adaptive.reset()));
  folder.add(quality, 'dpr').name('DPR').listen().disable();
  folder.add(quality, 'avgMs').name('avg frame (ms)').listen().disable();
  folder.close();

  const overlay = opts.overlay ? document.getElementById('hud-stats') : null;
  if (overlay) overlay.hidden = false;

  const perf: Perf = {
    frameStart() {
      renderer.info.reset();
    },
    frameEnd(dt) {
      const info = renderer.info;
      last.calls = info.render.calls;
      last.triangles = info.render.triangles;
      last.programs = info.programs?.length ?? 0;
      last.textures = info.memory.textures;
      last.geometries = info.memory.geometries;
      acc += dt;
      count++;
      if (acc >= 0.5) {
        last.fps = count / acc;
        acc = 0;
        count = 0;
        quality.avgMs = Math.round(adaptive.averageMs * 10) / 10;
        if (overlay) {
          overlay.textContent =
            `fps   ${last.fps.toFixed(0).padStart(6)}\n` +
            `calls ${String(last.calls).padStart(6)}\n` +
            `tris  ${(last.triangles / 1000).toFixed(0).padStart(5)}k\n` +
            `prog  ${String(last.programs).padStart(6)}\n` +
            `tex   ${String(last.textures).padStart(6)}\n` +
            `geo   ${String(last.geometries).padStart(6)}\n` +
            `dpr   ${last.dpr.toFixed(2).padStart(6)}`;
        }
      }
      if (!quality.adaptive) return;
      const next = adaptive.sample(dt);
      if (next !== null) applyDpr(next);
    },
    stats() {
      return { ...last };
    },
    dispose() {
      folder.destroy();
      if (overlay) overlay.hidden = true;
    },
  };
  return perf;
}
