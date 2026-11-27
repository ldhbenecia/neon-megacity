// Shared by the sky dome and the far ridges so their horizons match. Returns 0 facing away from
// the sun and 1 toward it, already clamped: rounding can push the raw value just below 0, and
// a power of a negative base is NaN, which bloom spreads into black blocks.
export const HORIZON_SIDE_GLSL = /* glsl */ `
float horizonSide(vec3 dir, vec3 sunDir) {
  float sl = length(sunDir.xz);
  float dl = length(dir.xz);
  if (sl < 1e-4 || dl < 1e-4) return 0.5;
  return clamp(dot(dir.xz / dl, sunDir.xz / sl) * 0.5 + 0.5, 0.0, 1.0);
}
`;
