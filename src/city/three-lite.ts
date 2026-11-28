// The city worker's whole three.js: the layout generator and the terrain geometry use only these.
// The source modules keep the worker from bundling three.core (vite.config.ts aliases 'three' here
// for the worker's src/city, src/terrain and src/core imports).
export { BufferAttribute, Float32BufferAttribute } from 'three/src/core/BufferAttribute.js';
export { BufferGeometry } from 'three/src/core/BufferGeometry.js';
export { CatmullRomCurve3 } from 'three/src/extras/curves/CatmullRomCurve3.js';
export { Color } from 'three/src/math/Color.js';
export { Vector3 } from 'three/src/math/Vector3.js';
