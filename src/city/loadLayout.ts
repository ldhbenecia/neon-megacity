// Layout source for boot: the city worker, or the main thread when workers are missing or fail.
// Both call the same generateLayout, so the result is identical (tests/load-layout.test.ts).
import type { Layout } from './types';

/** Minimal worker surface, so tests can inject a fake. */
export interface LayoutWorker {
  onmessage: ((e: MessageEvent<Layout>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  onmessageerror: ((e: MessageEvent) => void) | null;
  postMessage(data: { seed: number }): void;
  terminate(): void;
}

export function cityWorker(): LayoutWorker {
  return new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
}

function inWorker(seed: number, worker: LayoutWorker): Promise<Layout> {
  return new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      resolve(e.data);
      worker.terminate();
    };
    worker.onerror = (e) => {
      reject(new Error(e.message || 'city worker failed'));
      worker.terminate();
    };
    worker.onmessageerror = () => {
      reject(new Error('city worker: layout could not be deserialized'));
      worker.terminate();
    };
    worker.postMessage({ seed });
  });
}

async function onMainThread(seed: number): Promise<Layout> {
  const { generateLayout } = await import('./generate');
  return generateLayout(seed);
}

/** `createWorker` is null where workers do not exist; it may also throw or the worker may fail. */
export async function loadLayout(
  seed: number,
  createWorker: (() => LayoutWorker) | null = typeof Worker === 'undefined' ? null : cityWorker,
): Promise<Layout> {
  if (!createWorker) return onMainThread(seed);
  try {
    return await inWorker(seed, createWorker());
  } catch (err) {
    console.warn('[boot] city worker unavailable, generating the layout on the main thread', err);
    return onMainThread(seed);
  }
}
