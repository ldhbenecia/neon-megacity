import * as THREE from 'three';

// Shares the source attributes; disposing the source only drops GPU buffers it never uploaded.
export function toInstanced(g: THREE.BufferGeometry): THREE.InstancedBufferGeometry {
  const ig = new THREE.InstancedBufferGeometry();
  ig.setIndex(g.getIndex());
  for (const [name, attr] of Object.entries(g.attributes)) ig.setAttribute(name, attr);
  g.dispose();
  return ig;
}

export function setInstanceAttributes(
  g: THREE.InstancedBufferGeometry,
  count: number,
  attrs: Record<string, { size: number; data: Float32Array }>,
): THREE.InstancedBufferGeometry {
  for (const [name, a] of Object.entries(attrs)) {
    g.setAttribute(name, new THREE.InstancedBufferAttribute(a.data, a.size));
  }
  g.instanceCount = count;
  return g;
}

const tmp = new THREE.Color();
export function hdrColor(hex: number, mult: number): [number, number, number] {
  tmp.setHex(hex);
  return [tmp.r * mult, tmp.g * mult, tmp.b * mult];
}
