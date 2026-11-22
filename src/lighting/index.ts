// Lighting module (ART_DIRECTION 3, 13.1): time of day, sun / moon key light, hemisphere,
// shadows, exposure, sky dome and the PMREM environment map.
// Runs first every frame and writes the env fields it owns: timeOfDay, sunDirection,
// sunElevation, dayFactor, nightFactor, horizonColor, skyColor, neonGain, windowLitRatio.
// Also owns renderer.toneMappingExposure, renderer.shadowMap policy, scene.environment and
// scene.environmentIntensity.
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
  sunDirectionAt,
  type EnvKey,
  type ShadowFrame,
} from './sun';

const SHADOW_MAP_SIZE = 2048;
/** Re-render the shadow map when the sun has moved this much (radians). */
const SHADOW_SUN_EPS = 0.003;
/** Force a shadow refresh every N frames while the sun is up (animated geometry, late loads). */
const SHADOW_REFRESH_FRAMES = 240;
const LIGHT_DISTANCE = 2500;

function setSrgb(color: THREE.Color, rgb: RGB, scale = 1): THREE.Color {
  return color.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace).multiplyScalar(scale);
}

export function init(ctx: Ctx): CityModuleInstance {
  const { scene, renderer, camera, controls, gui, env } = ctx;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const settings = {
    dayMinutes: 8,
    paused: false,
    shadows: true,
    exposureTrim: 1,
  };

  // --- lights: one key DirectionalLight (sun by day, moon by night) + hemisphere.
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

  // --- sky + environment
  const sky = createSky();
  scene.add(sky.mesh);
  const envMaps = createEnvMaps(renderer);
  let envKey: EnvKey | null = null;

  // --- scratch (no per-frame allocation)
  const moonDir = new THREE.Vector3();
  const tmpDir = { x: 0, y: 0, z: 0 };
  const lastShadowSun = new THREE.Vector3(0, -1, 0);
  let lastShadowFrame: ShadowFrame | null = null;
  let framesSinceShadow = 0;
  let frame = 0;
  let pal: PaletteSample = paletteAt(env.timeOfDay);

  function updateShadowCamera(): void {
    const dist = camera.position.distanceTo(controls.target);
    const f = shadowFrameFor(controls.target.x, controls.target.z, dist);
    const changed =
      !lastShadowFrame ||
      f.cx !== lastShadowFrame.cx ||
      f.cz !== lastShadowFrame.cz ||
      f.half !== lastShadowFrame.half;
    const sunMoved = lastShadowSun.angleTo(env.sunDirection) > SHADOW_SUN_EPS;
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
    if (changed || sunMoved || framesSinceShadow >= SHADOW_REFRESH_FRAMES || frame < 3) {
      renderer.shadowMap.needsUpdate = true;
      lastShadowSun.copy(env.sunDirection);
      framesSinceShadow = 0;
    } else {
      framesSinceShadow++;
    }
  }

  function apply(): void {
    const t = env.timeOfDay;
    pal = paletteAt(t);

    // Sun / moon geometry and the derived factors.
    sunDirectionAt(t, tmpDir);
    env.sunDirection.set(tmpDir.x, tmpDir.y, tmpDir.z);
    env.sunElevation = tmpDir.y;
    moonDirectionAt(t, tmpDir);
    moonDir.set(tmpDir.x, tmpDir.y, tmpDir.z);
    env.dayFactor = dayFactorAt(env.sunElevation);
    env.nightFactor = 1 - env.dayFactor;

    // Palette-driven env fields.
    setSrgb(env.horizonColor, pal.horizonColor);
    setSrgb(env.skyColor, pal.skyColor);
    env.neonGain = pal.neonGain;
    env.windowLitRatio = pal.windowLitRatio;

    // Key light: sun by day, moon by night, crossfaded through zero at the horizon.
    const kl = keyLightAt(env.sunElevation, moonDir.y);
    const dir = kl.body === 'sun' ? env.sunDirection : moonDir;
    const center = lastShadowFrame ?? { cx: 0, cz: 0 };
    key.target.position.set(center.cx, 0, center.cz);
    key.position.copy(dir).multiplyScalar(LIGHT_DISTANCE).add(key.target.position);
    key.target.updateMatrixWorld();
    setSrgb(key.color, pal.sunColor);
    key.intensity = pal.sunIntensity * kl.weight;
    const castShadow =
      settings.shadows && kl.body === 'sun' && pal.shadows > 0.5 && env.sunElevation > 0.02;
    if (castShadow !== key.castShadow) {
      key.castShadow = castShadow;
      renderer.shadowMap.needsUpdate = true;
    }
    if (castShadow) updateShadowCamera();

    setSrgb(hemi.color, pal.hemiSky);
    setSrgb(hemi.groundColor, pal.hemiGround);
    hemi.intensity = pal.hemiIntensity;

    renderer.toneMappingExposure = pal.toneMappingExposure * settings.exposureTrim * env.powerOn;

    // Sky uniforms.
    const u = sky.uniforms;
    setSrgb(u.uZenith.value, pal.skyColor);
    setSrgb(u.uHorizon.value, pal.horizonColor);
    setSrgb(u.uHorizonAnti.value, pal.horizonAntiSun);
    setSrgb(u.uGlow.value, pal.cityGlow, pal.cityGlowIntensity);
    setSrgb(u.uGround.value, pal.fogColor);
    u.uSunDir.value.copy(env.sunDirection);
    setSrgb(u.uSunColor.value, pal.sunColor);
    u.uSunVis.value = Math.min(1, Math.max(0, (env.sunElevation + 0.03) / 0.06));
    u.uMoonDir.value.copy(moonDir);
    // Moon disc / halo tint: the key-light color, which is the moon color whenever it shows.
    setSrgb(u.uMoonColor.value, pal.sunColor);
    u.uMoonVis.value = env.nightFactor * Math.min(1, Math.max(0, moonDir.y / 0.05));

    // Environment map: swap the cached bake when the palette key changes.
    const k = envKeyAt(t);
    if (k !== envKey) {
      envKey = k;
      scene.environment = envMaps.get(k);
    }
    scene.environmentIntensity = pal.envMapIntensity;
  }

  // --- GUI
  const folder = gui.addFolder('Time & Sun');
  folder.add(env, 'timeOfDay', 0, 1, 0.001).name('time of day').listen();
  folder.add(settings, 'dayMinutes', 1, 30, 0.5).name('day length (min)');
  folder.add(settings, 'paused').name('pause cycle');
  folder.add(settings, 'shadows').name('sun shadows');
  folder.add(settings, 'exposureTrim', 0.5, 1.5, 0.01).name('exposure trim');
  const presets = {
    midnight: () => (env.timeOfDay = 0.0),
    dawn: () => (env.timeOfDay = 0.25),
    noon: () => (env.timeOfDay = 0.5),
    sunset: () => (env.timeOfDay = 0.78),
  };
  folder.add(presets, 'midnight').name('Midnight 00:00');
  folder.add(presets, 'dawn').name('Dawn 06:00');
  folder.add(presets, 'noon').name('Noon 12:00');
  folder.add(presets, 'sunset').name('Sunset 18:43');
  folder.close();

  // Populate env before the other modules init and read it.
  apply();

  return {
    update(dt) {
      env.timeOfDay = advanceTime(
        env.timeOfDay,
        dt,
        settings.dayMinutes * 60,
        env.timeLocked || settings.paused,
      );
      apply();
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
