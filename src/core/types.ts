// Shared types for the module contract. See docs/ARCHITECTURE.md.
import type * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type GUI from 'lil-gui';
import type { CITY, Layout } from '../city/layout';

/** Environment state. Each field has a single owner module (see ARCHITECTURE.md). */
export interface Env {
  /** 0..1, 0 = midnight, 0.5 = noon. Owned by lighting. */
  timeOfDay: number;
  /** When true (e.g. `?time=` was given), lighting must not advance `timeOfDay`. Set by main. */
  timeLocked: boolean;
  /** Unit vector from the ground toward the sun. Owned by lighting. */
  sunDirection: THREE.Vector3;
  /** sin(sun elevation) == sunDirection.y. Owned by lighting. */
  sunElevation: number;
  /** 0..1 smooth day blend; dayFactor + nightFactor = 1. Owned by lighting. */
  dayFactor: number;
  nightFactor: number;
  /** Owned by lighting. */
  horizonColor: THREE.Color;
  skyColor: THREE.Color;
  /** 0..1 rain intensity. Owned by atmosphere. */
  rain: number;
}

/** One vertical tier of a building; core towers set back as they rise. */
export interface BuildingTier {
  x: number;
  z: number;
  w: number;
  d: number;
  y0: number;
  y1: number;
}

export interface BuildingInfo {
  id: number;
  /** Highest point including spires/antennas. */
  top: number;
  /** Top of the last tier (roof surface). */
  roof: number;
  tiers: BuildingTier[];
}

/** Published by the buildings module for neon/atmosphere to consume. */
export interface BuildingsApi {
  group: THREE.Group;
  meshes: Record<string, THREE.Mesh>;
  materials: Record<string, THREE.Material>;
  /** Indexed by building id. */
  info: BuildingInfo[];
  maxHeight: number;
  sidewalkHeight: number;
  roadY: number;
}

export interface Ctx {
  THREE: typeof THREE;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  gui: GUI;
  CITY: typeof CITY;
  LAYOUT: Layout;
  env: Env;
  /** Set by buildings during its init; undefined before that. */
  buildings?: BuildingsApi;
  /** Default renderer.render; atmosphere may replace it with a composer render. */
  render: () => void;
  onResize: (fn: (w: number, h: number) => void) => void;
}

export interface CityModuleInstance {
  update?(dt: number, elapsed: number): void;
  dispose?(): void;
}

export interface CityModule {
  init(ctx: Ctx): CityModuleInstance;
}
