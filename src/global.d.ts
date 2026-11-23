// Globals shared by the app (src/) and the Node-side tooling (tests/e2e, scripts/).
export {};

/** `?stats` frame counters (ART_DIRECTION 11), one whole frame including post passes. */
interface HangangStats {
  calls: number;
  triangles: number;
  programs: number;
  textures: number;
  geometries: number;
  fps: number;
  dpr: number;
}

/** Rough GPU memory estimate (bytes) of what the scene graph references, for `npm run perf`. */
interface HangangMemory {
  geometryBytes: number;
  textureBytes: number;
  /** Canvas drawing buffer only (color + depth, × MSAA samples); post targets are not included. */
  canvasBytes: number;
  samples: number;
}

/** Camera rig state for e2e control tests. */
interface HangangCamera {
  mode: 'orbit' | 'fly' | 'cinematic' | 'flight';
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov: number;
  selected: number | null;
}

declare global {
  interface Window {
    /**
     * Set every frame by main.ts once boot finished; polled by e2e tests and the screenshot
     * script. `powered` turns true when the loader is gone and the power-on ramp has ended.
     */
    __city?: {
      ready: boolean;
      frames: number;
      powered: boolean;
      /** Moving average of each module's update() CPU time (ms), keyed by module name. */
      cpu: Record<string, number>;
    };
    /** Only with `?stats`: frame counters and camera rig state (src/ux). */
    __hangang?: { stats(): HangangStats; camera(): HangangCamera; memory(): HangangMemory };
  }
}
