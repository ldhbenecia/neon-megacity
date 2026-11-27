import * as THREE from 'three';
import type { Ctx, Quality } from '../core/types';
import { QualityController, type UserTier } from './quality';

export interface FrameStats {
  calls: number;
  triangles: number;
  programs: number;
  textures: number;
  geometries: number;
  fps: number;
  dpr: number;
  /** Current render tier (env.quality). */
  tier: string;
}

/** The quality picker's view: the current tier and whether the controller may change it. */
export interface QualityChoice {
  tier: Quality;
  auto: boolean;
}

export interface Perf {
  /**
   * Quality picker: a tier applies it at once (at its DPR cap) and stops automatic changes;
   * 'auto' returns to the device's tier and lets the controller adjust again. No-op in the ci tier.
   * Storing the choice is the caller's job (QUALITY_STORAGE_KEY).
   */
  choose(choice: 'auto' | UserTier): void;
  quality(): QualityChoice;
  frameStart(): void;
  frameEnd(dt: number): void;
  stats(): FrameStats;
  dispose(): void;
}

export const DPR_CAP = 1.5;
export const LOW_DPR = 0.5;

export interface PerfOptions {
  overlay: boolean;
  resize: () => void;
  /** The boot tier was picked by the user (?quality=, stored choice): automatic changes start off. */
  manual: boolean;
  /** Tier that 'auto' returns to (the renderer-based guess). */
  autoTier: UserTier;
  /** Called after a runtime tier change, once env.quality holds the new tier. */
  emitQuality: (q: Quality) => void;
}

export function createPerf(ctx: Ctx, opts: PerfOptions): Perf {
  const { renderer, gui, env } = ctx;
  renderer.info.autoReset = false;
  // The ci tier is fixed; user tiers are driven by one controller (DPR first, then the tier).
  const controller =
    env.quality === 'ci'
      ? null
      : // Never constructed as manual: `quality.auto` gates it, so the picker can turn it back on.
        new QualityController(env.quality, window.devicePixelRatio || 1, false);
  const startDpr = controller ? controller.state.dpr : LOW_DPR;
  renderer.setPixelRatio(startDpr);

  const last: FrameStats = {
    calls: 0,
    triangles: 0,
    programs: 0,
    textures: 0,
    geometries: 0,
    fps: 0,
    dpr: startDpr,
    tier: env.quality,
  };
  let acc = 0;
  let count = 0;

  const quality = {
    tier: env.quality as string,
    dpr: startDpr,
    auto: !!controller && !opts.manual,
    medianMs: 0,
  };
  const folder = gui.addFolder('Performance');
  const applyDpr = (v: number): void => {
    renderer.setPixelRatio(v);
    last.dpr = v;
    quality.dpr = v;
    opts.resize();
  };
  const applyChange = (change: ReturnType<QualityController['step']>): void => {
    if (!change) return;
    if (change.dpr !== last.dpr) applyDpr(change.dpr);
    if (change.tierChanged) {
      env.quality = change.tier;
      quality.tier = change.tier;
      last.tier = change.tier;
      opts.emitQuality(change.tier);
    }
  };
  folder
    .add(quality, 'auto')
    .name('Auto quality')
    .listen()
    // On behaves like the picker's 'auto'; off returns to the boot tier (?quality=, the stored
    // pick or the device guess) at full DPR, not the last lowered step.
    .onChange((on: boolean) => {
      if (!controller) return;
      if (on) {
        perf.choose('auto');
        return;
      }
      quality.auto = false;
      applyChange(controller.reset());
    });
  folder.add(quality, 'tier').name('Tier').listen().disable();
  folder.add(quality, 'dpr').name('DPR').listen().disable();
  folder.add(quality, 'medianMs').name('median frame (ms)').listen().disable();
  folder.close();

  const overlay = opts.overlay ? document.getElementById('hud-stats') : null;
  if (overlay) overlay.hidden = false;

  const perf: Perf = {
    choose(choice) {
      if (!controller) return;
      quality.auto = choice === 'auto';
      applyChange(controller.reset(choice === 'auto' ? opts.autoTier : choice));
    },
    quality() {
      return { tier: env.quality, auto: quality.auto };
    },
    // renderer.info.autoReset is off: info then counts the whole frame, post passes included.
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
        quality.medianMs = Math.round((controller?.medianMs ?? 0) * 10) / 10;
        if (overlay) {
          overlay.textContent =
            `fps   ${last.fps.toFixed(0).padStart(6)}\n` +
            `calls ${String(last.calls).padStart(6)}\n` +
            `tris  ${(last.triangles / 1000).toFixed(0).padStart(5)}k\n` +
            `prog  ${String(last.programs).padStart(6)}\n` +
            `tex   ${String(last.textures).padStart(6)}\n` +
            `geo   ${String(last.geometries).padStart(6)}\n` +
            `dpr   ${last.dpr.toFixed(2).padStart(6)}\n` +
            `tier  ${quality.tier.padStart(6)}`;
        }
      }
      if (!controller || !quality.auto) return;
      // Frames of a hidden tab say nothing about the GPU.
      if (document.hidden) return;
      applyChange(controller.step(dt));
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

export interface MemoryEstimate {
  geometryBytes: number;
  textureBytes: number;
  canvasBytes: number;
  /** MSAA samples of the canvas framebuffer (1 = none). */
  samples: number;
}

// RGB is padded to 4 channels by most drivers, so it is not listed (falls back to 4).
const CHANNELS = new Map<THREE.AnyPixelFormat, number>([
  [THREE.RedFormat, 1],
  [THREE.RedIntegerFormat, 1],
  [THREE.AlphaFormat, 1],
  [THREE.RGFormat, 2],
  [THREE.RGIntegerFormat, 2],
]);
const MIPMAP_FILTERS = new Set<THREE.TextureFilter>([
  THREE.NearestMipmapNearestFilter,
  THREE.NearestMipmapLinearFilter,
  THREE.LinearMipmapNearestFilter,
  THREE.LinearMipmapLinearFilter,
]);

function textureBytes(tex: THREE.Texture): number {
  const img: unknown = tex.image;
  const images = Array.isArray(img) ? img : [img];
  let texels = 0;
  for (const i of images) {
    const {
      width = 0,
      height = 0,
      depth = 1,
    } = (i ?? {}) as {
      width?: number;
      height?: number;
      depth?: number;
    };
    texels += width * height * depth;
  }
  const channel = tex.type === THREE.FloatType ? 4 : tex.type === THREE.HalfFloatType ? 2 : 1;
  const mip = tex.generateMipmaps && MIPMAP_FILTERS.has(tex.minFilter) ? 4 / 3 : 1;
  return texels * channel * (CHANNELS.get(tex.format) ?? 4) * mip;
}

/**
 * Bytes of geometry and textures reachable from the scene graph (plus scene.environment /
 * background). Not counted: render targets owned by post-processing, and textures that only live
 * in an `onBeforeCompile` closure (not on the material or its `uniforms`).
 */
export function estimateMemory(ctx: Ctx): MemoryEstimate {
  const { scene, renderer } = ctx;
  const buffers = new Set<ArrayBufferLike>();
  const textures = new Set<THREE.Texture>();
  let geometryBytes = 0;
  const addArray = (a: { array: ArrayLike<number> & { buffer: ArrayBufferLike } }): void => {
    if (buffers.has(a.array.buffer)) return;
    buffers.add(a.array.buffer);
    geometryBytes += a.array.buffer.byteLength;
  };
  const addTextures = (o: object): void => {
    for (const v of Object.values(o) as unknown[]) {
      const inner: unknown = v && typeof v === 'object' && 'value' in v ? v.value : v;
      for (const t of Array.isArray(inner) ? (inner as unknown[]) : [inner]) {
        if (t instanceof THREE.Texture) textures.add(t as THREE.Texture);
      }
    }
  };
  scene.traverse((obj) => {
    const mesh = obj as Partial<THREE.Mesh> & Partial<THREE.InstancedMesh>;
    if (mesh.geometry) {
      for (const attr of Object.values(mesh.geometry.attributes)) {
        addArray('data' in attr ? attr.data : attr);
      }
      if (mesh.geometry.index) addArray(mesh.geometry.index);
    }
    if (mesh.instanceMatrix) addArray(mesh.instanceMatrix);
    if (mesh.instanceColor) addArray(mesh.instanceColor);
    const mats = mesh.material ? [mesh.material].flat() : [];
    for (const m of mats) {
      addTextures(m);
      if (m instanceof THREE.ShaderMaterial) addTextures(m.uniforms);
    }
  });
  addTextures([scene.environment, scene.background]);
  let texBytes = 0;
  for (const t of textures) texBytes += textureBytes(t);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const gl = renderer.getContext();
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(null);
  const samples = Math.max(1, Number(gl.getParameter(gl.SAMPLES)));
  renderer.setRenderTarget(prev);
  return {
    geometryBytes,
    textureBytes: texBytes,
    // Color + depth/stencil, 4 bytes each, per sample.
    canvasBytes: size.x * size.y * 8 * samples,
    samples,
  };
}
