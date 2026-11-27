// Albedo of building parts (sRGB hex) that only buildings uses. Shared colors and the facade range
// live in core/palette.ts (lighting-owned); these stay here so buildings can tune its own props
// without editing another module's file.
export const ROAD = {
  asphalt: 0x16181a,
  alley: 0x24262a,
  markWhite: 0x9a9c98,
  markYellow: 0x9a7a2a,
  pavement: 0x2c2e30,
  curb: 0x3c3e3e,
} as const;

export const STREET = {
  treeTrunk: 0x1a1612,
  stairTread: 0x343634,
  stairRiser: 0x262828,
} as const;

export const FACADE_TINT = {
  apartment: 0x6b6e6c,
  hillHouse: [0x5a4a40, 0x4e5450, 0x5c5850, 0x3f4a4c],
  sangga: [0x3a3430, 0x34383a, 0x40383a, 0x2e3436],
  warehouse: [0x3c4a50, 0x504a3e, 0x3a3f42],
} as const;

export const PROP = {
  roofPlant: 0x2e3236,
  craneSteel: 0x4a3a1c,
  craneWeight: 0x2a2c2e,
  helipad: 0x1c2022,
  tankBase: 0x1e2022,
  tanks: [0x2c6f7a, 0x2a5a8c, 0x3a7a6a, 0x8a8f8c, 0x2f6a8a],
  tankGrey: 0x8a8f8c,
  hillTanks: [0x1f8a96, 0x2a6ab0, 0x2a8a9a, 0x3a5aa0],
  sanggaMetal: 0x2a2d30,
  acUnit: 0x8a8e8e,
  greyMetal: 0x3a3e40,
  fireEscape: 0x24272a,
  awnings: [0x5a1a1a, 0x1a4a44, 0x5a3a12, 0x1a2a4a],
  canopy: 0x1a1c1e,
  chimney: 0x4a4c4a,
  chimneyBand: 0x6a1a1a,
  planters: [0x1c2a1c, 0x3a2a22],
  pole: 0x3a3a3a,
  outsideStair: 0x3a3c3c,
} as const;

/** Facade shader material split (ART_DIRECTION 4.3 #6). Glass albedo is linear. */
export const FACADE_DAY = {
  glassNight: [0.012, 0.016, 0.02],
  glassDay: [0.045, 0.055, 0.065],
  concreteGain: 0.7,
  metalGain: 0.25,
} as const;
