// Pure atmosphere logic (no three objects, no side effects). Unit tested in tests/atmosphere.test.ts.
// Numbers come from ART_DIRECTION 3.3, 7 and 11.
import { allTiers, buildingTop } from '../city/queries';
import type { BuildingSpec, Tier } from '../city/types';
import { DAWN, DAY, NIGHT, PALETTE_KEYS, SUNSET, type PaletteKey, type RGB } from '../core/palette';

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (x: number): number => x * x * (3 - 2 * x);
const smoothstep = (a: number, b: number, x: number): number => smooth(clamp01((x - a) / (b - a)));

/** Cloud deck heights (7.3); rain and searchlights key off the low deck. */
export const CLOUD_LAYERS = { lowY: 650, highY: 1400 } as const;

/**
 * Wrap periods (s) for shader time uniforms, so float32 precision never degrades over long
 * sessions. Chosen so the wrap is invisible: rain and lens drops are statistically identical
 * after a jump; cloud drift rates × 1e5 s are whole texture tiles, so the wrap is seamless.
 */
export const TIME_WRAP = { rain: 1000, lens: 1000, stars: 1000, clouds: 100000 } as const;

export function wrapTime(t: number, period: number): number {
  return ((t % period) + period) % period;
}

// ---------------------------------------------------------------- fog (7.1)

export const FOG = {
  /** density × (1 + 0.5 × rain). */
  rainDensityGain: 0.5,
  /** Rain scatters city light: fog color × (1 + 0.12 × rain), hue kept (no grey). */
  rainBrighten: 0.12,
} as const;

/** Fog color multiplier for a rain value (also applied to the sun-side fog color). */
export function fogBrightness(rain: number): number {
  return 1 + FOG.rainBrighten * clamp01(rain);
}

export interface FogState {
  density: number;
  /** sRGB 0..1. */
  color: RGB;
}

/** Final fog for this frame from the palette base, rain and the GUI multiplier. */
export function computeFog(
  base: { fogColor: RGB; fogDensity: number },
  rain: number,
  userScale = 1,
): FogState {
  const k = fogBrightness(rain);
  const [cr, cg, cb] = base.fogColor;
  return {
    density: base.fogDensity * (1 + FOG.rainDensityGain * clamp01(rain)) * Math.max(0, userScale),
    color: [Math.min(1, cr * k), Math.min(1, cg * k), Math.min(1, cb * k)],
  };
}

/**
 * Sun-side scattering strength 0..1: only while the sun is near or above the horizon
 * (fades out 6° below it). The palette makes fogSunColor equal fogColor at day and night,
 * so the lobe is only visible around sunset and dawn.
 */
export function sunScatterStrength(sunElevation: number): number {
  return smoothstep(-0.1, 0.03, sunElevation);
}

// ---------------------------------------------------------------- rain and wetness (7.2)

export const WETNESS = {
  dry: 0.55,
  wet: 1,
  /** Seconds to go from dry to wet while it rains. */
  riseSeconds: 30,
  /** Seconds to go from wet back to dry after the rain stops. */
  fallSeconds: 120,
  /** Rain intensity that counts as raining. */
  rainThreshold: 0.05,
} as const;

export function isRaining(rain: number): boolean {
  return rain >= WETNESS.rainThreshold;
}

/** Steady-state wetness for a rain value (used at boot so screenshots are deterministic). */
export function wetnessTarget(rain: number): number {
  return isRaining(rain) ? WETNESS.wet : WETNESS.dry;
}

/** Advance wetness by dt seconds: rises to 1 over 30 s while raining, decays to 0.55 over 120 s. */
export function stepWetness(wetness: number, rain: number, dt: number): number {
  const span = WETNESS.wet - WETNESS.dry;
  if (isRaining(rain)) return Math.min(WETNESS.wet, wetness + (span / WETNESS.riseSeconds) * dt);
  if (wetness <= WETNESS.dry) return wetness;
  return Math.max(WETNESS.dry, wetness - (span / WETNESS.fallSeconds) * dt);
}

export const RAIN = {
  /** Streak pool size (tier 2 halves it). */
  maxDrops: 12000,
  /** Camera-following box edge (m). */
  box: 120,
  lengthMin: 0.6,
  lengthMax: 1.2,
  speedMin: 18,
  speedMax: 24,
  /** Wind slant from vertical (degrees) at rain 0 and 1. */
  slantMinDeg: 4,
  slantMaxDeg: 8,
  alphaMin: 0.12,
  alphaMax: 0.25,
  /** Share of streaks tinted by neon colors. */
  neonShare: 0.1,
  /** Camera altitude band (m) over which rain and lens drops fade out (cloud base is 650 m). */
  fadeAltitude: [CLOUD_LAYERS.lowY - 170, CLOUD_LAYERS.lowY + 110],
} as const;

/** Number of streaks drawn for a rain intensity. 0 when not raining. */
export function rainDropCount(rain: number, maxDrops: number = RAIN.maxDrops): number {
  if (!isRaining(rain)) return 0;
  return Math.round(maxDrops * (0.25 + 0.75 * clamp01(rain)));
}

export function rainAlpha(rain: number): number {
  return RAIN.alphaMin + (RAIN.alphaMax - RAIN.alphaMin) * clamp01(rain);
}

export function rainSlantRadians(rain: number): number {
  return (
    ((RAIN.slantMinDeg + (RAIN.slantMaxDeg - RAIN.slantMinDeg) * clamp01(rain)) * Math.PI) / 180
  );
}

/** 1 below the cloud deck, 0 above it (rain and lens drops only happen under the clouds). */
export function rainAltitudeFade(cameraY: number): number {
  return 1 - smoothstep(RAIN.fadeAltitude[0], RAIN.fadeAltitude[1], cameraY);
}

// ---------------------------------------------------------------- searchlights (7.4)

/** Searchlight level per palette key: night 1, sunset / dawn 0.3, day off. */
const SEARCHLIGHT_LEVEL = new Map<PaletteKey, number>([
  [NIGHT, 1],
  [SUNSET, 0.3],
  [DAWN, 0.3],
  [DAY, 0],
]);

/** Searchlight level for a time of day, blended between palette keys like `paletteAt`. */
export function searchlightLevelAt(timeOfDay: number): number {
  const t = ((timeOfDay % 1) + 1) % 1;
  let i = 0;
  while (i < PALETTE_KEYS.length - 2 && t >= (PALETTE_KEYS[i + 1] as { t: number }).t) i++;
  const a = PALETTE_KEYS[i] as { t: number; key: PaletteKey };
  const b = PALETTE_KEYS[i + 1] as { t: number; key: PaletteKey };
  const w = b.t > a.t ? smooth(clamp01((t - a.t) / (b.t - a.t))) : 0;
  const la = SEARCHLIGHT_LEVEL.get(a.key) ?? 0;
  const lb = SEARCHLIGHT_LEVEL.get(b.key) ?? 0;
  return la + (lb - la) * w;
}

export interface BeamParams {
  /** Azimuth (rad) of the vertical plane the beam swings in. */
  azimuth: number;
  /** Swing period (s), 18..30. */
  period: number;
  phase: number;
  /** Swing amplitude from vertical (rad), ±25°. */
  amplitude: number;
  /** Constant lean from vertical (rad) so beams do not all meet at the zenith. */
  lean: number;
}

export interface Mount {
  x: number;
  y: number;
  z: number;
}

/** Height (m) of the lamp above the roof it stands on. */
const MOUNT_LIFT = 4;

/**
 * Searchlight mounts: the `count` tallest buildings (spires and twin stacks included, via
 * `buildingTop`), each lamp on the roof center of its highest tier (setback / twin aware).
 */
export function searchlightMounts(specs: readonly BuildingSpec[], count = 2): Mount[] {
  return [...specs]
    .sort((a, b) => buildingTop(b) - buildingTop(a))
    .slice(0, count)
    .flatMap((b) => {
      let top: Tier | null = null;
      for (const t of allTiers(b)) if (!top || t.y1 > top.y1) top = t;
      return top ? [{ x: top.x, y: top.y1 + MOUNT_LIFT, z: top.z }] : [];
    });
}

/** Unit direction of a searchlight beam at time t (s). Writes into `out` and returns it. */
export function searchlightDirection(
  t: number,
  beam: BeamParams,
  out: [number, number, number] = [0, 1, 0],
): [number, number, number] {
  const swing = beam.lean + beam.amplitude * Math.sin((2 * Math.PI * t) / beam.period + beam.phase);
  // The swing plane itself drifts slowly so the sweep is not a perfect pendulum.
  const az =
    beam.azimuth + 0.35 * Math.sin((2 * Math.PI * t) / (beam.period * 2.7) + beam.phase * 1.3);
  const s = Math.sin(swing);
  out[0] = s * Math.cos(az);
  out[1] = Math.cos(swing);
  out[2] = s * Math.sin(az);
  return out;
}

/**
 * Beam length (m) from `originY` along `dirY` until it reaches the cloud base, capped at `maxLength`.
 */
export function beamLength(
  originY: number,
  dirY: number,
  cloudY: number,
  maxLength: number,
): number {
  if (dirY <= 1e-3 || originY >= cloudY) return maxLength;
  return Math.min(maxLength, (cloudY - originY) / dirY);
}

// ---------------------------------------------------------------- post and quality (3.3, 11)

/** Lens pass constants (3.3). */
export const LENS = { aberration: 0.0012, vignette: 0.38, grain: 0.025 } as const;

/** MSAA samples for the HDR scene target: pixel ratio already smooths edges at high DPR. */
export function msaaSamplesFor(pixelRatio: number): number {
  if (pixelRatio <= 1.01) return 4;
  if (pixelRatio < 1.5) return 2;
  return 0;
}

/**
 * Bloom input scale relative to the CSS size. Bloom is a blur, so device pixels above 1× buy
 * nothing; quality tier 1+ halves it again. UnrealBloomPass halves this once more internally.
 */
export function bloomScaleFor(pixelRatio: number, tier: number): number {
  return Math.min(pixelRatio, 1) * (tier >= 1 ? 0.5 : 1);
}

/** Rain streak pool for a quality tier (tier 2 halves it). */
export function rainPoolFor(tier: number): number {
  return tier >= 2 ? RAIN.maxDrops / 2 : RAIN.maxDrops;
}

export const QUALITY = {
  maxTier: 2,
  /** Step down when the smoothed frame time stays above this (ms). */
  slowMs: 20,
  /** Step up when it stays below this (ms). */
  fastMs: 14,
  /** Smoothing window of the frame time average (s). */
  averageSeconds: 2,
  /** Time above slowMs before stepping down (s); also lets ux lower the DPR first. */
  downAfter: 3,
  /** Time below fastMs before stepping back up (s). */
  upAfter: 5,
  /** Ignore the first seconds (shader compilation spikes). */
  warmup: 3,
} as const;

export interface QualityState {
  tier: number;
  avgMs: number;
  slowFor: number;
  fastFor: number;
  age: number;
}

export function createQualityState(): QualityState {
  return { tier: 0, avgMs: 16.7, slowFor: 0, fastFor: 0, age: 0 };
}

/**
 * Adaptive quality (11): tier 0 full, 1 = bloom at half resolution, 2 = also half the rain.
 * Mutates `s` (no per-frame allocation) and returns true when the tier changed.
 */
export function stepQuality(s: QualityState, dt: number): boolean {
  if (dt <= 0) return false;
  s.age += dt;
  const ms = dt * 1000;
  if (s.age < QUALITY.warmup) {
    s.avgMs = ms;
    return false;
  }
  const a = Math.min(1, dt / QUALITY.averageSeconds);
  s.avgMs += (ms - s.avgMs) * a;
  s.slowFor = s.avgMs > QUALITY.slowMs ? s.slowFor + dt : 0;
  s.fastFor = s.avgMs < QUALITY.fastMs ? s.fastFor + dt : 0;
  if (s.slowFor >= QUALITY.downAfter && s.tier < QUALITY.maxTier) {
    s.tier++;
    s.slowFor = 0;
    s.fastFor = 0;
    return true;
  }
  if (s.fastFor >= QUALITY.upAfter && s.tier > 0) {
    s.tier--;
    s.slowFor = 0;
    s.fastFor = 0;
    return true;
  }
  return false;
}
