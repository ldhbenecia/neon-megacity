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
}

export function infraColors(): InfraColors {
  return {
    asphalt: lin(MATERIAL.facadeDark),
    concrete: lin(MATERIAL.retainingWall),
    underside: lin(MATERIAL.deckUnderside),
    steel: lin(MATERIAL.bracing),
    archSteel: lin(MATERIAL.dongNumber, 0.8),
    paintWhite: lin(MATERIAL.dongNumber, 0.55),
    paintYellow: lin(NEON.neonAmber.hex, 0.45),
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
  };
}
