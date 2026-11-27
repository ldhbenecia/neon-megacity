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
  archWhite: RGB;
  archRed: RGB;
  islandPoint: RGB;
  chordCyan: RGB;
  trussRed: RGB;
  diamondPoint: RGB;
  pylonRing: RGB;
  pylonBand: RGB;
  laneLamp: RGB;
  deckBand: RGB;
  islandWash: RGB;
  islandStrip: RGB;
  tunnelLamp: RGB;
}

/** Average of two linear colors. */
function mix(a: RGB, b: RGB): RGB {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
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
    archWhite: lin(NEON.neonWhite.hex, 2.2),
    archRed: mix(lin(NEON.neonRed.hex, 5), lin(NEON.neonOrange.hex, 5)),
    islandPoint: lin(NEON.neonOrange.hex, 3),
    chordCyan: lin(NEON.neonCyan.hex, 1.8),
    // Painted steel, not emissive.
    trussRed: lin(NEON.neonRed.hex, 0.3),
    diamondPoint: lin(NEON.neonOrange.hex, 4),
    pylonRing: lin(NEON.neonCyan.hex, 4),
    pylonBand: lin(NEON.neonOrange.hex, 4),
    laneLamp: lin(NEON.neonAmber.hex, 1.5),
    deckBand: lin(NEON.neonWhite.hex, 2),
    islandWash: lin(NEON.neonTeal.hex, 0.7),
    islandStrip: lin(NEON.neonTeal.hex, 4),
    tunnelLamp: lin(NEON.neonOrange.hex, 3),
  };
}
