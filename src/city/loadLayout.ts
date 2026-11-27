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

export type CityMessage =
  { kind: 'layout'; layout: Layout } | { kind: 'terrain'; terrain: TerrainPrebuilt };

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
}

function inWorker(seed: number, worker: LayoutWorker): CityLoad {
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
  const fail = (err: Error): void => {
    failLayout(err);
    gotTerrain(null);
    worker.terminate();
  };
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.kind === 'layout') gotLayout(m.layout);
    else {
      gotTerrain(m.terrain);
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
  return { layout, terrain };
}

async function onMainThread(seed: number): Promise<Layout> {
  const { generateLayout } = await import('./generate');
  return generateLayout(seed);
}

/** `createWorker` is null where workers do not exist; it may also throw or the worker may fail. */
export function loadCity(
  seed: number,
  createWorker: (() => LayoutWorker) | null = typeof Worker === 'undefined' ? null : cityWorker,
): CityLoad {
  if (!createWorker) return { layout: onMainThread(seed), terrain: Promise.resolve(null) };
  let w: CityLoad;
  try {
    w = inWorker(seed, createWorker());
  } catch (err) {
    console.warn('[boot] city worker unavailable, generating the layout on the main thread', err);
    return { layout: onMainThread(seed), terrain: Promise.resolve(null) };
  }
  return {
    layout: w.layout.catch((err: unknown) => {
      console.warn('[boot] city worker failed, generating the layout on the main thread', err);
      return onMainThread(seed);
    }),
    terrain: w.terrain,
  };
}

export function loadLayout(
  seed: number,
  createWorker?: (() => LayoutWorker) | null,
): Promise<Layout> {
  return (createWorker === undefined ? loadCity(seed) : loadCity(seed, createWorker)).layout;
}
