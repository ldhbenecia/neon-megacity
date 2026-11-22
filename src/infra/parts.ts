// Output containers shared by the highway and bridge builders (pure data, no GPU objects).
import { MeshData, type RGB, type V3 } from './mesh';

/** Vertical prism (pillar column / bridge pier). Local X = lateral, local Z = along the road. */
export interface ColumnInstance {
  x: number;
  z: number;
  /** Foot and top world y. */
  y0: number;
  y1: number;
  /** Size along local X (lateral) and local Z (along the road). */
  w: number;
  d: number;
  /** three.js rotation.y that maps local X onto the lateral direction. */
  rotY: number;
  /** Owner id (highway or bridge id), for tests and debugging. */
  owner: string;
}

/** Unit box scaled to `size`, rotated by rotY then rolled about its local Z. */
export interface BeamInstance {
  center: V3;
  size: V3;
  rotY: number;
  roll: number;
}

/** Small emissive marker (octahedron scaled to `size`). */
export interface PointInstance {
  p: V3;
  size: V3;
  rotY: number;
  color: RGB;
}

/** Everything infra draws, grouped by material (one draw call each). */
export interface InfraParts {
  /** Asphalt / concrete / dark underside (vertex colors). */
  concrete: MeshData;
  /** Painted steel: arch ribs, trusses, rails, lamp poles (vertex colors). */
  steel: MeshData;
  /** Lane paint, drawn with polygon offset above the deck. */
  markings: MeshData;
  /** Static emissive lines (HDR vertex colors). */
  glow: MeshData;
  /** Additive uplight washes (HDR vertex colors fading to black). */
  wash: MeshData;
  points: PointInstance[];
  columns: ColumnInstance[];
  beams: BeamInstance[];
}

export function createParts(): InfraParts {
  return {
    concrete: new MeshData(),
    steel: new MeshData(),
    markings: new MeshData(),
    glow: new MeshData(),
    wash: new MeshData(),
    points: [],
    columns: [],
    beams: [],
  };
}

/** rotation.y such that local +X maps onto the horizontal direction `lat`. */
export function rotYForLateral(lat: V3): number {
  return Math.atan2(-lat[2], lat[0]);
}
