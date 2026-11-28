import { describe, expect, it } from 'vitest';
import { LAYOUT, terrainHeight } from '../src/city/layout';
import {
  ROAD_Y,
  SIDEWALK_H,
  TERRAIN_STEP,
  buildRoads,
  buildSidewalks,
} from '../src/buildings/roads';

function positions(g: {
  getAttribute(n: string): { array: ArrayLike<number> };
}): ArrayLike<number> {
  return g.getAttribute('position').array;
}

describe('roads and sidewalks follow the ground', () => {
  const roads = buildRoads(LAYOUT);
  const walks = buildSidewalks(LAYOUT);

  it('no road vertex sits under the terrain', () => {
    const p = positions(roads);
    let worst = Infinity;
    let raised = 0;
    for (let i = 0; i < p.length; i += 3) {
      const t = terrainHeight(p[i] as number, p[i + 2] as number);
      if (t > 0.5) raised++;
      worst = Math.min(worst, (p[i + 1] as number) - t);
    }
    expect(raised).toBeGreaterThan(0);
    expect(worst).toBeGreaterThanOrEqual(ROAD_Y - 1e-4);
  });

  it('sidewalk tops sit SIDEWALK_H above the terrain', () => {
    const p = positions(walks);
    let worst = Infinity;
    for (let i = 0; i < p.length; i += 3) {
      const y = p[i + 1] as number;
      const t = terrainHeight(p[i] as number, p[i + 2] as number);
      if (y - t > SIDEWALK_H / 2) worst = Math.min(worst, y - t);
    }
    expect(worst).toBeGreaterThanOrEqual(SIDEWALK_H - 1e-4);
  });

  it('roads on flat ground stay at ROAD_Y', () => {
    const p = positions(roads);
    let flat = 0;
    for (let i = 0; i < p.length; i += 3) {
      if (terrainHeight(p[i] as number, p[i + 2] as number) > 0) continue;
      const y = p[i + 1] as number;
      if (y < ROAD_Y + 0.02) {
        expect(y).toBeCloseTo(ROAD_Y, 5);
        flat++;
      }
    }
    expect(flat).toBeGreaterThan(1000);
  });

  // The road is drawn as straight TERRAIN_STEP pieces between ground samples; between them the ground can
  // bulge. Every foothill road's centre line, sampled each metre, stays within 5 cm of the ground.
  it('road pieces never dip under the ground between samples', () => {
    let checked = 0;
    let worst = Infinity;
    for (const r of LAYOUT.roads) {
      if (r.kind === 'stair' || r.district === 'hillside') continue;
      const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z);
      if (len < 0.5) continue;
      const at = (s: number): [number, number] => [
        r.a.x + ((r.b.x - r.a.x) * s) / len,
        r.a.z + ((r.b.z - r.a.z) * s) / len,
      ];
      const n = Math.max(1, Math.ceil(len / TERRAIN_STEP));
      for (let i = 0; i < n; i++) {
        const s0 = (len * i) / n;
        const s1 = (len * (i + 1)) / n;
        const y0 = terrainHeight(...at(s0)) + ROAD_Y;
        const y1 = terrainHeight(...at(s1)) + ROAD_Y;
        for (let s = s0; s <= s1; s += 1) {
          const t = terrainHeight(...at(s));
          if (t <= 0) continue;
          const y = y0 + ((y1 - y0) * (s - s0)) / (s1 - s0);
          worst = Math.min(worst, y - t);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(worst).toBeGreaterThan(-0.05);
  });
});
