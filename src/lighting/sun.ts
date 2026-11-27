import { smoothstep } from '../city/math';
import { DAWN, DAY, NIGHT, PALETTE_KEYS, SUNSET, type PaletteKey } from '../core/palette';

export interface Vec3Out {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;

// Sunset at 19:19 keeps the sun 0–15° up during the palette's sunset plateau (18:15–19:10).
export const SUN_PATH = {
  sunrise: 0.255,
  sunset: 0.805,
  maxElevation: 62 * DEG,
  nightDepth: 50 * DEG,
  overshoot: 25 * DEG,
} as const;

// Kept low on purpose so the moon shows above the ridges in the hero cameras.
export const MOON_PATH = {
  rise: 0.79,
  span: 0.46,
  maxElevation: 28 * DEG,
  /** atan2(z, x); north is -Z, so negative angles are north. */
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

export function sunDirectionAt(timeOfDay: number, out: Vec3Out = { x: 0, y: 0, z: 0 }): Vec3Out {
  const t = wrap01(timeOfDay);
  const { sunrise, sunset, maxElevation, nightDepth, overshoot } = SUN_PATH;
  const dayLen = sunset - sunrise;
  if (t >= sunrise && t <= sunset) {
    const p = (t - sunrise) / dayLen;
    const angle = -overshoot + (Math.PI + 2 * overshoot) * p;
    return fromAngles(maxElevation * Math.sin(Math.PI * p), angle, out);
  }
  const q = wrap01(t - sunset) / (1 - dayLen);
  const angle = Math.PI + overshoot + (Math.PI - 2 * overshoot) * q;
  return fromAngles(-nightDepth * Math.sin(Math.PI * q), angle, out);
}

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
  const angle = setAngle + (riseAngle + 2 * Math.PI - setAngle) * p;
  return fromAngles(-maxElevation * Math.sin(Math.PI * p), angle, out);
}

export function dayFactorAt(sunElevation: number): number {
  return smoothstep(-0.1, 0.15, sunElevation);
}

/**
 * Weight of the shadow fill (env.fillFactor): 1 at night, and already up while the sun is low at
 * either end of the day (backlit banks and walls), 0 by day: 1 - smoothstep(0.1, 0.35, e), the
 * night curve shifted later. Between elevation 0.15 and 0.35 dayFactor is already 1, so the fill there only lifts
 * shadows by at most the night floor (~0.005 linear), well under the sunlit surfaces.
 */
export function fillFactorAt(sunElevation: number): number {
  // The night curve (1 - smoothstep(-0.1, 0.15, e)) shifted 0.2 later, so it never drops below
  // nightFactor (the test checks fill >= nightFactor).
  return 1 - smoothstep(0.1, 0.35, sunElevation);
}

/**
 * Linear RGB of the shadow fill: the night teal floor, turning toward the sky's own dark tint
 * (scaled to the same strength) for the part of the fill that comes from a low sun rather than
 * from night, so dusk shadows look sky-lit instead of teal. Scaled by fillFactorAt.
 */
export function fillColorAt(
  sunElevation: number,
  sky: readonly [number, number, number],
  floor: readonly [number, number, number],
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  const fill = fillFactorAt(sunElevation);
  const night = 1 - dayFactorAt(sunElevation);
  const dusk = fill > 1e-4 ? Math.min(1, Math.max(0, 1 - night / fill)) : 0;
  const peak = Math.max(floor[0], floor[1], floor[2]);
  const skyPeak = Math.max(sky[0], sky[1], sky[2], 1e-6);
  for (let i = 0; i < 3; i++) {
    const tint = ((sky[i] ?? 0) / skyPeak) * peak;
    out[i] = ((floor[i] ?? 0) + (tint - (floor[i] ?? 0)) * dusk) * fill;
  }
  return out;
}

// Both weights are 0 at the hand-over, so swapping sun and moon never pops.
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

// Must not advance while locked: ?time= screenshots and e2e rely on it.
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

// Switches where paletteAt's smoothstep weight crosses 0.5.
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
  half: number;
}

export const SHADOW_SNAP = { grid: 64, ratio: 1.25, minHalf: 220, maxHalf: 1400 } as const;

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

/**
 * Whether a pending ctx.requestShadowUpdate() redraws the map now: only while sun shadows show,
 * and not sooner than the tier's minimum interval after the last redraw (requests wait, not drop).
 */
export function shadowRequestDue(
  requested: boolean,
  sunShadows: boolean,
  secondsSinceLast: number,
  minInterval: number,
): boolean {
  return requested && sunShadows && secondsSinceLast >= minInterval;
}

export const SHADOW_REFRESH = {
  sunEps: 0.5 * DEG,
  minInterval: 1,
  maxInterval: 4,
} as const;

// A moved frustum must refresh at once: the light target follows it, so a stale map clips shadows.
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
