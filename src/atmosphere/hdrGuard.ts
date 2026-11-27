/** Upper bound for HDR values entering bloom and the final pass. */
export const HDR_CAP = 64;

// One NaN or Inf pixel spreads through the bloom mips into large black blocks. NaN fails every
// comparison, and v != v folds away under fast math (ANGLE on Metal), hence the "below the
// half-float max" test. A channel that fails it becomes 0; the rest are clamped to [0, HDR_CAP].
export const HDR_SAFE_GLSL = /* glsl */ `
vec3 finiteHdr( vec3 v ) {
  bvec3 ok = lessThan( abs( v ), vec3( 65000.0 ) );
  vec3 f = vec3( ok.x ? v.x : 0.0, ok.y ? v.y : 0.0, ok.z ? v.z : 0.0 );
  return clamp( f, 0.0, ${HDR_CAP.toFixed(1)} );
}
bool nonFinite( vec3 v ) {
  return !all( lessThan( abs( v ), vec3( 65000.0 ) ) );
}
`;

const HIGH_PASS_READ = 'vec4 texel = texture2D( tDiffuse, vUv );';

/** Bloom's luminosity high-pass reading its input through finiteHdr(). */
export function guardHighPass(fragmentShader: string): string {
  if (!fragmentShader.includes(HIGH_PASS_READ) || !fragmentShader.includes('void main()')) {
    throw new Error('post: bloom high-pass shader changed, NaN guard not applied');
  }
  return fragmentShader
    .replace('void main()', `${HDR_SAFE_GLSL}\nvoid main()`)
    .replace(
      HIGH_PASS_READ,
      'vec4 texel = vec4( finiteHdr( texture2D( tDiffuse, vUv ).rgb ), 1.0 );',
    );
}
