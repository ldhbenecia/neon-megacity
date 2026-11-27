// Infra colors, resolved once from palette constants into linear RGB (vertex colors are linear).
// HDR multipliers follow ART_DIRECTION 2.3 / 3.2; the runtime gain (env.neonGain × powerOn)
// is applied on the material, so these stay static.
import { Color } from 'three';
import { MATERIAL, NEON } from '../core/palette';
import type { RGB } from './mesh';

/** sRGB hex → linear RGB × `mul` (three's ColorManagement does the conversion). */
export function lin(hex: number, mul = 1): RGB {
  const c = new Color().setHex(hex);
  return [c.r * mul, c.g * mul, c.b * mul];
}

/**
 * Faint self-light of concrete and steel (× concrete albedo, plus a teal tint): undersides the
 * lights never reach would otherwise render pure black up close at night (target: under 20 %
 * pure-black pixels looking at a deck underside from street height). Daylight drowns it.
 */
const NIGHT_FLOOR = 0.3;
const NIGHT_FLOOR_TEAL = 0.004;

const add = (a: RGB, b: RGB): RGB => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export interface InfraColors {
  asphalt: RGB;
  concrete: RGB;
  underside: RGB;
  steel: RGB;
  archSteel: RGB;
  paintWhite: RGB;
  paintYellow: RGB;
  /** Emissive (HDR). */
  wallBand: RGB;
  ringLine: RGB;
  archPoint: RGB;
  hanger: RGB;
  trussLine: RGB;
  railDot: RGB;
  lowerDeckBand: RGB;
  uplight: RGB;
  uplightStrip: RGB;
  lamp: RGB;
  /** Material emissive (not a vertex color): keeps unlit undersides readable at night. */
  nightFloor: RGB;
}

export function infraColors(): InfraColors {
  return {
    asphalt: lin(MATERIAL.asphalt),
    concrete: lin(MATERIAL.concrete),
    underside: lin(MATERIAL.deckUnderside),
    steel: lin(MATERIAL.bracing),
    archSteel: lin(MATERIAL.archSteel),
    paintWhite: lin(MATERIAL.laneWhite),
    paintYellow: lin(MATERIAL.laneYellow),
    wallBand: lin(NEON.neonTeal.hex, 1.8),
    ringLine: lin(NEON.neonCyan.hex, 2),
    archPoint: lin(NEON.neonCyan.hex, 3),
    hanger: lin(NEON.neonWhite.hex, 0.9),
    trussLine: lin(NEON.neonOrange.hex, 3.5),
    railDot: lin(NEON.neonWhite.hex, 2.5),
    lowerDeckBand: lin(NEON.neonRed.hex, 3.5),
    uplight: lin(NEON.neonCyan.hex, 0.7),
    uplightStrip: lin(NEON.neonCyan.hex, 4),
    lamp: lin(MATERIAL.streetLightSodium, 3),
    nightFloor: add(lin(MATERIAL.concrete, NIGHT_FLOOR), lin(NEON.neonTeal.hex, NIGHT_FLOOR_TEAL)),
  };
}
