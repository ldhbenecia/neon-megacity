// Pure time-of-day math for the lighting module: sun / moon paths, day factor, time advance,
// environment-map key selection, the shadow frustum bucket and shadow refresh policy. No three.js, no side effects.
// Unit tests: tests/lighting.test.ts.
import { smoothstep } from '../city/math';
import { DAWN, DAY, NIGHT, PALETTE_KEYS, SUNSET, type PaletteKey } from '../core/palette';

export interface Vec3Out {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;

/**
 * Sun path. Sunrise 06:07 and sunset 19:19 so that the palette's sunset plateau (18:15–19:10,
 * ART_DIRECTION 3.1) happens with the sun 0–15° above the horizon. The arc runs from ENE through
 * the south (+Z) to WNW, like a summer sun over Seoul, and peaks at 62°.
 */
export const SUN_PATH = {
  sunrise: 0.255,
  sunset: 0.805,
  maxElevation: 62 * DEG,
  /** How deep the sun dips at solar midnight. */
  nightDepth: 50 * DEG,
  /** Azimuth overshoot past due east / west at the horizon (sun rises north of east). */
  overshoot: 25 * DEG,
} as const;

/**
 * Moon path: rises in the ENE around 18:58, crosses the northern sky (behind the skyline seen
 * from the south bank) at up to 28°, and sets in the WNW around 06:00. Low on purpose: it shows up
 * above the ridges in the hero cameras instead of hiding behind them at the zenith.
 */
export const MOON_PATH = {
  rise: 0.79,
  /** Fraction of the day the moon is up. */
  span: 0.46,
  maxElevation: 28 * DEG,
  /** atan2(z, x) bearing at rise and set (north = -Z, so negative angles are north). */
  riseAngle: -20 * DEG,
  setAngle: -160 * DEG,
} as const;

const wrap01 = (t: number): number => ((t % 1) + 1) % 1;

function fromAngles(elevation: number, angle: number, out: Vec3Out): Vec3Out {
  const c = Math.cos(elevation);
  out.x = c * Math.cos(angle);
  out.y = Math.sin(elevation);
  out.z = c * Math.sin(angle);
  return out;
}

/** Unit vector from the ground toward the sun at `timeOfDay` (0 = midnight, 0.5 ≈ noon). */
export function sunDirectionAt(timeOfDay: number, out: Vec3Out = { x: 0, y: 0, z: 0 }): Vec3Out {
  const t = wrap01(timeOfDay);
  const { sunrise, sunset, maxElevation, nightDepth, overshoot } = SUN_PATH;
  const dayLen = sunset - sunrise;
  if (t >= sunrise && t <= sunset) {
    const p = (t - sunrise) / dayLen;
    // atan2(z, x): -overshoot (ENE) → π/2 (south, +Z) → π + overshoot (WNW).
    const angle = -overshoot + (Math.PI + 2 * overshoot) * p;
    return fromAngles(maxElevation * Math.sin(Math.PI * p), angle, out);
  }
  const q = wrap01(t - sunset) / (1 - dayLen);
  const angle = Math.PI + overshoot + (Math.PI - 2 * overshoot) * q;
  return fromAngles(-nightDepth * Math.sin(Math.PI * q), angle, out);
}

/** Unit vector toward the moon. Below the horizon during the day. */
export function moonDirectionAt(timeOfDay: number, out: Vec3Out = { x: 0, y: 0, z: 0 }): Vec3Out {
  const { rise, span, maxElevation, riseAngle, setAngle } = MOON_PATH;
  const q = wrap01(timeOfDay - rise);
  if (q <= span) {
    const p = q / span;
    return fromAngles(
      maxElevation * Math.sin(Math.PI * p),
      riseAngle + (setAngle - riseAngle) * p,
      out,
    );
  }
  const p = (q - span) / (1 - span);
  // Below the horizon: continue around through the south back to the rise bearing.
  const angle = setAngle + (riseAngle + 2 * Math.PI - setAngle) * p;
  return fromAngles(-maxElevation * Math.sin(Math.PI * p), angle, out);
}

/** 0..1 day blend from the sun elevation (sin). Civil twilight (−6°) → 0, sun at ~9° → 1. */
export function dayFactorAt(sunElevation: number): number {
  return smoothstep(-0.1, 0.15, sunElevation);
}

/**
 * Key light blend: which body drives the single DirectionalLight and how strongly (0..1).
 * Continuous: both weights are 0 at the hand-over (sun right at the horizon).
 */
export function keyLightAt(
  sunElevation: number,
  moonElevation: number,
): { body: 'sun' | 'moon'; weight: number } {
  if (sunElevation > -0.02) return { body: 'sun', weight: smoothstep(-0.02, 0.06, sunElevation) };
  return {
    body: 'moon',
    weight: smoothstep(0.02, 0.1, -sunElevation) * smoothstep(0, 0.12, moonElevation),
  };
}

/**
 * Next time of day. Never advances while `locked` (`?time=` given → env.timeLocked) or paused:
 * the old build drifted from `?time=0.0` to 00:08 because it ignored the lock.
 */
export function advanceTime(
  timeOfDay: number,
  dt: number,
  dayLengthSeconds: number,
  locked: boolean,
): number {
  if (locked || dayLengthSeconds <= 0 || dt <= 0) return timeOfDay;
  return wrap01(timeOfDay + dt / dayLengthSeconds);
}

export type EnvKey = 'night' | 'dawn' | 'day' | 'sunset';

const KEY_NAMES = new Map<PaletteKey, EnvKey>([
  [NIGHT, 'night'],
  [DAWN, 'dawn'],
  [DAY, 'day'],
  [SUNSET, 'sunset'],
]);

/**
 * Which of the 4 baked environment maps a time of day uses (ART_DIRECTION 6.1: baked once per
 * palette key). Derived from `PALETTE_KEYS`: the key that dominates the palette blend, so the
 * switch happens exactly at the midpoint of each transition (05:00, 08:00, 16:37, 20:36), where
 * `paletteAt`'s smoothstep weight crosses 0.5.
 */
export function envKeyAt(timeOfDay: number): EnvKey {
  const t = wrap01(timeOfDay);
  let i = 0;
  while (i < PALETTE_KEYS.length - 2 && t >= (PALETTE_KEYS[i + 1] as { t: number }).t) i++;
  const a = PALETTE_KEYS[i] as { t: number; key: PaletteKey };
  const b = PALETTE_KEYS[i + 1] as { t: number; key: PaletteKey };
  const w = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  return KEY_NAMES.get(w < 0.5 ? a.key : b.key) ?? 'night';
}

export interface ShadowFrame {
  cx: number;
  cz: number;
  /** Half extent of the orthographic shadow camera (m). */
  half: number;
}

/** Shadow frustum snaps: center to this grid, half extent to powers of this ratio. */
export const SHADOW_SNAP = { grid: 64, ratio: 1.25, minHalf: 220, maxHalf: 1400 } as const;

/**
 * Shadow frustum around the orbit target, sized by camera distance and snapped so it only
 * changes (and the 2048² map only re-renders) when the view moves meaningfully.
 */
export function shadowFrameFor(
  targetX: number,
  targetZ: number,
  cameraDistance: number,
): ShadowFrame {
  const { grid, ratio, minHalf, maxHalf } = SHADOW_SNAP;
  const want = Math.min(maxHalf, Math.max(minHalf, cameraDistance * 1.1));
  const k = Math.ceil(Math.log(want / minHalf) / Math.log(ratio) - 1e-9);
  return {
    cx: Math.round(targetX / grid) * grid + 0,
    cz: Math.round(targetZ / grid) * grid + 0,
    half: Math.min(maxHalf, minHalf * Math.pow(ratio, k)),
  };
}

/** Shadow map refresh policy (2048² re-renders are the most expensive thing lighting does). */
export const SHADOW_REFRESH = {
  /** Sun movement (radians) that warrants a re-render: 0.5°. */
  sunEps: 0.5 * DEG,
  /** Never re-render for sun movement more often than this (s). */
  minInterval: 1,
  /** Safety refresh while the sun is up (late-loaded or animated casters), seconds. */
  maxInterval: 4,
} as const;

/**
 * Whether the shadow map must be re-rendered this frame. A moved / resized frustum always
 * refreshes immediately (the light target follows it, so a stale map would clip shadows);
 * sun motion refreshes at most once per `minInterval` and only past `sunEps`.
 */
export function shouldRefreshShadow(
  frameChanged: boolean,
  sunAngleSinceLast: number,
  secondsSinceLast: number,
  warmup: boolean,
): boolean {
  if (frameChanged || warmup) return true;
  if (secondsSinceLast >= SHADOW_REFRESH.maxInterval) return true;
  return (
    sunAngleSinceLast >= SHADOW_REFRESH.sunEps && secondsSinceLast >= SHADOW_REFRESH.minInterval
  );
}
