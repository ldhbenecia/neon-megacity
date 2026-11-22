// Assembles every infra part from the layout (pure and deterministic: no randomness needed).
import type { Layout } from '../city/layout';
import { buildBridge } from './bridges';
import type { InfraColors } from './colors';
import { buildHighways, hwPath } from './highways';
import { createParts, type InfraParts } from './parts';
import { pillarInstances, pillarSpecs } from './pillars';

export function buildInfra(L: Layout, c: InfraColors): InfraParts {
  const parts = createParts();
  // Curve sampling is shared by the deck builder and the pillar filters.
  const paths = L.highways.map((hw) => hwPath(hw));
  buildHighways(paths, parts, c);
  for (const spec of pillarSpecs(L, paths)) {
    const { column, beams } = pillarInstances(spec);
    parts.columns.push(column);
    parts.beams.push(...beams);
  }
  for (const b of L.bridges) buildBridge(b, parts, c, L.roads);
  return parts;
}
