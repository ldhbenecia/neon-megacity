import { CAMERA_LIMITS } from '../core/query';
import type { Pose } from './motion';

export interface UxQuery {
  preset?: number;
  /** `?pose=px,py,pz,tx,ty,tz`; ignored unless 6 finite numbers within the orbit distance limits. */
  pose?: Pose;
  hud: boolean;
  stats: boolean;
  debug: boolean;
  /** `?debug&nan`: paint NaN/Inf HDR pixels (atmosphere post), passed on as `ctx.debug.nan`. */
  nan: boolean;
}

/** OrbitControls would silently move a pose outside these on its first update. */
export function poseInLimits({ position: p, target: t }: Pose): boolean {
  const d = Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z);
  return d >= CAMERA_LIMITS.minDistance && d <= CAMERA_LIMITS.maxDistance;
}

const OFF = new Set(['0', 'false', 'off', 'no']);

export function parseUxQuery(search: string, presetCount = 8): UxQuery {
  const params = new URLSearchParams(search);
  const flag = (name: string, fallback: boolean): boolean => {
    const v = params.get(name);
    if (v === null) return fallback;
    return !OFF.has(v.trim().toLowerCase());
  };
  const out: UxQuery = {
    hud: flag('hud', true),
    stats: flag('stats', false),
    debug: flag('debug', false),
    nan: false,
  };
  out.nan = out.debug && flag('nan', false);
  const raw = params.get('preset');
  if (raw !== null && /^\d+$/.test(raw.trim())) {
    const n = Number(raw);
    if (n >= 1 && n <= presetCount) out.preset = n;
  }
  const pose = params
    .get('pose')
    ?.split(',')
    .map((v) => (v.trim() === '' ? NaN : Number(v)));
  if (pose?.length === 6 && pose.every(Number.isFinite)) {
    const [px, py, pz, tx, ty, tz] = pose as [number, number, number, number, number, number];
    const p = { position: { x: px, y: py, z: pz }, target: { x: tx, y: ty, z: tz } };
    if (poseInLimits(p)) out.pose = p;
  }
  return out;
}
