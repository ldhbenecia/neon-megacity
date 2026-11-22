// Sky dome (ART_DIRECTION 3.1, 7.5): zenith → horizon gradient with a sun-side / anti-sun horizon
// split, the teal city-light dome in the lowest 12°, and the sun and moon discs. Lighting owns the
// only moon disc; atmosphere draws stars (and clouds) on top.
//
// One draw call. The dome is centered on the camera and pushed to the far plane (z = w), drawn as
// the LAST opaque object so depth testing skips every pixel already covered by the city.
import * as THREE from 'three';

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
  gl_Position = p.xyww;
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHorizonAnti;
uniform vec3 uGlow;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunVis;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform float uMoonVis;
uniform float uLinearOut;
varying vec3 vDir;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;

  // Horizon color depends on the bearing relative to the sun: orange only on the sun side at
  // sunset, teal on the far side (identical colors at night and noon).
  vec2 sxz = uSunDir.xz;
  float sl = length(sxz);
  float side = sl > 1e-4 ? dot(normalize(dir.xz + 1e-6), sxz / sl) * 0.5 + 0.5 : 0.5;
  vec3 horizon = mix(uHorizonAnti, uHorizon, pow(side, 2.2));

  float up = max(h, 0.0);
  vec3 col = mix(horizon, uZenith, 1.0 - exp(-up * 3.2));
  // City light dome (light pollution) in the first ~12° above the horizon.
  col += uGlow * exp(-up / 0.075);

  // Sun: tight disc, warm halo and a broad scattering lobe near the horizon.
  float cs = max(dot(dir, uSunDir), 0.0);
  float horizonMask = smoothstep(-0.015, 0.01, h);
  float disc = smoothstep(0.99990, 0.99994, cs) * horizonMask;
  vec3 sun = uSunColor * (disc * 18.0 + pow(cs, 600.0) * 1.2 + pow(cs, 32.0) * 0.07);
  col += sun * uSunVis;

  // Moon: mottled, slightly gibbous disc with a cold halo.
  float cm = dot(dir, uMoonDir);
  if (uMoonVis > 0.0) {
    vec3 mu = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-5));
    vec3 mv = cross(mu, uMoonDir);
    vec2 uv = vec2(dot(dir, mu), dot(dir, mv)) / 0.021; // ~1.2° radius
    float r = length(uv);
    float inDisc = 1.0 - smoothstep(0.92, 1.0, r);
    float shade = 0.72 + 0.28 * vnoise(uv * 3.0 + 7.0) - 0.18 * smoothstep(0.55, 0.9, vnoise(uv * 6.5));
    float lit = smoothstep(-0.15, 0.12, length(uv - vec2(-1.25, 0.3)) - 1.0);
    float moon = inDisc * shade * mix(0.25, 1.0, lit);
    float halo = pow(max(cm, 0.0), 900.0) * 0.5 + pow(max(cm, 0.0), 60.0) * 0.06;
    col += uMoonColor * (moon * 2.4 + halo) * uMoonVis * horizonMask;
  }

  // Below the horizon: fade to the ground haze (terrain and ridges normally cover this).
  col = mix(col, uGround, smoothstep(0.0, -0.06, h));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Dither: the night gradient spans only ~40 sRGB steps and bands badly without it. The noise
  // is one 8-bit sRGB step; when rendering into a linear target (post-processing composer) it is
  // applied in sRGB and converted back, so it stays one display step instead of sparkling.
  float dither = (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  if (uLinearOut > 0.5) {
    vec3 s = pow(max(gl_FragColor.rgb, 0.0), vec3(1.0 / 2.2));
    gl_FragColor.rgb = pow(max(s + dither, 0.0), vec3(2.2));
  } else {
    gl_FragColor.rgb += dither;
  }
}
`;

export interface SkyUniforms {
  uZenith: THREE.IUniform<THREE.Color>;
  uHorizon: THREE.IUniform<THREE.Color>;
  uHorizonAnti: THREE.IUniform<THREE.Color>;
  uGlow: THREE.IUniform<THREE.Color>;
  uGround: THREE.IUniform<THREE.Color>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uSunVis: THREE.IUniform<number>;
  uMoonDir: THREE.IUniform<THREE.Vector3>;
  uMoonColor: THREE.IUniform<THREE.Color>;
  uMoonVis: THREE.IUniform<number>;
  uLinearOut: THREE.IUniform<number>;
}

export interface Sky {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  uniforms: SkyUniforms;
  dispose(): void;
}

export function createSky(): Sky {
  const uniforms: SkyUniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uHorizonAnti: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uSunVis: { value: 0 },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonColor: { value: new THREE.Color() },
    uMoonVis: { value: 0 },
    uLinearOut: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    name: 'RamhaSky',
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  // Low-poly is enough: the gradient is per pixel. Radius is irrelevant (far plane).
  const geometry = new THREE.SphereGeometry(10, 32, 16);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  // Last opaque object: early-z rejects every pixel the city already covers.
  mesh.renderOrder = 1e6;
  mesh.matrixAutoUpdate = false;
  // Linear render target (EffectComposer) vs the sRGB canvas / OutputPass: pick the dither space.
  mesh.onBeforeRender = (renderer) => {
    const target = renderer.getRenderTarget();
    uniforms.uLinearOut.value =
      target && target.texture.colorSpace !== THREE.SRGBColorSpace ? 1 : 0;
  };
  return {
    mesh,
    uniforms,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
