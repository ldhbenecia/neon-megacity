// Color palette and exposure constants (ART_DIRECTION 3). Created in PR0, owned by lighting.
// Every module imports colors from here instead of hard-coding hex values.
// Colors are sRGB hex; feed them to three with `color.setHex(hex)` (ColorManagement converts),
// or `color.setRGB(r, g, b, SRGBColorSpace)` for the interpolated tuples from `paletteAt`.

/** sRGB color as 0..1 floats. */
export type RGB = readonly [number, number, number];

export interface PaletteKey {
  skyColor: number;
  /** Horizon on the sun side. */
  horizonColor: number;
  /** Horizon away from the sun (sunset: teal on the far side). */
  horizonAntiSun: number;
  /** City light dome near the horizon (0..12°) and its strength. */
  cityGlow: number;
  cityGlowIntensity: number;
  fogColor: number;
  /** Fog tint toward the sun (sunset scattering). */
  fogSunColor: number;
  /** FogExp2 density before rain. */
  fogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** Key directional light (moon at night, sun otherwise). */
  sunColor: number;
  sunIntensity: number;
  /** 1 = directional shadows on. Interpolated; lighting casts shadows when > 0.5. */
  shadows: number;
  /** Star visibility 0..1. */
  stars: number;
  toneMappingExposure: number;
  neonGain: number;
  /** City-wide lit window ratio (median); buildings scales per district (WINDOW_LIT). */
  windowLitRatio: number;
  envMapIntensity: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
}

/** 3.1 Night (22:00–04:00). */
export const NIGHT: PaletteKey = {
  skyColor: 0x010407,
  horizonColor: 0x0a2a2c,
  horizonAntiSun: 0x0a2a2c,
  cityGlow: 0x14463f,
  cityGlowIntensity: 0.6,
  fogColor: 0x0b2f31,
  fogSunColor: 0x0b2f31,
  fogDensity: 0.00105,
  hemiSky: 0x0d2a2e,
  hemiGround: 0x0a0706,
  hemiIntensity: 0.35,
  sunColor: 0x8fb5c8,
  sunIntensity: 0.12,
  shadows: 0,
  stars: 1,
  toneMappingExposure: 1.0,
  neonGain: 1.0,
  windowLitRatio: 0.32,
  envMapIntensity: 0.6,
  bloomStrength: 0.7,
  bloomRadius: 0.42,
  bloomThreshold: 0.85,
};

/** 3.1 Sunset (18:15–19:10). */
export const SUNSET: PaletteKey = {
  skyColor: 0x1a2444,
  horizonColor: 0xff8a4a,
  horizonAntiSun: 0x2e5560,
  cityGlow: 0x4a3a40,
  cityGlowIntensity: 0.3,
  fogColor: 0x4b4650,
  fogSunColor: 0xff9a5c,
  fogDensity: 0.00085,
  hemiSky: 0x5a5070,
  hemiGround: 0x2a1a14,
  hemiIntensity: 0.6,
  sunColor: 0xff9a58,
  sunIntensity: 1.4,
  shadows: 1,
  stars: 0.2,
  toneMappingExposure: 0.92,
  neonGain: 0.7,
  windowLitRatio: 0.32,
  envMapIntensity: 0.8,
  bloomStrength: 0.45,
  bloomRadius: 0.4,
  bloomThreshold: 0.9,
};

/** 3.1 Day (10:00–15:00). */
export const DAY: PaletteKey = {
  skyColor: 0x6c8e96,
  horizonColor: 0xb7c6c1,
  horizonAntiSun: 0xb7c6c1,
  cityGlow: 0xb7c6c1,
  cityGlowIntensity: 0,
  fogColor: 0x9cb0aa,
  fogSunColor: 0x9cb0aa,
  fogDensity: 0.00055,
  hemiSky: 0xa9c4c6,
  hemiGround: 0x4a4238,
  hemiIntensity: 0.9,
  sunColor: 0xfff0d8,
  sunIntensity: 2.6,
  shadows: 1,
  stars: 0,
  toneMappingExposure: 0.78,
  neonGain: 0.3,
  windowLitRatio: 0.02,
  envMapIntensity: 1.0,
  bloomStrength: 0.15,
  bloomRadius: 0.3,
  bloomThreshold: 1.0,
};

/**
 * Dawn (06:00). Not tabulated in 3.1; a cooler, dimmer sunset: blue-grey sky, pale salmon
 * horizon, dawn window ratio ~0.11 (3.4 dawn row). Lighting may tune it.
 */
export const DAWN: PaletteKey = {
  skyColor: 0x14243a,
  horizonColor: 0xc98a6a,
  horizonAntiSun: 0x24474f,
  cityGlow: 0x2a3e40,
  cityGlowIntensity: 0.35,
  fogColor: 0x3a4a50,
  fogSunColor: 0xd8936a,
  fogDensity: 0.0009,
  hemiSky: 0x3e5262,
  hemiGround: 0x1a1612,
  hemiIntensity: 0.5,
  sunColor: 0xffb47a,
  sunIntensity: 0.9,
  shadows: 1,
  stars: 0.3,
  toneMappingExposure: 0.95,
  neonGain: 0.75,
  windowLitRatio: 0.11,
  envMapIntensity: 0.7,
  bloomStrength: 0.5,
  bloomRadius: 0.4,
  bloomThreshold: 0.9,
};

/**
 * Keyframes over timeOfDay (0 = midnight). Plateaus hold the 3.1 ranges; between keys
 * `paletteAt` blends with smoothstep. Sorted, first at 0 and last at 1 (same palette → seamless wrap).
 */
export const PALETTE_KEYS: readonly { t: number; key: PaletteKey }[] = [
  { t: 0, key: NIGHT },
  { t: 4 / 24, key: NIGHT }, // 04:00
  { t: 0.25, key: DAWN }, // 06:00
  { t: 10 / 24, key: DAY }, // 10:00
  { t: 15 / 24, key: DAY }, // 15:00
  { t: 0.76, key: SUNSET }, // 18:15
  { t: 0.8, key: SUNSET }, // 19:10
  { t: 22 / 24, key: NIGHT }, // 22:00
  { t: 1, key: NIGHT },
];

const COLOR_FIELDS = [
  'skyColor',
  'horizonColor',
  'horizonAntiSun',
  'cityGlow',
  'fogColor',
  'fogSunColor',
  'hemiSky',
  'hemiGround',
  'sunColor',
] as const satisfies readonly (keyof PaletteKey)[];

const NUMBER_FIELDS = [
  'cityGlowIntensity',
  'fogDensity',
  'hemiIntensity',
  'sunIntensity',
  'shadows',
  'stars',
  'toneMappingExposure',
  'neonGain',
  'windowLitRatio',
  'envMapIntensity',
  'bloomStrength',
  'bloomRadius',
  'bloomThreshold',
] as const satisfies readonly (keyof PaletteKey)[];

type ColorField = (typeof COLOR_FIELDS)[number];
type NumberField = (typeof NUMBER_FIELDS)[number];

/** Interpolated palette: colors as sRGB 0..1 tuples, numbers as numbers. */
export type PaletteSample = { [K in ColorField]: RGB } & { [K in NumberField]: number };

export function hexToRgb(hex: number): RGB {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

const smooth = (x: number): number => x * x * (3 - 2 * x);

/** Pure palette lookup for a time of day (wraps outside 0..1). */
export function paletteAt(timeOfDay: number): PaletteSample {
  const t = ((timeOfDay % 1) + 1) % 1;
  let i = 0;
  while (i < PALETTE_KEYS.length - 2 && t >= (PALETTE_KEYS[i + 1] as { t: number }).t) i++;
  const a = PALETTE_KEYS[i] as { t: number; key: PaletteKey };
  const b = PALETTE_KEYS[i + 1] as { t: number; key: PaletteKey };
  const w = b.t > a.t ? smooth(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)))) : 0;
  const out = {} as Record<string, RGB | number>;
  for (const f of COLOR_FIELDS) {
    const ca = hexToRgb(a.key[f]);
    const cb = hexToRgb(b.key[f]);
    out[f] = [
      ca[0] + (cb[0] - ca[0]) * w,
      ca[1] + (cb[1] - ca[1]) * w,
      ca[2] + (cb[2] - ca[2]) * w,
    ];
  }
  for (const f of NUMBER_FIELDS) out[f] = a.key[f] + (b.key[f] - a.key[f]) * w;
  return out as PaletteSample;
}

/** 3.2 Neon / emissive colors with their night HDR multiplier range [min, max]. */
export const NEON = {
  neonRed: { hex: 0xff2a3a, hdr: [5, 7] },
  neonOrange: { hex: 0xff7a1a, hdr: [4, 6] },
  neonAmber: { hex: 0xffb000, hdr: [3, 5] },
  neonCyan: { hex: 0x19f2e6, hdr: [4, 6] },
  neonTeal: { hex: 0x2bffb0, hdr: [3, 5] },
  neonMagenta: { hex: 0xff2fa8, hdr: [4, 6] },
  neonWhite: { hex: 0xe8fbff, hdr: [3, 4] },
  windowWarm: { hex: 0xffc98a, hdr: [0.7, 1.1] },
  windowAmber: { hex: 0xff9f55, hdr: [0.6, 0.9] },
  windowCool: { hex: 0xcfe6ff, hdr: [0.6, 0.9] },
  windowTV: { hex: 0x6fa8ff, hdr: [0.5, 0.8] },
} as const satisfies Record<string, { hex: number; hdr: readonly [number, number] }>;

export type NeonName = keyof typeof NEON;

/** Window color mix (share of lit windows). */
export const WINDOW_MIX = {
  windowWarm: 0.7,
  windowAmber: 0.15,
  windowCool: 0.12,
  windowTV: 0.03,
} as const;

/** Night emissive share target by hue family (principle 2). */
export const NEON_SHARE = { redOrange: 0.35, cyanTeal: 0.3, warmWhite: 0.25, magentaMax: 0.1 };

/** Big screens never drop below this neonGain. */
export const SCREEN_MIN_GAIN = 0.6;

/**
 * 3.4 Lit window ratio ranges per district and time band, [min, max].
 * buildings derives its per-district factor from these, relative to `env.windowLitRatio`.
 */
export const WINDOW_LIT = {
  night: {
    core: [0.15, 0.25],
    midtown: [0.2, 0.3],
    sangga: [0.3, 0.4],
    apartment: [0.35, 0.5],
    hillside: [0.3, 0.45],
  },
  dawn: {
    core: [0.08, 0.12],
    midtown: [0.08, 0.12],
    sangga: [0.1, 0.1],
    apartment: [0.1, 0.15],
    hillside: [0.1, 0.15],
  },
  sunset: {
    core: [0.3, 0.4],
    midtown: [0.25, 0.35],
    sangga: [0.3, 0.3],
    apartment: [0.2, 0.3],
    hillside: [0.15, 0.25],
  },
  day: {
    core: [0, 0.03],
    midtown: [0, 0.03],
    sangga: [0.05, 0.05],
    apartment: [0, 0.02],
    hillside: [0, 0.02],
  },
} as const;

/** 2.4 Far ridge night colors. */
export const RIDGE_COLORS = {
  'ridge-near': 0x06191b,
  'ridge-mid': 0x0a2628,
  'ridge-far': 0x10353a,
} as const;

/** Fixed material / prop colors named in ART_DIRECTION (4, 6, 7). */
export const MATERIAL = {
  /** Facade albedo range (4.3 #6). */
  facadeDark: 0x15191c,
  facadeLight: 0x2c3034,
  bracing: 0x1a1e22,
  retainingWall: 0x2a2c2c,
  deckUnderside: 0x050708,
  tree: 0x0d1a14,
  dongNumber: 0xd8dde0,
  streetLightCore: 0xffd9a0,
  streetLightSodium: 0xffb050,
  headlight: 0xfff4e0,
  taillight: 0xff2030,
  cloudLow: 0x163a38,
  cloudLowLit: 0x2a3a36,
  searchlightWhite: 0xe8fbff,
  searchlightCyan: 0x19f2e6,
  bootBackground: 0x020a0b,
} as const;
