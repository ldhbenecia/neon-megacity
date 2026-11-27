import { allTiers, buildingTop } from '../city/queries';
import type { BuildingSpec, Tier } from '../city/types';
import { DAWN, DAY, NIGHT, PALETTE_KEYS, SUNSET, type PaletteKey, type RGB } from '../core/palette';

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (x: number): number => x * x * (3 - 2 * x);
const smoothstep = (a: number, b: number, x: number): number => smooth(clamp01((x - a) / (b - a)));

export const CLOUD_LAYERS = { lowY: 650, highY: 1400 } as const;

// Bounded shader time keeps float32 precise. Clouds wrap at 1e5 s because every
// drift rate times 1e5 is a whole texture tile, so that wrap is seamless. Star twinkle rates and
// lens drop periods are snapped in their shaders to whole cycles per wrap, so those wraps are
// seamless too. Rain cannot be: a slanted drop never returns to a lattice point, so its wrap
// reshuffles the streaks for one frame; at 1e4 s (2.8 h) that is rare, and float32 still
// resolves 1 ms of time and 2 cm of rain travel (24 m/s × 1e4 s).
export const TIME_WRAP = { rain: 10000, lens: 10000, stars: 10000, clouds: 100000 } as const;

export function wrapTime(t: number, period: number): number {
  return ((t % period) + period) % period;
}

export const FOG = {
  rainDensityGain: 0.5,
  rainBrighten: 0.12,
} as const;

/** Map extent (m) the fog densities and the cloud city glow were tuned on (layout v2). */
export const TUNED_EXTENT = 2400;

/**
 * Fog density factor for a map `extent` m across. The square root thins the fog less than the map
 * grows, so the far districts still sink into strong aerial perspective (v2: 1, v3 4000 m: 0.77).
 */
export function mapFogScale(extent: number): number {
  return Math.sqrt(TUNED_EXTENT / Math.max(1, extent));
}

export function fogBrightness(rain: number): number {
  return 1 + FOG.rainBrighten * clamp01(rain);
}

export interface FogState {
  density: number;
  color: RGB;
}

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

export function sunScatterStrength(sunElevation: number): number {
  return smoothstep(-0.1, 0.03, sunElevation);
}

export const WETNESS = {
  dry: 0.55,
  wet: 1,
  riseSeconds: 30,
  fallSeconds: 120,
  rainThreshold: 0.05,
} as const;

export function isRaining(rain: number): boolean {
  return rain >= WETNESS.rainThreshold;
}

export function wetnessTarget(rain: number): number {
  return isRaining(rain) ? WETNESS.wet : WETNESS.dry;
}

export function stepWetness(wetness: number, rain: number, dt: number): number {
  const span = WETNESS.wet - WETNESS.dry;
  if (isRaining(rain)) return Math.min(WETNESS.wet, wetness + (span / WETNESS.riseSeconds) * dt);
  if (wetness <= WETNESS.dry) return wetness;
  return Math.max(WETNESS.dry, wetness - (span / WETNESS.fallSeconds) * dt);
}

/** Seconds for `env.rain` to cover ~95% of the gap to `env.rainTarget`. */
export const RAIN_EASE_SECONDS = 4;

export function stepRain(rain: number, target: number, dt: number): number {
  const k = 1 - Math.exp((-3 * dt) / RAIN_EASE_SECONDS);
  const next = rain + (target - rain) * k;
  return Math.abs(target - next) < 1e-3 ? target : next;
}

export const RAIN = {
  maxDrops: 12000,
  box: 120,
  lengthMin: 0.6,
  lengthMax: 1.2,
  speedMin: 18,
  speedMax: 24,
  slantMinDeg: 4,
  slantMaxDeg: 8,
  alphaMin: 0.12,
  alphaMax: 0.25,
  neonShare: 0.1,
  fadeAltitude: [CLOUD_LAYERS.lowY - 170, CLOUD_LAYERS.lowY + 110],
} as const;

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

export function rainAltitudeFade(cameraY: number): number {
  return 1 - smoothstep(RAIN.fadeAltitude[0], RAIN.fadeAltitude[1], cameraY);
}

const SEARCHLIGHT_LEVEL = new Map<PaletteKey, number>([
  [NIGHT, 1],
  [SUNSET, 0.3],
  [DAWN, 0.3],
  [DAY, 0],
]);

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
  azimuth: number;
  period: number;
  phase: number;
  amplitude: number;
  lean: number;
}

export interface Mount {
  x: number;
  y: number;
  z: number;
}

const MOUNT_LIFT = 4;

function topMount(b: BuildingSpec): Mount | null {
  let top: Tier | null = null;
  for (const t of allTiers(b)) if (!top || t.y1 > top.y1) top = t;
  return top ? { x: top.x, y: top.y1 + MOUNT_LIFT, z: top.z } : null;
}

/**
 * Mount i stands on the highest tier of the tallest building in `zones[i]`. Slots whose zone the
 * layout lacks are filled with the tallest buildings left, preferring zones that have no mount
 * yet so two beams do not share one peak. Buildings without tiers are never picked, so there are
 * always min(count, buildings with tiers) mounts.
 */
export function searchlightMounts(
  specs: readonly BuildingSpec[],
  count = 2,
  zones: readonly string[] = [],
): Mount[] {
  const candidates = [...specs]
    .map((b) => ({ b, m: topMount(b) }))
    .filter((c): c is { b: BuildingSpec; m: Mount } => c.m !== null)
    .sort((x, y) => buildingTop(y.b) - buildingTop(x.b));
  const slots: ({ b: BuildingSpec; m: Mount } | undefined)[] = [];
  for (let i = 0; i < count; i++) {
    const zone = zones[i];
    slots.push(zone === undefined ? undefined : candidates.find((c) => c.b.zoneId === zone));
  }
  const used = new Set(slots.flatMap((c) => (c ? [c.b] : [])));
  const usedZones = new Set([...used].map((b) => b.zoneId));
  for (let i = 0; i < count; i++) {
    if (slots[i]) continue;
    const pick =
      candidates.find((c) => !used.has(c.b) && !usedZones.has(c.b.zoneId)) ??
      candidates.find((c) => !used.has(c.b));
    if (!pick) continue;
    slots[i] = pick;
    used.add(pick.b);
    usedZones.add(pick.b.zoneId);
  }
  return slots.flatMap((c) => (c ? [c.m] : []));
}

export function searchlightDirection(
  t: number,
  beam: BeamParams,
  out: [number, number, number] = [0, 1, 0],
): [number, number, number] {
  const swing = beam.lean + beam.amplitude * Math.sin((2 * Math.PI * t) / beam.period + beam.phase);
  const az =
    beam.azimuth + 0.35 * Math.sin((2 * Math.PI * t) / (beam.period * 2.7) + beam.phase * 1.3);
  const s = Math.sin(swing);
  out[0] = s * Math.cos(az);
  out[1] = Math.cos(swing);
  out[2] = s * Math.sin(az);
  return out;
}

export function beamLength(
  originY: number,
  dirY: number,
  cloudY: number,
  maxLength: number,
): number {
  if (dirY <= 1e-3 || originY >= cloudY) return maxLength;
  return Math.min(maxLength, (cloudY - originY) / dirY);
}

export const LENS = { aberration: 0.0012, vignette: 0.38, grain: 0.025 } as const;

export function msaaSamplesFor(pixelRatio: number): number {
  if (pixelRatio <= 1.01) return 4;
  if (pixelRatio < 1.5) return 2;
  return 0;
}

// UnrealBloomPass halves this size again internally.
export function bloomScaleFor(pixelRatio: number, tier: number): number {
  return Math.min(pixelRatio, 1) * (tier >= 1 ? 0.5 : 1);
}

/** User quality tier → atmosphere tier: high 0, medium 1, low 2 (docs/PERF.md). */
export function userTier(quality: string): number {
  return quality === 'medium' ? 1 : quality === 'low' ? 2 : 0;
}

/** Rain drop instances: all, half, none. */
export function rainPoolFor(tier: number): number {
  return tier >= 2 ? 0 : tier >= 1 ? RAIN.maxDrops / 2 : RAIN.maxDrops;
}

/** Bloom blur mips drawn: 5, 4, 3. Fewer passes, same programs. */
export function bloomMipsFor(tier: number): number {
  return tier >= 2 ? 3 : tier >= 1 ? 4 : 5;
}

/** Clouds and searchlights show below the low tier. */
export function skyExtrasFor(tier: number): boolean {
  return tier < 2;
}

export const QUALITY = {
  maxTier: 2,
  slowMs: 20,
  fastMs: 14,
  averageSeconds: 2,
  // Also gives ux time to lower the DPR first.
  downAfter: 3,
  upAfter: 5,
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
