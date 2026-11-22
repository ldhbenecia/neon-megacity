// ux-only URL hooks (ART_DIRECTION 8.4, 11). Pure, unit tested in tests/ux-query.test.ts.
//   ?preset=1..8  rig preset (8.4); `?cam=<name>` from src/core/query.ts wins when both are given
//   ?hud=0        start with the HUD hidden (screenshots)
//   ?stats[=1]    stats overlay + window.__hangang; `?stats=0` keeps it off
//   ?debug        show the lil-gui developer panel (hidden for regular users)

export interface UxQuery {
  /** 1-based rig preset index. */
  preset?: number;
  hud: boolean;
  stats: boolean;
  debug: boolean;
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
  };
  const raw = params.get('preset');
  if (raw !== null && /^\d+$/.test(raw.trim())) {
    const n = Number(raw);
    if (n >= 1 && n <= presetCount) out.preset = n;
  }
  return out;
}
