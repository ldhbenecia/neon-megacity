// Shared, deterministic city layout. Every module reads from here so that
// buildings, neon signs and traffic all line up. Units: 1 = 1 meter.
// Coordinate system: Y up, ground at y = 0, city centered at the origin.
import { createRng } from '../core/random';

export type District = 'core' | 'midtown' | 'outer';

const gridN = 11; // blocks per side
const blockSize = 64; // block footprint (square)
const roadWidth = 18; // road between blocks
const sidewalk = 3; // inset inside a block before lots start
const cell = blockSize + roadWidth;
const size = gridN * cell;

export const CITY = {
  gridN,
  blockSize,
  roadWidth,
  sidewalk,
  cell,
  /** total extent of the block grid */
  size,
  half: size / 2,
  /** Roads at k = 0..gridN, blocks in between; the whole grid is centered at 0. */
  origin: -(size + roadWidth) / 2,
  /** edge-to-edge incl. outer roads */
  extent: size + roadWidth,
} as const;

/** Height ranges per district (midtown may get a 1.6x landmark multiplier). */
export const DISTRICT_HEIGHT: Record<District, { min: number; max: number }> = {
  core: { min: 160, max: 420 },
  midtown: { min: 50, max: 160 * 1.6 },
  outer: { min: 12, max: 50 },
};

export interface Block {
  bx: number;
  bz: number;
  x: number;
  z: number;
  size: number;
  district: District;
  buildingIds: number[];
}

export interface Building {
  id: number;
  /** center */
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  district: District;
  block: [number, number];
  seed: number;
}

export interface Road {
  /** 'x' = the road runs along the X axis (constant z), and vice versa. */
  axis: 'x' | 'z';
  x: number;
  z: number;
  length: number;
  width: number;
}

export interface Layout {
  blocks: Block[];
  buildings: Building[];
  roads: Road[];
}

// District by distance from center (in blocks).
// 'core'    : megatowers 160-420m, corporate plaza
// 'midtown' : dense 50-160m towers
// 'outer'   : 12-50m low-rise, gritty
export function districtFor(bx: number, bz: number): District {
  const c = (CITY.gridN - 1) / 2;
  const d = Math.max(Math.abs(bx - c), Math.abs(bz - c));
  if (d <= 1) return 'core';
  if (d <= 3) return 'midtown';
  return 'outer';
}

/** Block center in world space. */
export function blockCenter(bx: number, bz: number): { x: number; z: number } {
  return {
    x: CITY.origin + CITY.cell * bx + CITY.roadWidth + CITY.blockSize / 2,
    z: CITY.origin + CITY.cell * bz + CITY.roadWidth + CITY.blockSize / 2,
  };
}

export function generateLayout(seed = 2077): Layout {
  const rng = createRng(seed);
  const blocks: Block[] = [];
  const buildings: Building[] = [];
  let id = 0;
  for (let bx = 0; bx < CITY.gridN; bx++) {
    for (let bz = 0; bz < CITY.gridN; bz++) {
      const district = districtFor(bx, bz);
      const { x: cx, z: cz } = blockCenter(bx, bz);
      const block: Block = {
        bx,
        bz,
        x: cx,
        z: cz,
        size: CITY.blockSize,
        district,
        buildingIds: [],
      };
      blocks.push(block);
      const inner = CITY.blockSize - CITY.sidewalk * 2;
      // Lots per side: core = 1-2 (huge), midtown = 2-3, outer = 3-4
      const n =
        district === 'core'
          ? rng.int(1, 2)
          : district === 'midtown'
            ? rng.int(2, 3)
            : rng.int(3, 4);
      const lot = inner / n;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (district === 'outer' && rng.chance(0.12)) continue; // empty lot
          const fill = rng.range(0.72, 0.92);
          const w = lot * fill * rng.range(0.85, 1);
          const d = lot * fill * rng.range(0.85, 1);
          let h: number;
          if (district === 'core') h = rng.range(160, 420);
          else if (district === 'midtown') h = rng.range(50, 160) * (rng.chance(0.15) ? 1.6 : 1);
          else h = rng.range(12, 50);
          const b: Building = {
            id: id++,
            x: cx - inner / 2 + lot * (i + 0.5),
            z: cz - inner / 2 + lot * (j + 0.5),
            w,
            d,
            h,
            district,
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
  const roads: Road[] = [];
  for (let k = 0; k <= CITY.gridN; k++) {
    const p = CITY.origin + CITY.cell * k + CITY.roadWidth / 2;
    roads.push({ axis: 'x', x: 0, z: p, length: CITY.extent, width: CITY.roadWidth });
    roads.push({ axis: 'z', x: p, z: 0, length: CITY.extent, width: CITY.roadWidth });
  }
  return { blocks, buildings, roads };
}

export const LAYOUT: Layout = generateLayout();
