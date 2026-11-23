export interface UxQuery {
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
