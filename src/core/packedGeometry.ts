// BufferGeometry as transferable typed arrays: the city worker builds geometry and the main
// thread wraps the same arrays again (no copy, identical values).
import { BufferAttribute, BufferGeometry, type TypedArray } from 'three';

export interface PackedGeometry {
  attributes: Record<string, { array: Float32Array; itemSize: number }>;
  index: Uint16Array | Uint32Array | null;
}

export function packGeometry(g: BufferGeometry): PackedGeometry {
  const attributes: PackedGeometry['attributes'] = {};
  for (const [name, a] of Object.entries(g.attributes)) {
    if (!(a.array instanceof Float32Array)) throw new Error(`packGeometry: ${name} is not Float32`);
    attributes[name] = { array: a.array, itemSize: a.itemSize };
  }
  const idx: TypedArray | null = g.index?.array ?? null;
  if (idx && !(idx instanceof Uint16Array || idx instanceof Uint32Array)) {
    throw new Error('packGeometry: index is not Uint16 or Uint32');
  }
  return { attributes, index: idx };
}

/** Buffers to pass as the transfer list of postMessage. */
export function packedBuffers(p: PackedGeometry): ArrayBuffer[] {
  const out = Object.values(p.attributes).map((a) => a.array.buffer as ArrayBuffer);
  if (p.index) out.push(p.index.buffer as ArrayBuffer);
  return out;
}

export function unpackGeometry(p: PackedGeometry): BufferGeometry {
  const g = new BufferGeometry();
  for (const [name, a] of Object.entries(p.attributes)) {
    g.setAttribute(name, new BufferAttribute(a.array, a.itemSize));
  }
  if (p.index) g.setIndex(new BufferAttribute(p.index, 1));
  g.computeBoundingSphere();
  return g;
}
