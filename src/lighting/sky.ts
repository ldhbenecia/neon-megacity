// Lighting owns the only moon disc; atmosphere draws stars on top.
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

  vec2 sxz = uSunDir.xz;
  float sl = length(sxz);
  float side = sl > 1e-4 ? dot(normalize(dir.xz + 1e-6), sxz / sl) * 0.5 + 0.5 : 0.5;
  vec3 horizon = mix(uHorizonAnti, uHorizon, pow(side, 2.2));

  float up = max(h, 0.0);
  vec3 col = mix(horizon, uZenith, 1.0 - exp(-up * 3.2));
  col += uGlow * exp(-up / 0.075);

  float cs = max(dot(dir, uSunDir), 0.0);
  float horizonMask = smoothstep(-0.015, 0.01, h);
  float disc = smoothstep(0.99990, 0.99994, cs) * horizonMask;
  vec3 sun = uSunColor * (disc * 18.0 + pow(cs, 600.0) * 1.2 + pow(cs, 32.0) * 0.07);
  col += sun * uSunVis;

  float cm = dot(dir, uMoonDir);
  if (uMoonVis > 0.0) {
    vec3 mu = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-5));
    vec3 mv = cross(mu, uMoonDir);
    vec2 uv = vec2(dot(dir, mu), dot(dir, mv)) / 0.021;
    float r = length(uv);
    float inDisc = 1.0 - smoothstep(0.92, 1.0, r);
    float shade = 0.72 + 0.28 * vnoise(uv * 3.0 + 7.0) - 0.18 * smoothstep(0.55, 0.9, vnoise(uv * 6.5));
    float lit = smoothstep(-0.15, 0.12, length(uv - vec2(-1.25, 0.3)) - 1.0);
    float moon = inDisc * shade * mix(0.25, 1.0, lit);
    float halo = pow(max(cm, 0.0), 900.0) * 0.5 + pow(max(cm, 0.0), 60.0) * 0.06;
    col += uMoonColor * (moon * 2.4 + halo) * uMoonVis * horizonMask;
  }

  col = mix(col, uGround, smoothstep(0.0, -0.06, h));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Dither must be one sRGB step: in a linear target (composer) it is applied in sRGB space,
  // otherwise it sparkles after OutputPass.
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
  const geometry = new THREE.SphereGeometry(10, 32, 16);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  // z = w plus last opaque object: early-z skips every pixel the city already covers.
  mesh.renderOrder = 1e6;
  mesh.matrixAutoUpdate = false;
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
