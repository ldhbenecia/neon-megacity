// Chunk LOD hierarchy: boot builds LOD1/LOD2 only, LOD0 is emitted per chunk near the camera in
// time-sliced jobs and released again when the camera leaves. Archetype geometry stays in
// archetypes.ts; this file only decides when and where it is emitted.
import type * as THREE from 'three';
import { GeoBuilder } from './builder';

/** Swallows writes: re-emitting one LOD level passes it for the others. */
export class NullBuilder extends GeoBuilder {
  override vertex(): number {
    return 0;
  }
  override tri(): void {}
  override geometry(): void {}
}

export type Level = 0 | 1 | 2;

/**
 * Level for a camera distance with hysteresis around each switch distance: moving out switches
 * at `d ≥ D`, moving back in only at `d < D × (1 − h)`. `distances[0]` is ignored (always 0).
 */
export function pickLevel(
  d: number,
  current: Level,
  distances: readonly [number, number, number],
  h: number,
): Level {
  let level: Level = d >= distances[2] ? 2 : d >= distances[1] ? 1 : 0;
  if (level < current) {
    const back = distances[current] * (1 - h);
    if (d >= back) level = current;
  }
  return level;
}

/** LOD0 may be released once the camera is this far past the LOD1 switch distance... */
export const LOD0_RELEASE_FACTOR = 1.5;
/** ...and only while more than this many chunks hold LOD0 (fast flights would rebuild them). */
export const LOD0_KEEP = 8;
/** CPU time per frame for LOD0 emission (ms); one chunk at a time, nearest first. */
export const LOD0_BUDGET_MS = 3;

export interface Lod0Job {
  /** Emits a slice; returns the geometry when done (null if the chunk has no LOD0). */
  step(deadline: number): THREE.BufferGeometry | null | undefined;
}

/**
 * A resumable LOD0 emission: `parts` are small closures (one per building, tree, stair…) that
 * write into `builder`; `step` runs them until `deadline` (performance.now()), then builds.
 */
export function lod0Job(builder: GeoBuilder, parts: readonly ((b: GeoBuilder) => void)[]): Lod0Job {
  let next = 0;
  return {
    step(deadline) {
      while (next < parts.length) {
        parts[next++]?.(builder);
        if (performance.now() >= deadline) return undefined;
      }
      return builder.build();
    },
  };
}
