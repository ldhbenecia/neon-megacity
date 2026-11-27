// Entry point. The app chunks (src/main.ts and its imports) are evaluated while the city worker
// generates the layout; no module reads LAYOUT while it is evaluated (docs/ARCHITECTURE.md). The
// layout is then published with setLayout and only after that does the app start.
import { loadCity } from './city/loadLayout';
import { providePrebuilt } from './core/prebuilt';
import { CITY_SEED } from './city/seed';

// The app chunks are already downloading (modulepreload links, see vite.config.ts).
const app = import('./main');
const city = loadCity(CITY_SEED);
const layout = city.layout;
// Terrain geometry follows the layout from the same worker; terrain init waits for it (main.ts).
providePrebuilt('terrain', city.terrain, city.layout);
providePrebuilt('buildings', city.buildings, city.layout);
// Handled here so an app failure while the worker still runs is not an unhandled rejection.
app.catch(() => {});

layout
  .then(async (l) => {
    const [{ setLayout }, { start }] = await Promise.all([import('./city/layout'), app]);
    setLayout(l);
    start();
  })
  .catch((err: unknown) => {
    console.error('[boot] failed', err);
    document.getElementById('boot')?.classList.add('is-error');
  });
