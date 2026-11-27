// City worker (docs/PERF.md "async boot"): the layout first, so the main thread can start booting,
// then the terrain geometry (src/terrain/ground.ts), transferred without a copy.
import { packGeometry, packedBuffers } from '../core/packedGeometry';
import { buildChannel, buildGround } from '../terrain/ground';
import { generateLayout } from './generate';
import { setLayout } from './layout';
import type { CityMessage } from './loadLayout';

self.onmessage = (e: MessageEvent<{ seed: number }>) => {
  const layout = generateLayout(e.data.seed);
  postMessage({ kind: 'layout', layout } satisfies CityMessage);
  // The terrain code reads the worker's own copy of LAYOUT.
  setLayout(layout);
  const terrain = { ground: packGeometry(buildGround()), channel: packGeometry(buildChannel()) };
  postMessage({ kind: 'terrain', terrain } satisfies CityMessage, {
    transfer: [...packedBuffers(terrain.ground), ...packedBuffers(terrain.channel)],
  });
};
