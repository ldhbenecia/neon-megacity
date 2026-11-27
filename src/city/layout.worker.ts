// City worker (docs/PERF.md "async boot"): the layout first, so the main thread can start booting,
// then the terrain geometry (src/terrain/ground.ts) and the road geometry and puddle mask
// (src/buildings/roads.ts), in module init order, transferred without a copy.
import { packGeometry, packedBuffers } from '../core/packedGeometry';
import { PUDDLE_SIZE, buildRoads, buildSidewalks, puddleData } from '../buildings/roads';
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
  const buildings = {
    roads: packGeometry(buildRoads(layout)),
    walks: packGeometry(buildSidewalks(layout)),
    puddle: puddleData(layout.seed, PUDDLE_SIZE),
  };
  postMessage({ kind: 'buildings', buildings } satisfies CityMessage, {
    transfer: [
      ...packedBuffers(buildings.roads),
      ...packedBuffers(buildings.walks),
      buildings.puddle.buffer as ArrayBuffer,
    ],
  });
};
