import * as THREE from 'three';
import { paletteAt, type PaletteSample, type RGB } from '../core/palette';
import type { Ctx, CityModuleInstance } from '../core/types';
import { createEnvMaps } from './envMap';
import { createSky } from './sky';
import {
  advanceTime,
  dayFactorAt,
  envKeyAt,
  keyLightAt,
  moonDirectionAt,
  shadowFrameFor,
  shouldRefreshShadow,
  sunDirectionAt,
  type EnvKey,
  type ShadowFrame,
} from './sun';

const SHADOW_MAP_SIZE = 2048;
const LIGHT_DISTANCE = 2500;
const ORIGIN_FRAME = { cx: 0, cz: 0 } as const;
const TIME_PRESETS: readonly (readonly [label: string, timeOfDay: number])[] = [
  ['Midnight 00:00', 0],
  ['Dawn 06:00', 0.25],
  ['Noon 12:00', 0.5],
  ['Sunset 18:43', 0.78],
];

function setSrgb(color: THREE.Color, rgb: RGB, scale = 1): THREE.Color {
  return color.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace).multiplyScalar(scale);
}

export function init(ctx: Ctx): CityModuleInstance {
  const { scene, renderer, camera, controls, gui, env } = ctx;

  const low = env.quality === 'low';
  renderer.shadowMap.enabled = !low;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const settings = {
    dayMinutes: 8,
    paused: false,
    shadows: !low,
    exposureTrim: 1,
  };

  const key = new THREE.DirectionalLight(0xffffff, 0);
  key.name = 'keyLight';
  key.castShadow = false;
  key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  key.shadow.bias = -0.0004;
  key.shadow.radius = 1.5;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = LIGHT_DISTANCE * 2;
  scene.add(key, key.target);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0);
  hemi.name = 'hemiLight';
  scene.add(hemi);

  const sky = createSky();
  scene.add(sky.mesh);
  const envMaps = createEnvMaps(renderer, low ? 64 : 256);
  let envKey: EnvKey | null = null;

  const moonDir = new THREE.Vector3();
  const horizonAnti = new THREE.Color();
  env.horizonAntiColor = horizonAnti;
  const lastShadowSun = new THREE.Vector3(0, -1, 0);
  let lastShadowFrame: ShadowFrame | null = null;
  let secondsSinceShadow = 0;
  let frame = 0;
  let pal: PaletteSample = paletteAt(env.timeOfDay);
  let palTime = env.timeOfDay;

  function updateShadowCamera(dt: number): void {
    const dist = camera.position.distanceTo(controls.target);
    const f = shadowFrameFor(controls.target.x, controls.target.z, dist);
    const changed =
      !lastShadowFrame ||
      f.cx !== lastShadowFrame.cx ||
      f.cz !== lastShadowFrame.cz ||
      f.half !== lastShadowFrame.half;
    if (changed) {
      const sc = key.shadow.camera;
      sc.left = -f.half;
      sc.right = f.half;
      sc.top = f.half;
      sc.bottom = -f.half;
      sc.updateProjectionMatrix();
      // ~0.7 texel of normal offset kills acne on large flat roofs without peter-panning.
      key.shadow.normalBias = ((2 * f.half) / SHADOW_MAP_SIZE) * 0.7;
      lastShadowFrame = f;
    }
    secondsSinceShadow += dt;
    const sunAngle = lastShadowSun.angleTo(env.sunDirection);
    if (shouldRefreshShadow(changed, sunAngle, secondsSinceShadow, frame < 3)) {
      renderer.shadowMap.needsUpdate = true;
      lastShadowSun.copy(env.sunDirection);
      secondsSinceShadow = 0;
    }
  }

  function apply(dt: number): void {
    const t = env.timeOfDay;
    // paletteAt allocates; only resample when the time actually moved (never while locked).
    if (t !== palTime) {
      pal = paletteAt(t);
      palTime = t;
    }

    sunDirectionAt(t, env.sunDirection);
    env.sunElevation = env.sunDirection.y;
    moonDirectionAt(t, moonDir);
    env.dayFactor = dayFactorAt(env.sunElevation);
    env.nightFactor = 1 - env.dayFactor;

    setSrgb(env.horizonColor, pal.horizonColor);
    setSrgb(env.skyColor, pal.skyColor);
    setSrgb(horizonAnti, pal.horizonAntiSun);
    env.neonGain = pal.neonGain;
    env.windowLitRatio = pal.windowLitRatio;

    const kl = keyLightAt(env.sunElevation, moonDir.y);
    const castShadow =
      settings.shadows && kl.body === 'sun' && pal.shadows > 0.5 && env.sunElevation > 0.02;
    if (castShadow !== key.castShadow) {
      key.castShadow = castShadow;
      renderer.shadowMap.needsUpdate = true;
    }
    // Shadow frustum first, so the light target below already sits on this frame's frustum.
    if (castShadow) updateShadowCamera(dt);
    const dir = kl.body === 'sun' ? env.sunDirection : moonDir;
    const center = lastShadowFrame ?? ORIGIN_FRAME;
    key.target.position.set(center.cx, 0, center.cz);
    key.position.copy(dir).multiplyScalar(LIGHT_DISTANCE).add(key.target.position);
    key.target.updateMatrixWorld();
    setSrgb(key.color, pal.sunColor);
    key.intensity = pal.sunIntensity * kl.weight;

    setSrgb(hemi.color, pal.hemiSky);
    setSrgb(hemi.groundColor, pal.hemiGround);
    hemi.intensity = pal.hemiIntensity;

    renderer.toneMappingExposure = pal.toneMappingExposure * settings.exposureTrim * env.powerOn;

    const u = sky.uniforms;
    setSrgb(u.uZenith.value, pal.skyColor);
    setSrgb(u.uHorizon.value, pal.horizonColor);
    u.uHorizonAnti.value.copy(horizonAnti);
    setSrgb(u.uGlow.value, pal.cityGlow, pal.cityGlowIntensity);
    setSrgb(u.uGround.value, pal.fogColor);
    u.uSunDir.value.copy(env.sunDirection);
    setSrgb(u.uSunColor.value, pal.sunColor);
    u.uSunVis.value = THREE.MathUtils.clamp((env.sunElevation + 0.03) / 0.06, 0, 1);
    u.uMoonDir.value.copy(moonDir);
    setSrgb(u.uMoonColor.value, pal.sunColor);
    u.uMoonVis.value = env.nightFactor * THREE.MathUtils.clamp(moonDir.y / 0.05, 0, 1);

    const k = envKeyAt(t);
    if (k !== envKey) {
      envKey = k;
      scene.environment = envMaps.get(k);
    }
    scene.environmentIntensity = pal.envMapIntensity;
  }

  const folder = gui.addFolder('Time & Sun');
  folder.add(env, 'timeOfDay', 0, 1, 0.001).name('time of day').listen();
  folder.add(settings, 'dayMinutes', 1, 30, 0.5).name('day length (min)');
  folder.add(settings, 'paused').name('pause cycle');
  const shadowToggle = folder.add(settings, 'shadows').name('sun shadows');
  if (low) shadowToggle.disable();
  folder.add(settings, 'exposureTrim', 0.5, 1.5, 0.01).name('exposure trim');
  for (const [label, time] of TIME_PRESETS) {
    folder.add({ go: () => (env.timeOfDay = time) }, 'go').name(label);
  }
  folder.close();

  // Baking mid-session stalls a frame, so every key is baked at boot (low quality bakes lazily).
  if (!low) envMaps.bakeAll();
  // Other modules read env during their own init.
  apply(0);

  return {
    update(dt) {
      env.timeOfDay = advanceTime(
        env.timeOfDay,
        dt,
        settings.dayMinutes * 60,
        env.timeLocked || settings.paused,
      );
      apply(dt);
      frame++;
    },
    dispose() {
      folder.destroy();
      scene.remove(key, key.target, hemi, sky.mesh);
      key.dispose();
      hemi.dispose();
      sky.dispose();
      scene.environment = null;
      envMaps.dispose();
      renderer.shadowMap.autoUpdate = true;
    },
  };
}
