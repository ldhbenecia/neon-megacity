import * as THREE from 'three';
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
  frameEnd(dt: number): void;
  stats(): FrameStats;
  dispose(): void;
}

export const DPR_CAP = 1.5;
export const LOW_DPR = 0.5;

export function createPerf(ctx: Ctx, opts: { overlay: boolean; resize: () => void }): Perf {
  const { renderer, gui } = ctx;
  renderer.info.autoReset = false;
  const max = ctx.env.quality === 'low' ? LOW_DPR : Math.min(window.devicePixelRatio || 1, DPR_CAP);
  const adaptive = new AdaptiveDpr({ max });
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

export interface MemoryEstimate {
  geometryBytes: number;
  textureBytes: number;
  framebufferBytes: number;
}

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
  const bpp = tex.type === THREE.FloatType ? 16 : tex.type === THREE.HalfFloatType ? 8 : 4;
  return texels * bpp * (tex.generateMipmaps && tex.minFilter !== THREE.LinearFilter ? 4 / 3 : 1);
}

/**
 * Bytes of geometry and textures reachable from the scene graph (plus scene.environment /
 * background). Render targets owned by post-processing are not reachable and not counted.
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
      if (inner instanceof THREE.Texture) textures.add(inner as THREE.Texture);
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
  for (const t of [scene.environment, scene.background]) {
    if (t instanceof THREE.Texture) textures.add(t);
  }
  let texBytes = 0;
  for (const t of textures) texBytes += textureBytes(t);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const samples = renderer.getContext().getContextAttributes()?.antialias ? 4 : 1;
  return {
    geometryBytes,
    textureBytes: texBytes,
    framebufferBytes: size.x * size.y * 8 * samples,
  };
}
