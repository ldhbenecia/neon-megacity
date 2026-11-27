// City data for boot: the city worker generates the layout, then the terrain geometry; without a
// worker (or when it fails) the layout is generated on the main thread and terrain builds its own
// geometry in init, as before. Same functions either way (tests/load-layout.test.ts).
import type { PackedGeometry } from '../core/packedGeometry';
import type { Layout } from './types';

/** Terrain geometry built in the worker (src/terrain/index.ts takes it through core/prebuilt). */
export interface TerrainPrebuilt {
  ground: PackedGeometry;
  channel: PackedGeometry;
}

/** Road and sidewalk geometry and the puddle mask (src/buildings/index.ts). */
export interface BuildingsPrebuilt {
  roads: PackedGeometry;
  walks: PackedGeometry;
  puddle: Uint8Array;
}

export type CityMessage =
  | { kind: 'layout'; layout: Layout }
  | { kind: 'terrain'; terrain: TerrainPrebuilt }
  | { kind: 'buildings'; buildings: BuildingsPrebuilt };

/** Minimal worker surface, so tests can inject a fake. */
export interface LayoutWorker {
  onmessage: ((e: MessageEvent<CityMessage>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  onmessageerror: ((e: MessageEvent) => void) | null;
  postMessage(data: { seed: number }): void;
  terminate(): void;
}

export function cityWorker(): LayoutWorker {
  return new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
}

export interface CityLoad {
  layout: Promise<Layout>;
  /** Null when the worker is missing or failed: terrain then builds in init. Never rejects. */
  terrain: Promise<TerrainPrebuilt | null>;
  buildings: Promise<BuildingsPrebuilt | null>;
}

/**
 * After the layout, how long the worker's geometry may take before the modules build it: a
 * worker killed without an error event (memory pressure) must not leave the loader waiting.
 */
export const TERRAIN_TIMEOUT_MS = 8000;

function inWorker(seed: number, worker: LayoutWorker, terrainTimeoutMs: number): CityLoad {
  let gotLayout: (l: Layout) => void = () => {};
  let gotTerrain: (t: TerrainPrebuilt | null) => void = () => {};
  let failLayout: (e: Error) => void = () => {};
  const layout = new Promise<Layout>((res, rej) => {
    gotLayout = res;
    failLayout = rej;
  });
  const terrain = new Promise<TerrainPrebuilt | null>((res) => {
    gotTerrain = res;
  });
  let gotBuildings: (b: BuildingsPrebuilt | null) => void = () => {};
  const buildings = new Promise<BuildingsPrebuilt | null>((res) => {
    gotBuildings = res;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fail = (err: Error): void => {
    clearTimeout(timer);
    failLayout(err);
    gotTerrain(null);
    gotBuildings(null);
    worker.terminate();
  };
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.kind === 'layout') {
      gotLayout(m.layout);
      timer = setTimeout(() => {
        console.warn('[boot] city worker: no terrain geometry in time, terrain builds it itself');
        gotTerrain(null);
        gotBuildings(null);
        worker.terminate();
      }, terrainTimeoutMs);
    } else if (m.kind === 'terrain') {
      gotTerrain(m.terrain);
    } else {
      clearTimeout(timer);
      gotBuildings(m.buildings);
      worker.terminate();
    }
  };
  worker.onerror = (e) => {
    fail(new Error(e.message || 'city worker failed'));
  };
  worker.onmessageerror = () => {
    fail(new Error('city worker: a message could not be deserialized'));
  };
  worker.postMessage({ seed });
  return { layout, terrain, buildings };
}

async function onMainThread(seed: number): Promise<Layout> {
  const { generateLayout } = await import('./generate');
  return generateLayout(seed);
}

/** `createWorker` is null where workers do not exist; it may also throw or the worker may fail. */
export function loadCity(
  seed: number,
  createWorker: (() => LayoutWorker) | null = typeof Worker === 'undefined' ? null : cityWorker,
  terrainTimeoutMs = TERRAIN_TIMEOUT_MS,
): CityLoad {
  const none = { terrain: Promise.resolve(null), buildings: Promise.resolve(null) };
  if (!createWorker) return { layout: onMainThread(seed), ...none };
  let w: CityLoad;
  try {
    w = inWorker(seed, createWorker(), terrainTimeoutMs);
  } catch (err) {
    console.warn('[boot] city worker unavailable, generating the layout on the main thread', err);
    return { layout: onMainThread(seed), ...none };
  }
  return {
    layout: w.layout.catch((err: unknown) => {
      console.warn('[boot] city worker failed, generating the layout on the main thread', err);
      return onMainThread(seed);
    }),
    terrain: w.terrain,
    buildings: w.buildings,
  };
}
