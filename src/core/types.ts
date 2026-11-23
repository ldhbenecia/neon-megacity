// Shared types for the module contract. See docs/ARCHITECTURE.md and docs/ART_DIRECTION.md 13.
// Wave-1 modules code against exactly these types; changing them needs a small `chore(types)` PR.
import type * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type GUI from 'lil-gui';
import type { CITY } from '../city/layout';
import type { BuildingFace, BuildingSpec, Layout } from '../city/types';

export type * from '../city/types';

/**
 * Render quality tier. 'low' (`?quality=low`) is for software GL (CI SwiftShader): DPR 0.5, no MSAA,
 * no shadows, one lazy 64 px PMREM bake, no post chain, rain, clouds or searchlights.
 */
export type Quality = 'high' | 'low';

/**
 * Environment state shared by all modules. Each field has exactly one owner that writes it;
 * everyone else only reads. Owners write during their own `update`, so in frame order
 * (lighting → terrain → buildings → infra → neon → atmosphere) later modules see this frame's value.
 */
export interface Env {
  /**
   * 0..1, 0 = midnight, 0.5 = noon. Owner: lighting. Initial value comes from `?time`.
   * Exception: while `timeLocked` is true, ux writes it from the timeline scrubber; lighting
   * does not advance it while locked, so the two never write in the same frame.
   */
  timeOfDay: number;
  /** When true (e.g. `?time=` was given), lighting must not advance `timeOfDay`. Owner: ux (set at boot). */
  timeLocked: boolean;
  /** Render quality tier from `?quality=` (default 'high'). Owner: ux (set at boot, never changes). */
  quality: Quality;
  /** Unit vector from the ground toward the sun. Owner: lighting. */
  sunDirection: THREE.Vector3;
  /** sin(sun elevation) == sunDirection.y. Owner: lighting. */
  sunElevation: number;
  /** 0..1 smooth day blend; dayFactor + nightFactor = 1. Owner: lighting. */
  dayFactor: number;
  nightFactor: number;
  /** Sky horizon / zenith colors (palette 3.1). Owner: lighting. */
  horizonColor: THREE.Color;
  skyColor: THREE.Color;
  /** Emissive brightness multiplier for signs: night 1.0, sunset 0.7, day 0.3 (palette). Owner: lighting. */
  neonGain: number;
  /** City-wide lit-window ratio 0..1 (night median 0.32); buildings multiplies per district. Owner: lighting. */
  windowLitRatio: number;
  /** 0..1 rain intensity. Owner: atmosphere. Initial value comes from `?rain`. */
  rain: number;
  /**
   * 0..1 rain intensity the user asked for (weather buttons; initial value from `?rain`).
   * Owner: ux. Atmosphere eases `rain` toward it.
   */
  rainTarget: number;
  /** 0..1 surface wetness (rises with rain, decays to 0.55). Owner: atmosphere. */
  wetness: number;
  /** Final fog color after rain / scattering adjustments. Owner: atmosphere (base value from palette). */
  fogColor: THREE.Color;
  /** FogExp2 density actually used this frame. Owner: atmosphere. */
  fogDensity: number;
  /** 0..1 boot "power on" ramp (loader fade-in). 1 once the city is live. Owner: ux. */
  powerOn: number;
  /** Building id picked by the user (click / fly-to), or null. Owner: ux; neon draws the highlight. */
  selectedBuilding: number | null;
}

/** Published by buildings during init, for neon / atmosphere / ux to consume. */
export interface BuildingsApi {
  /** Root of everything buildings adds to the scene (roads, sidewalks, buildings, props). */
  group: THREE.Group;
  /** Same objects as `ctx.LAYOUT.buildings`; index = id. Tiers, rotY, front side and tags live here. */
  specs: readonly BuildingSpec[];
  /**
   * Wall faces of every tier, index = building id. Identical to `buildingFaces(spec)` from the
   * layout, precomputed once. Neon places signs strictly inside one face:
   * `face.y0 + 2 ≤ y ≤ face.y1 - 2`, 1 m in from the face edges.
   */
  faces: readonly (readonly BuildingFace[])[];
  /** Highest world y of any building (spires included). */
  maxHeight: number;
  /** Road surface y and sidewalk top y (flat districts). */
  roadY: number;
  sidewalkHeight: number;
  /**
   * Shared materials others may reuse or read uniforms from, by name
   * (at least 'road' and 'sidewalk'; window materials expose `uLitRatio`).
   */
  materials: Readonly<Record<string, THREE.Material>>;
}

/** Published by infra during init. */
export interface InfraApi {
  /** Root of highways, ramps, pillars, sound walls and bridges. */
  group: THREE.Group;
  /**
   * Highway centerline curves by highway id (`highwayCurve(hw)` from the layout), y = deck surface.
   * Neon runs traffic along these with `curve.getPointAt(u)`.
   */
  curves: ReadonlyMap<string, THREE.CatmullRomCurve3>;
  /** Deck slab thickness (m); the underside is at deck y − thickness. */
  deckThickness: number;
  /** Highest deck surface at (x, z) or null; same as layout `deckHeightAt(ctx.LAYOUT, x, z)`. */
  deckHeightAt(x: number, z: number): number | null;
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
  /** Set by buildings during its init; undefined before that (and while buildings is a stub). */
  buildings?: BuildingsApi;
  /** Set by infra during its init; undefined before that. */
  infra?: InfraApi;
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
