// The city worker's whole three.js: the layout generator uses only these two classes. The source
// modules keep the worker from bundling three.core (vite.config.ts aliases 'three' here).
export { CatmullRomCurve3 } from 'three/src/extras/curves/CatmullRomCurve3.js';
export { Vector3 } from 'three/src/math/Vector3.js';
