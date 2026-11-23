// bloom's own full-res additive blend is skipped on purpose: the final pass adds tBloom.
// Never reset renderer.info here: ux aggregates it with autoReset = false.
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  CineonToneMapping,
  Color,
  ColorManagement,
  CustomToneMapping,
  Group,
  HalfFloatType,
  LinearToneMapping,
  Mesh,
  NeutralToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  ReinhardToneMapping,
  SRGBTransfer,
  Vector2,
  WebGLRenderTarget,
  type IUniform,
  type ToneMapping,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Ctx } from '../core/types';
import { postEnabled } from '../core/gl';
import { LENS, TIME_WRAP, bloomScaleFor, msaaSamplesFor, wrapTime } from './logic';
import { HASH_GLSL } from './noise';

// UnrealBloomPass.BlurDirectionX/Y exist in JS but not in the type definitions.
const BLUR_X = new Vector2(1, 0);
const BLUR_Y = new Vector2(0, 1);

const FINAL_VERTEX = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const FINAL_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloomOn;
uniform float uTime;
uniform float uAberration;
uniform float uVignette;
uniform float uGrain;
uniform float uAspect;
uniform float uDrops;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
varying vec2 vUv;
${HASH_GLSL}

vec2 lensDrops( vec2 uv ) {
  vec2 p = uv * vec2( uAspect, 1.0 ) * 7.0;
  vec2 id = floor( p );
  vec2 f = fract( p ) - 0.5;
  float h = hash12( id );
  float period = 4.0 + 5.0 * h;
  float cycle = uTime / period + hash12( id + 7.1 );
  float life = fract( cycle );
  float alive = step( 1.0 - 0.3 * uDrops, hash12( id + floor( cycle ) * 13.7 ) );
  vec2 center = ( vec2( hash12( id + 3.3 ), hash12( id + 5.9 ) ) - 0.5 ) * 0.5;
  center.y -= life * 0.12;
  float r = 0.07 + 0.13 * hash12( id + 9.4 );
  vec2 d = f - center;
  d.y *= 1.0 + 0.25 * life;
  float len = length( d );
  float inside = 1.0 - smoothstep( r * 0.8, r, len );
  float fade = smoothstep( 0.0, 0.06, life ) * ( 1.0 - smoothstep( 0.55, 1.0, life ) ) * alive;
  return - d / r * 0.010 * inside * fade;
}

void main() {
  vec2 uv = vUv;
  if ( uDrops > 0.001 ) uv += lensDrops( uv );

  vec2 c = uv - 0.5;
  vec2 off = c * uAberration * ( 0.4 + 3.0 * dot( c, c ) );
  vec3 col = vec3(
    texture2D( tScene, uv + off ).r,
    texture2D( tScene, uv ).g,
    texture2D( tScene, uv - off ).b
  );
  col += texture2D( tBloom, uv ).rgb * uBloomOn;

  vec4 outColor = vec4( col, 1.0 );
  #ifdef LINEAR_TONE_MAPPING
    outColor.rgb = LinearToneMapping( outColor.rgb );
  #elif defined( REINHARD_TONE_MAPPING )
    outColor.rgb = ReinhardToneMapping( outColor.rgb );
  #elif defined( CINEON_TONE_MAPPING )
    outColor.rgb = CineonToneMapping( outColor.rgb );
  #elif defined( ACES_FILMIC_TONE_MAPPING )
    outColor.rgb = ACESFilmicToneMapping( outColor.rgb );
  #elif defined( AGX_TONE_MAPPING )
    outColor.rgb = AgXToneMapping( outColor.rgb );
  #elif defined( NEUTRAL_TONE_MAPPING )
    outColor.rgb = NeutralToneMapping( outColor.rgb );
  #elif defined( CUSTOM_TONE_MAPPING )
    outColor.rgb = CustomToneMapping( outColor.rgb );
  #endif

  vec2 vc = ( vUv - 0.5 ) * vec2( uAspect, 1.0 );
  outColor.rgb *= 1.0 - uVignette * smoothstep( 0.3, 1.05, length( vc ) );

  #ifdef SRGB_TRANSFER
    outColor = sRGBTransferOETF( outColor );
  #endif

  float g = hash12( gl_FragCoord.xy + fract( uTime * 7.31 ) * 517.0 ) - 0.5;
  float lum = dot( outColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  outColor.rgb += g * uGrain * smoothstep( 0.0, 0.12, lum );
  gl_FragColor = outColor;
}
`;

export interface PostSettings {
  strength: number;
  radius: number;
  threshold: number;
  lens: boolean;
  drops: number;
}

export interface Post {
  render(): void;
  warmup(): void;
  update(elapsed: number, s: PostSettings): void;
  setTier(tier: number): void;
  dispose(): void;
}

function toneMappingDefine(t: ToneMapping): string | null {
  switch (t) {
    case LinearToneMapping:
      return 'LINEAR_TONE_MAPPING';
    case ReinhardToneMapping:
      return 'REINHARD_TONE_MAPPING';
    case CineonToneMapping:
      return 'CINEON_TONE_MAPPING';
    case ACESFilmicToneMapping:
      return 'ACES_FILMIC_TONE_MAPPING';
    case AgXToneMapping:
      return 'AGX_TONE_MAPPING';
    case NeutralToneMapping:
      return 'NEUTRAL_TONE_MAPPING';
    case CustomToneMapping:
      return 'CUSTOM_TONE_MAPPING';
    default:
      return null;
  }
}

const uniform = (uniforms: Record<string, IUniform>, name: string): IUniform => {
  const u = uniforms[name];
  if (!u) throw new Error(`post: missing uniform ${name}`);
  return u;
};

export function createPost(ctx: Ctx): Post | null {
  if (!postEnabled(ctx.env.quality, ctx.renderer)) return null;
  const { renderer, scene, camera } = ctx;
  const cssSize = renderer.getSize(new Vector2());
  let pixelRatio = renderer.getPixelRatio();
  let tier = 0;
  let bloomOn = true;

  const sceneTarget = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    samples: msaaSamplesFor(pixelRatio),
  });
  sceneTarget.texture.name = 'atmosphere.sceneHDR';

  const bloom = new UnrealBloomPass(new Vector2(256, 256), 0.7, 0.42, 0.85);
  const bloomQuad = new FullScreenQuad();
  const blackClear = new Color(0, 0, 0);
  const oldClear = new Color();
  const highPass = bloom.materialHighPassFilter.uniforms;
  const composite = bloom.compositeMaterial.uniforms;

  const finalUniforms = {
    tScene: { value: sceneTarget.texture },
    tBloom: { value: bloom.renderTargetsHorizontal[0]?.texture ?? null },
    uBloomOn: { value: 1 },
    toneMappingExposure: { value: 1 },
    uTime: { value: 0 },
    uAberration: { value: LENS.aberration as number },
    uVignette: { value: LENS.vignette as number },
    uGrain: { value: LENS.grain as number },
    uAspect: { value: 1 },
    uDrops: { value: 0 },
  };
  const finalMaterial = new RawShaderMaterial({
    name: 'atmosphere.final',
    uniforms: finalUniforms,
    vertexShader: FINAL_VERTEX,
    fragmentShader: FINAL_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
  const finalQuad = new FullScreenQuad(finalMaterial);
  const warmCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let outColorSpace: string | null = null;
  let outToneMapping: ToneMapping | null = null;

  const exposure = finalUniforms.toneMappingExposure;
  const time = finalUniforms.uTime;
  const aberration = finalUniforms.uAberration;
  const vignette = finalUniforms.uVignette;
  const grain = finalUniforms.uGrain;
  const aspect = finalUniforms.uAspect;
  const drops = finalUniforms.uDrops;
  const bloomOnU = finalUniforms.uBloomOn;

  function resize(): void {
    const w = cssSize.x;
    const h = cssSize.y;
    sceneTarget.setSize(
      Math.max(1, Math.round(w * pixelRatio)),
      Math.max(1, Math.round(h * pixelRatio)),
    );
    const s = bloomScaleFor(pixelRatio, tier);
    bloom.setSize(Math.max(2, Math.round(w * s)), Math.max(2, Math.round(h * s)));
    aspect.value = w / Math.max(1, h);
  }

  function syncPixelRatio(): void {
    const pr = renderer.getPixelRatio();
    if (pr === pixelRatio) return;
    pixelRatio = pr;
    const samples = msaaSamplesFor(pr);
    if (samples !== sceneTarget.samples) {
      // three applies a new sample count only after dispose().
      sceneTarget.samples = samples;
      sceneTarget.dispose();
    }
    resize();
  }

  resize();
  // ctx.onResize has no unsubscribe.
  let disposed = false;
  ctx.onResize((w, h) => {
    if (disposed) return;
    cssSize.set(w, h);
    pixelRatio = -1;
    syncPixelRatio();
  });

  function syncOutputDefines(): void {
    if (outColorSpace === renderer.outputColorSpace && outToneMapping === renderer.toneMapping)
      return;
    outColorSpace = renderer.outputColorSpace;
    outToneMapping = renderer.toneMapping;
    const defines: Record<string, string> = {};
    if (ColorManagement.getTransfer(outColorSpace) === SRGBTransfer) defines.SRGB_TRANSFER = '';
    const tm = toneMappingDefine(outToneMapping);
    if (tm) defines[tm] = '';
    finalMaterial.defines = defines;
    finalMaterial.needsUpdate = true;
  }

  function renderBloom(): void {
    renderer.getClearColor(oldClear);
    const oldAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(blackClear, 0);

    uniform(highPass, 'tDiffuse').value = sceneTarget.texture;
    uniform(highPass, 'luminosityThreshold').value = bloom.threshold;
    bloomQuad.material = bloom.materialHighPassFilter;
    renderer.setRenderTarget(bloom.renderTargetBright);
    renderer.clear();
    bloomQuad.render(renderer);

    let input = bloom.renderTargetBright;
    for (let i = 0; i < bloom.nMips; i++) {
      const mat = bloom.separableBlurMaterials[i];
      const hTarget = bloom.renderTargetsHorizontal[i];
      const vTarget = bloom.renderTargetsVertical[i];
      if (!mat || !hTarget || !vTarget) break;
      bloomQuad.material = mat;
      uniform(mat.uniforms, 'colorTexture').value = input.texture;
      uniform(mat.uniforms, 'direction').value = BLUR_X;
      renderer.setRenderTarget(hTarget);
      renderer.clear();
      bloomQuad.render(renderer);
      uniform(mat.uniforms, 'colorTexture').value = hTarget.texture;
      uniform(mat.uniforms, 'direction').value = BLUR_Y;
      renderer.setRenderTarget(vTarget);
      renderer.clear();
      bloomQuad.render(renderer);
      input = vTarget;
    }

    bloomQuad.material = bloom.compositeMaterial;
    uniform(composite, 'bloomStrength').value = bloom.strength;
    uniform(composite, 'bloomRadius').value = bloom.radius;
    uniform(composite, 'bloomTintColors').value = bloom.bloomTintColors;
    const out = bloom.renderTargetsHorizontal[0];
    if (out) {
      renderer.setRenderTarget(out);
      renderer.clear();
      bloomQuad.render(renderer);
    }

    renderer.setClearColor(oldClear, oldAlpha);
    renderer.autoClear = oldAutoClear;
  }

  return {
    warmup() {
      syncOutputDefines();
      renderer.setRenderTarget(sceneTarget);
      renderer.compile(scene, camera);
      const quadGeo = new PlaneGeometry(2, 2);
      const holder = new Group();
      const mats = [
        bloom.materialHighPassFilter,
        ...bloom.separableBlurMaterials,
        bloom.compositeMaterial,
      ];
      for (const m of mats) holder.add(new Mesh(quadGeo, m));
      renderer.setRenderTarget(bloom.renderTargetBright);
      renderer.compile(holder, warmCamera);
      holder.clear();
      holder.add(new Mesh(quadGeo, finalMaterial));
      renderer.setRenderTarget(null);
      renderer.compile(holder, warmCamera);
      holder.clear();
      quadGeo.dispose();
    },
    render() {
      syncPixelRatio();
      syncOutputDefines();
      renderer.setRenderTarget(sceneTarget);
      renderer.render(scene, camera);
      if (bloomOn) renderBloom();
      exposure.value = renderer.toneMappingExposure;
      renderer.setRenderTarget(null);
      finalQuad.render(renderer);
    },
    update(elapsed, s) {
      bloom.strength = s.strength;
      bloom.radius = s.radius;
      bloom.threshold = s.threshold;
      bloomOn = s.strength > 0.005;
      bloomOnU.value = bloomOn ? 1 : 0;
      time.value = wrapTime(elapsed, TIME_WRAP.lens);
      aberration.value = s.lens ? LENS.aberration : 0;
      vignette.value = s.lens ? LENS.vignette : 0;
      grain.value = s.lens ? LENS.grain : 0;
      drops.value = s.drops;
    },
    setTier(t) {
      if (t === tier) return;
      tier = t;
      resize();
    },
    dispose() {
      disposed = true;
      sceneTarget.dispose();
      bloom.dispose();
      bloomQuad.dispose();
      finalMaterial.dispose();
      finalQuad.dispose();
    },
  };
}
