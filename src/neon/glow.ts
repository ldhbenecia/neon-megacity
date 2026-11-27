import * as THREE from 'three';
import { ADDITIVE_TAIL, COMMON_PARS, PATH_PARS, neonMaterial, type NeonUniforms } from './glsl';

// Halos, holograms, ground reflections and vehicle lights share one shader program (perf budget: every
// distinct source or define is another program). `uMode` picks the branch at run time, so
// only uniforms may differ between these materials, never defines or `side`.
export const GlowMode = { halo: 0, holo: 1, decal: 2, vehicle: 3 } as const;
export type GlowMode = (typeof GlowMode)[keyof typeof GlowMode];

const VERTEX = /* glsl */ `
  ${COMMON_PARS}
  ${PATH_PARS}
  uniform float uMode;
  uniform vec3 uHead; uniform vec3 uTail; uniform vec3 uGlowA; uniform vec3 uGlowB;
  attribute vec4 iPos; attribute vec4 iColor; attribute vec4 iRect; attribute vec4 iParam;
  attribute vec2 iSize; attribute vec2 aCorner; attribute float aKind;
  varying vec2 vUv; varying vec3 vCol; varying float vAlpha; varying vec4 vRect; varying vec4 vParam;
  varying float vWorldY; varying float vPower; varying float vFace; varying float vFade;
  varying vec2 vWorld; varying float vPool; varying float vKind;
  #include <fog_pars_vertex>
  #if defined(USE_FOG) && defined(FOG_EXP2)
    uniform float fogDensity;
  #endif
  void main() {
    vec4 mvPosition;
    if (uMode < 0.5) {
      mvPosition = viewMatrix * vec4(iPos.xyz, 1.0);
      float dist = -mvPosition.z;
      float r = iPos.w * (1.0 + dist / 400.0);
      // Pulled toward the camera so the disc does not clip into the wall behind the sign.
      mvPosition.xyz *= max(0.2, 1.0 - min(r * 0.6, dist * 0.3) / max(dist, 1.0));
      mvPosition.xy += position.xy * r;
      float fogE = 0.0;
      #ifdef USE_FOG
        #ifdef FOG_EXP2
          float fd = fogDensity * 0.55 * dist;
          fogE = 1.0 - exp(-fd * fd);
        #endif
      #endif
      vAlpha = (0.02 + fogE * 0.35) * powerOn(iColor.w, 3.0) * uGain;
      vCol = iColor.rgb;
      vUv = position.xy;
    } else if (uMode < 1.5) {
      float ang = uTime * iParam.x + iParam.z * 6.28;
      float c = cos(ang); float s = sin(ang);
      vec3 p = position * iPos.w;
      float period = mix(3.0, 7.0, iParam.z);
      float jt = mod(uTime + iParam.z * 20.0, period);
      float jitter = (jt < 0.12 && uMotion > 0.5) ? (nHash(floor(uTime * 20.0) + iParam.z) - 0.5) * 0.04 : 0.0;
      vec3 world = iPos.xyz + vec3(c * p.x + s * p.z, p.y + jitter * iPos.w, -s * p.x + c * p.z);
      mvPosition = viewMatrix * vec4(world, 1.0);
      vUv = uv; vRect = iRect; vParam = iParam; vWorldY = world.y;
      vPower = powerOn(iParam.w, iParam.z * 30.0);
      // Fade the edge-on plane of the cross so its mirrored copy never overlaps the readable one.
      vec3 n0 = abs(position.x) < 1e-3 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
      vec3 n = vec3(c * n0.x + s * n0.z, 0.0, -s * n0.x + c * n0.z);
      float facing = dot(safeNormalize(cameraPosition - world, vec3(0.0, 1.0, 0.0)), n);
      vFace = smoothstep(0.35, 0.85, abs(facing)) * sign(facing);
    } else if (uMode > 2.5) {
      vec3 P; vec3 F; vec3 R; float fade;
      vehicleFrame(P, F, R, fade);
      vec3 world = P + F * position.x + vec3(0.0, position.y, 0.0) + R * position.z;
      mvPosition = viewMatrix * vec4(world, 1.0);
      float facing = dot(safeNormalize(cameraPosition - world, vec3(0.0, 1.0, 0.0)), F);
      vec3 col;
      if (aKind < 0.5) {
        col = uHead * (0.25 + 0.75 * smoothstep(-0.2, 0.6, facing));
      } else if (aKind < 1.5) {
        col = uTail * (0.3 + 0.7 * smoothstep(-0.2, 0.6, -facing));
      } else if (aKind < 2.5) {
        col = uHead * 0.035 * uNight;
      } else {
        col = mix(uGlowA, uGlowB, step(0.5, fract(iExtra.y * 0.618)));
      }
      if (aKind < 1.5 || aKind > 2.5) {
        float size = aKind > 2.5 ? 1.1 : (aKind < 0.5 ? 0.32 : 0.28);
        float k = clamp(-mvPosition.z / 90.0, 1.0, 7.0);
        mvPosition.xy += aCorner * size * k;
        col /= k;
      }
      vCol = col * fade * mix(0.35, 1.0, uNight);
      vUv = aCorner;
      vKind = aKind;
    } else {
      vec2 toCam = cameraPosition.xz - iPos.xz;
      float dist = length(toCam);
      vPool = iSize.y < 0.0 ? 1.0 : 0.0;
      vec2 xz;
      if (vPool > 0.5) {
        vUv = vec2(position.x, position.y - 0.5) * 2.0;
        xz = iPos.xz + vUv * iSize.x;
        vFade = 1.0 - smoothstep(200.0, 250.0, dist);
      } else {
        vec2 dir = dist > 1e-3 ? toCam / dist : vec2(0.0, 1.0);
        vec2 side = vec2(-dir.y, dir.x);
        float len = min(iSize.y, dist * 0.8);
        xz = iPos.xz + side * position.x * iSize.x + dir * position.y * len;
        vUv = vec2(position.x, position.y);
        vFade = 1.0 - smoothstep(300.0, 400.0, dist);
      }
      mvPosition = viewMatrix * vec4(xz.x, iPos.y, xz.y, 1.0);
      vCol = iColor.rgb;
      vWorld = xz;
    }
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  ${COMMON_PARS}
  uniform float uMode; uniform sampler2D uAtlas; uniform vec3 uTint;
  varying vec2 vUv; varying vec3 vCol; varying float vAlpha; varying vec4 vRect; varying vec4 vParam;
  varying float vWorldY; varying float vPower; varying float vFace; varying float vFade;
  varying vec2 vWorld; varying float vPool; varying float vKind;
  #include <fog_pars_fragment>
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(nHash2(i), nHash2(i + vec2(1, 0)), f.x), mix(nHash2(i + vec2(0, 1)), nHash2(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    if (uMode < 0.5) {
      float d = dot(vUv, vUv);
      float a = exp(-d * 4.0) * (1.0 - smoothstep(0.7, 1.0, d));
      gl_FragColor = vec4(vCol * a * vAlpha, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      return;
    }
    if (uMode < 1.5) {
      vec2 fuv = vec2(vFace < 0.0 ? 1.0 - vUv.x : vUv.x, vUv.y);
      vec3 tex = texture2D(uAtlas, vRect.xy + clamp(fuv, 0.01, 0.99) * vRect.zw).rgb;
      float lum = max(tex.r, max(tex.g, tex.b));
      float scan = 0.55 + 0.45 * step(0.5, fract(vWorldY / 0.4));
      vec3 col = mix(tex, uTint * lum, 0.35) * 3.0;
      float a = vParam.y * scan * smoothstep(0.03, 0.25, lum) * vPower * uGain * abs(vFace);
      gl_FragColor = vec4(col * a, 1.0);
    } else if (uMode > 2.5) {
      float a;
      if (vKind > 1.5 && vKind < 2.5) {
        a = (1.0 - vUv.x) * (1.0 - vUv.y * vUv.y);
      } else {
        float d = dot(vUv, vUv);
        a = exp(-d * 5.0) + 0.6 * exp(-d * 28.0);
      }
      gl_FragColor = vec4(vCol * a, 1.0);
    } else {
      if (vFade <= 0.0) discard;
      if (vPool > 0.5) {
        float d = dot(vUv, vUv);
        float a = exp(-d * 3.0) * (1.0 - smoothstep(0.75, 1.0, d));
        gl_FragColor = vec4(vCol * a * vFade * uNight * (1.0 + uWet * 0.6) * uPower, 1.0);
      } else {
        float across = exp(-vUv.x * vUv.x * 9.0);
        float along = pow(max(1.0 - vUv.y, 0.0), 1.4) * smoothstep(0.0, 0.08, vUv.y);
        vec2 p = vWorld * 0.35 + vec2(0.0, uTime * 0.3 * 0.35);
        float puddle = smoothstep(0.35, 0.75, vnoise(vWorld * 0.06));
        float ripple = 0.6 + 0.4 * vnoise(p + vnoise(p * 2.3) * 0.8);
        float a = uWet * 0.6 * mix(0.35, 1.0, puddle) * ripple * across * along * vFade * uGain * uNight;
        gl_FragColor = vec4(vCol * a, 1.0);
      }
    }
    ${ADDITIVE_TAIL}
  }
`;

export function glowMaterial(
  shared: NeonUniforms,
  mode: GlowMode,
  opts: {
    atlas?: THREE.Texture | null;
    tint?: THREE.Color;
    uniforms?: Record<string, THREE.IUniform>;
  } = {},
): THREE.ShaderMaterial {
  return neonMaterial(shared, {
    additive: true,
    side: THREE.DoubleSide,
    uniforms: {
      uMode: { value: mode },
      uAtlas: { value: opts.atlas ?? null },
      uTint: { value: opts.tint ?? new THREE.Color() },
      uPath: { value: null },
      ...opts.uniforms,
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });
}
