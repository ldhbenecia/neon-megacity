// Entry point. Order contract: the layout is generated (city worker, or the main thread as a
// fallback), published with setLayout, and only then is the app (src/main.ts) evaluated.
import { loadLayout } from './city/loadLayout';
import { CITY_SEED } from './city/seed';

// The generator chunk carries most of three.js and never reads LAYOUT: evaluate it now, while the
// worker runs, instead of after.
const warm = import('./city/generate');
// Handled here so a failure before `await warm` is not an unhandled rejection; it still rejects there.
warm.catch(() => {});

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
