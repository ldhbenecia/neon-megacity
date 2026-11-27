// First chunk: generates the layout in the city worker while the app chunks download, then runs
// the app. Layout generation (~0.8 s on v3) used to block the main thread during JS evaluation;
// here the boot skeleton keeps animating meanwhile. Without workers it falls back to generating
// on the main thread, as before.
import type { Layout } from './city/types';
import { CITY_SEED } from './city/seed';

function layoutInWorker(seed: number): Promise<Layout> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./city/layout.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent<Layout>) => {
      resolve(e.data);
      worker.terminate();
    };
    worker.onerror = (e) => {
      reject(new Error(e.message || 'city worker failed'));
      worker.terminate();
    };
    worker.postMessage({ seed });
  });
}

async function layoutOnMainThread(seed: number): Promise<Layout> {
  const { generateLayout } = await import('./city/generate');
  return generateLayout(seed);
}

async function makeLayout(seed: number): Promise<Layout> {
  if (typeof Worker === 'undefined') return layoutOnMainThread(seed);
  try {
    return await layoutInWorker(seed);
  } catch (err) {
    console.warn('[boot] city worker unavailable, generating the layout on the main thread', err);
    return layoutOnMainThread(seed);
  }
}

// The app chunks are already downloading (modulepreload links added at build time, see
// vite.config.ts), so the import below only evaluates them. The layout must be published first:
// some modules derive constants from LAYOUT while they are evaluated.
// The generator chunk carries most of three.js and never reads LAYOUT: evaluate it now, while the
// worker runs, instead of after.
const warm = import('./city/generate');

makeLayout(CITY_SEED)
  .then(async (layout) => {
    await warm;
    const { setLayout } = await import('./city/layout');
    setLayout(layout);
    await import('./main');
  })
  .catch((err: unknown) => {
    console.error('[boot] failed', err);
    document.getElementById('boot')?.classList.add('is-error');
  });
