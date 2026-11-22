// Assembles every infra part from the layout (pure and deterministic: no randomness needed).
import type { Layout } from '../city/layout';
import { buildBridge } from './bridges';
import type { InfraColors } from './colors';
import { buildHighways } from './highways';
import { createParts, type InfraParts } from './parts';
import { pillarInstances, pillarSpecs } from './pillars';

export function buildInfra(L: Layout, c: InfraColors): InfraParts {
  const parts = createParts();
  buildHighways(L, parts, c);
  for (const spec of pillarSpecs(L)) {
    const { column, beams } = pillarInstances(spec);
    parts.columns.push(column);
    parts.beams.push(...beams);
  }
  for (const b of L.bridges) buildBridge(b, parts, c);
  return parts;
}
