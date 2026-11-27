// Layout-only data types (layout v2, see docs/ART_DIRECTION.md 2.6; v3 fields from docs/SEOUL.md 7.1).
// Re-exported from src/core/types.ts. Every field is produced by src/city/layout.ts;
// feature modules only read them.
//
// Conventions
// - 1 unit = 1 m, Y up, ground y = 0, north = -Z, east = +X.
// - `rotY` / `gridAngle` use the same convention as three.js `Object3D.rotation.y`, so
//   `mesh.rotation.y = spec.rotY` is correct. A local offset (lx, lz) maps to world as
//   x = cx + cos(r) * lx + sin(r) * lz,  z = cz - sin(r) * lx + cos(r) * lz  (see `toWorld`).
// - `w` is the extent along the local X axis, `d` along the local Z axis.

export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** v2 kinds plus the v3 Seoul kinds (docs/SEOUL.md 4.3); v2 layouts only produce the first seven. */
export type DistrictKind =
  | 'core'
  | 'midtown'
  | 'sangga'
  | 'hillside'
  | 'apartment'
  | 'industrial'
  | 'riverside'
  | 'megacore'
  | 'corridor'
  | 'oldtown'
  | 'palace'
  | 'brick'
  | 'nightlife'
  | 'showroom'
  | 'park';

export type RoadKind = 'arterial' | 'street' | 'alley' | 'stair';

export interface DistrictZone {
  /** e.g. 'core', 'sangga-n', 'hill-w'. Several zones may share a kind. */
  id: string;
  kind: DistrictKind;
  /** Fictional display name (Korean). */
  name: string;
  /**
   * Zone outline in world XZ. Zones partition the map (first match wins in `zoneAt`);
   * north/south zones are already clipped by the riverside band, so the polygon is exact.
   * Winding is not significant.
   */
  polygon: Vec2[];
  /** Rotation of this zone's road grid (radians, rotY convention). 0 for riverside. */
  gridAngle: number;
  /** Grid anchor: a road intersection in world space. */
  origin: Vec2;
  /** Road pitch along the local X (u) and Z (v) axes, center to center (m). */
  roadPitch: number;
  roadPitchV: number;
  /** Width of the zone's grid roads (m) and their kind. */
  roadWidth: number;
  roadKind: RoadKind;
  /** Name shown in English UI: romanized for real places in v3 (e.g. 'YEOUIDO'). */
  nameEn: string;
  /** Height band (m): most buildings in [min, max], `tallShare` of them up to `tallMax`. */
  heights: ZoneHeights;
  /** Built-area ratio target (0..1). */
  coverage: number;
  /** Multiplier on env.windowLitRatio for this zone. */
  litScale: number;
}

export interface ZoneHeights {
  min: number;
  max: number;
  tallShare: number;
  tallMax: number;
}

export interface River {
  /** Control points (SEOUL.md 3.1), x strictly increasing; the curve through them is `samples`. */
  centerline: Vec2[];
  /** Water surface y. */
  waterY: number;
  /** Top of the embankment (= ground). */
  bankY: number;
  parkY: number;
  /** Riverside district band outside each bank (m). */
  bandWidth: number;
  /** Bank-to-bank width at each control point (linear in x between them). */
  widths: number[];
  /** Park strip width at each control point. */
  parkWidths: number[];
  /** Centerline resampled about every 10 m; the distance queries use it. */
  samples: Vec2[];
  /** Side channels that split land from the main channel (샛강). */
  channels: SideChannel[];
}

export interface SideChannel {
  id: string;
  name: string;
  centerline: Vec2[];
  /** Water width (m); no parks. */
  width: number;
}

export type IslandId = 'yeouido' | 'bamseom' | 'nodeul' | 'seorae' | 'seonyu';
export type IslandKind = 'land' | 'marsh' | 'culture' | 'park';

export interface Island {
  id: IslandId;
  name: string;
  kind: IslandKind;
  polygon: Vec2[];
  /** Ground height of the island top. */
  y: number;
}

export interface Mountain {
  id: string;
  name: string;
  peak: Vec2;
  /** Peak spine height (real elevation × 0.375, SEOUL.md 5.1). */
  height: number;
  /**
   * Reach (m) of this peak's share of its range from the peak; the radii of a range's peaks
   * together cover all of its ground. Range boxes: MOUNTAIN_RANGES.
   */
  radius: number;
}

export interface NamedRoad {
  id: string;
  /** Real road name (Korean), e.g. '테헤란로'. */
  name: string;
  points: Vec2[];
  width: number;
}

export interface SkyLane {
  id: string;
  /** xz control points; neon samples a centripetal Catmull-Rom through them. */
  points: Vec2[];
  /**
   * The flown path sampled about every 10 m (centripetal Catmull-Rom through `points`; a closed
   * lane repeats its first sample at the end). Clearance is measured on these. Always set by
   * the generator; optional so hand-built lanes (tests) can omit it.
   */
  samples?: Vec2[];
  closed: boolean;
  /**
   * Absolute cruise height band (m, world y). The lower bound clears every building within
   * SKY_LANE_CLEAR m of the lane by SKY_LANE_MARGIN (spires included).
   */
  altitude: [number, number];
}

export type LandmarkId =
  'namsan-mast' | 'jamsil-blade' | 'yongsan-apex' | 'yeouido-gold' | 'palace';

export interface Landmark {
  id: LandmarkId;
  /** Building that carries the landmark, or null for non-building landmarks (mast, palace). */
  buildingId: number | null;
  x: number;
  z: number;
  h: number;
}

/** v2 kinds plus the v3 kinds (SEOUL.md 3.3). Renderers must draw unknown kinds as a plain girder. */
export type BridgeKind =
  'arch' | 'truss' | 'doubleDeck' | 'deckArch' | 'tiedArch' | 'girder' | 'cableStayed';

export type BridgeMotif =
  | 'cyanRib'
  | 'whiteArch'
  | 'redArch'
  | 'textRail'
  | 'railTruss'
  | 'fountain'
  | 'orangeChord'
  | 'subwayDeck'
  | 'redBand'
  | 'ringPylon';

export interface Bridge {
  id: string;
  /** Display name (Korean); v3 uses the real bridge name. */
  name: string;
  kind: BridgeKind;
  /** Abutments on the north (a) and south (b) bank edges; the span a→b is perpendicular to the river. */
  a: Vec2;
  b: Vec2;
  /**
   * Where the approach ramps meet the ground (y = 0): BRIDGE_RAMP_NORTH (100 m) beyond the north bank,
   * past 강변북로, and at least BRIDGE_RAMP_SOUTH_MIN (180 m) beyond the south bank, past 올림픽대로. The deck
   * descends linearly from `deckY` at the abutment to 0 at the landing (see `bridgeDeckY`).
   */
  landA: Vec2;
  landB: Vec2;
  deckY: number;
  /** Lower deck for 'doubleDeck', otherwise undefined. */
  lowerDeckY?: number;
  width: number;
  lanes: number;
  /** Arch crown height for 'arch', truss height for 'truss' (m above the deck). */
  structureH: number;
  /** Spans between the abutments (piers = spans - 1). 'arch' is always 2 (v2 only); 'truss' ≥ 3, others ≥ 2. */
  spans: number;
  rail: boolean;
  /** Island the span crosses. */
  island?: IslandId;
  /** Lighting motif: infra draws the static part, neon the animated part. */
  motif: BridgeMotif;
}

export type HighwayKind = 'elevated' | 'atGrade' | 'ramp';

export interface Highway {
  id: string;
  /** Real road name (Korean), e.g. '강변북로'. */
  name: string;
  kind: HighwayKind;
  /** Centripetal Catmull-Rom control points (y = deck surface). Use `highwayCurve(hw)`. */
  points: Vec3[];
  closed: boolean;
  width: number;
  lanes: number;
  /** 0 = no pillars. */
  pillarSpacing: number;
  /** Pillar foot positions; `y` is the deck surface height above the pillar. */
  pillars: Vec3[];
  /** Half width of the no-build corridor = (width + 6) / 2. */
  corridorHalf: number;
}

export interface RidgePeak {
  /** Bearing from the map center, radians (rotY convention). */
  angle: number;
  height: number;
  /** Angular half width (radians). */
  width: number;
}

export interface Ridge {
  id: 'ridge-near' | 'ridge-mid' | 'ridge-far';
  radius: number;
  peakNorth: number;
  peakSouth: number;
  segments: number;
  seed: number;
  /** Fixed fog mix toward env.horizonColor (0..1). */
  fog: number;
  /** Bottom of the vertical strip. */
  baseY: number;
  /** Named peaks stamped onto the profile (v3); empty in v2. */
  peaks: RidgePeak[];
}

export interface Road {
  id: number;
  kind: RoadKind;
  /** Segment end points (center line). Roads are straight segments in any direction. */
  a: Vec2;
  b: Vec2;
  width: number;
  district: DistrictKind;
  zoneId: string;
}

export interface Block {
  id: number;
  zoneId: string;
  district: DistrictKind;
  /**
   * Rectangle covering the block's lots (built area), rotated by `rotY`. Sidewalks and roads are
   * outside it. Never overlaps the river channel or a highway corridor; a riverside pavilion is a
   * one-lot block of its own.
   */
  x: number;
  z: number;
  w: number;
  d: number;
  rotY: number;
  buildingIds: number[];
}

export type Archetype =
  | 'setbackTower'
  | 'cylinderTower'
  | 'bracedTower'
  | 'cantileverTower'
  | 'twinTower'
  | 'officeSlab'
  | 'sangga'
  | 'apartmentSlab'
  | 'hillHouse'
  | 'warehouse'
  | 'pavilion'
  | 'taperTower'
  | 'mediaSlab'
  | 'lowOffice'
  | 'hanokRow'
  | 'palaceHall'
  | 'brickWarehouse'
  | 'showroomBox';

export type TierShape = 'box' | 'cylinder' | 'chamfer';

/** Local face of a building: +X, -X, +Z, -Z in the building's rotated frame. */
export type Side = 'px' | 'nx' | 'pz' | 'nz';

/** One vertical tier. Cylinders use w = d = diameter. */
export interface Tier {
  /** World-space center. Shares the building's `rotY`. */
  x: number;
  z: number;
  w: number;
  d: number;
  /** World y (baseY included). Tiers stack: tiers[i].y0 === tiers[i - 1].y1. */
  y0: number;
  y1: number;
  shape: TierShape;
  /** Chamfer size (m) for 'chamfer', else 0. */
  chamfer: number;
}

export interface Cantilever {
  /** Body face the mass sticks out of. */
  side: Side;
  /** Protrusion beyond the body face (m); always stays inside the podium footprint. */
  out: number;
  /** Width along the face (m). */
  width: number;
  y0: number;
  y1: number;
}

export interface Skybridge {
  y0: number;
  y1: number;
  /** Width across the gap (m). */
  width: number;
}

export interface BuildingSpec {
  id: number;
  /** Footprint center (world) and size in the rotated frame. Every part of the building stays inside. */
  x: number;
  z: number;
  w: number;
  d: number;
  /** Roof height above baseY (top of the last tier, spire excluded). */
  h: number;
  rotY: number;
  /** Lowest terrain height under the footprint; the building sits here (retaining wall below on slopes). */
  baseY: number;
  district: DistrictKind;
  zoneId: string;
  blockId: number;
  archetype: Archetype;
  /** Typical floor height and ground floor height (m). */
  floorH: number;
  groundFloorH: number;
  floors: number;
  /** Primary stack, bottom to top. */
  tiers: Tier[];
  /** Second stack for 'twinTower' (same rules as `tiers`). */
  twin?: Tier[];
  skybridge?: Skybridge;
  cantilever?: Cantilever;
  /** Spire / antenna height above the roof (m), 0 = none. */
  spireH: number;
  /** Local side that faces the nearest road (shop front, blade signs). */
  front: Side;
  seed: number;
  tags: {
    storefront: boolean;
    cross?: boolean;
    dong?: number;
    complex?: string;
    corp?: string;
    name: string;
    /** Wall side covered by a full-height media screen (v3 'corridor'). */
    mediaFace?: Side;
    landmark?: LandmarkId;
  };
}

/** A wall face of one tier, for sign placement (see `buildingFaces`). */
export interface BuildingFace {
  building: number;
  /** Index into `tiers` (stack 0) or `twin` (stack 1). */
  tier: number;
  stack: 0 | 1;
  side: Side;
  /** World-space center of the face (mid height, on the wall surface). */
  center: Vec3;
  /** Outward unit normal (horizontal). */
  normal: Vec2;
  /** Unit vector along the face width, = normal rotated 90° (right when looking at the wall). */
  tangent: Vec2;
  /** Usable flat width (m). Cylinder faces report the chord a flat sign can use. */
  width: number;
  y0: number;
  y1: number;
  /** True when this side is the building's street front. */
  street: boolean;
  shape: TierShape;
}

export type SlotKind =
  'pojangmacha' | 'signPole' | 'tree' | 'streetLight' | 'busStop' | 'stairLamp';

export interface StreetSlot {
  kind: SlotKind;
  x: number;
  z: number;
  /** Surface height at (x, z): ground, park (-2) or terrain. */
  y: number;
  rotY: number;
  seed: number;
}

export interface Layout {
  seed: number;
  /** Play area size on X and Z (v2: 2400 × 2400). The map spans [-extentX/2, extentX/2] etc. */
  extentX: number;
  extentZ: number;
  districts: DistrictZone[];
  river: River;
  bridges: Bridge[];
  highways: Highway[];
  ridges: Ridge[];
  roads: Road[];
  blocks: Block[];
  /** Index = id. */
  buildings: BuildingSpec[];
  slots: StreetSlot[];
  /** v3 additions; empty in v2. */
  islands: Island[];
  mountains: Mountain[];
  namedRoads: NamedRoad[];
  landmarks: Landmark[];
  /** Flying-traffic routes (neon reads only these). */
  skyLanes: SkyLane[];
}
