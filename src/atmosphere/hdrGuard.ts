/** Upper bound for HDR values entering bloom and the final pass. */
export const HDR_CAP = 64;

// One NaN pixel spreads through the bloom mips into large black blocks. NaN fails every
// comparison, and v != v folds away under fast math (ANGLE on Metal), so a channel is kept when
// it is below the half-float max, capped when it is a large positive value or +Inf, and zeroed
// otherwise (NaN, -Inf). The result is clamped to [0, HDR_CAP].
export const HDR_SAFE_GLSL = /* glsl */ `
float finiteHdr1( float v ) {
  if ( abs( v ) < 65000.0 ) return clamp( v, 0.0, ${HDR_CAP.toFixed(1)} );
  return v > 0.0 ? ${HDR_CAP.toFixed(1)} : 0.0;
}
vec3 finiteHdr( vec3 v ) {
  return vec3( finiteHdr1( v.x ), finiteHdr1( v.y ), finiteHdr1( v.z ) );
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
