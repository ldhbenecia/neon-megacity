// Shared, deterministic city layout. Every module reads from here so that
// buildings, neon signs and traffic all line up. Units: 1 = 1 meter.
// Coordinate system: Y up, ground at y = 0, city centered at the origin.
import { createRng } from '../core/random.js';

export const CITY = {
  gridN: 11,          // blocks per side
  blockSize: 64,      // block footprint (square)
  roadWidth: 18,      // road between blocks
  sidewalk: 3,        // inset inside a block before lots start
};
CITY.cell = CITY.blockSize + CITY.roadWidth;
CITY.size = CITY.gridN * CITY.cell;          // total extent
CITY.half = CITY.size / 2;
// Roads at k = 0..gridN, blocks in between; the whole grid is centered at 0.
CITY.origin = -(CITY.size + CITY.roadWidth) / 2;
CITY.extent = CITY.size + CITY.roadWidth;    // edge-to-edge incl. outer roads

// District by distance from center (in blocks).
// 'core'    : megatowers 160-420m, corporate plaza
// 'midtown' : dense 50-160m towers
// 'outer'   : 12-50m low-rise, gritty
export function districtFor(bx, bz) {
  const c = (CITY.gridN - 1) / 2;
  const d = Math.max(Math.abs(bx - c), Math.abs(bz - c));
  if (d <= 1) return 'core';
  if (d <= 3) return 'midtown';
  return 'outer';
}

/** Block center in world space. */
export function blockCenter(bx, bz) {
  return {
    x: CITY.origin + CITY.cell * bx + CITY.roadWidth + CITY.blockSize / 2,
    z: CITY.origin + CITY.cell * bz + CITY.roadWidth + CITY.blockSize / 2,
  };
}

function generate(seed = 2077) {
  const rng = createRng(seed);
  const blocks = [];
  const buildings = [];
  let id = 0;
  for (let bx = 0; bx < CITY.gridN; bx++) {
    for (let bz = 0; bz < CITY.gridN; bz++) {
      const district = districtFor(bx, bz);
      const { x: cx, z: cz } = blockCenter(bx, bz);
      const block = { bx, bz, x: cx, z: cz, size: CITY.blockSize, district, buildingIds: [] };
      blocks.push(block);
      const inner = CITY.blockSize - CITY.sidewalk * 2;
      // Lots per side: core = 1-2 (huge), midtown = 2-3, outer = 3-4
      const n = district === 'core' ? rng.int(1, 2) : district === 'midtown' ? rng.int(2, 3) : rng.int(3, 4);
      const lot = inner / n;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (district === 'outer' && rng.chance(0.12)) continue; // empty lot
          const fill = rng.range(0.72, 0.92);
          const w = lot * fill * rng.range(0.85, 1);
          const d = lot * fill * rng.range(0.85, 1);
          let h;
          if (district === 'core') h = rng.range(160, 420);
          else if (district === 'midtown') h = rng.range(50, 160) * (rng.chance(0.15) ? 1.6 : 1);
          else h = rng.range(12, 50);
          const b = {
            id: id++,
            x: cx - inner / 2 + lot * (i + 0.5),
            z: cz - inner / 2 + lot * (j + 0.5),
            w, d, h, district,
            block: [bx, bz],
            seed: Math.floor(rng.next() * 1e9),
          };
          buildings.push(b);
          block.buildingIds.push(b.id);
        }
      }
    }
  }

  // Road strips. Roads run between blocks and around the border.
  // axis 'x' = the road runs along the X axis (constant z), and vice versa.
  const roads = [];
  for (let k = 0; k <= CITY.gridN; k++) {
    const p = CITY.origin + CITY.cell * k + CITY.roadWidth / 2;
    roads.push({ axis: 'x', x: 0, z: p, length: CITY.extent, width: CITY.roadWidth });
    roads.push({ axis: 'z', x: p, z: 0, length: CITY.extent, width: CITY.roadWidth });
  }
  return { blocks, buildings, roads };
}

export const LAYOUT = generate();
