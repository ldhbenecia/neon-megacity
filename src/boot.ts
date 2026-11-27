// First chunk: generates the layout in the city worker while the app chunks download, then runs
// the app. Layout generation (~0.8 s on v3) used to block the main thread during JS evaluation;
// here the boot skeleton keeps animating meanwhile. Without workers it falls back to generating
// on the main thread, as before.
import { loadLayout } from './city/loadLayout';
import { CITY_SEED } from './city/seed';

// The generator chunk carries most of three.js and never reads LAYOUT: evaluate it now, while the
// worker runs, instead of after.
const warm = import('./city/generate');

// The app chunks are already downloading (modulepreload links, see vite.config.ts); the import
// below only evaluates them, after the layout is published (some modules read LAYOUT while being
// evaluated).
loadLayout(CITY_SEED)
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
