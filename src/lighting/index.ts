import * as THREE from 'three';
import {
  DAY_SKY_FILL,
  NIGHT_FILL_AMBIENT,
  paletteAt,
  type PaletteSample,
  type RGB,
} from '../core/palette';
import type { Ctx, CityModuleInstance } from '../core/types';
import { createEnvMaps } from './envMap';
import { createSky } from './sky';
import {
  advanceTime,
  dayFactorAt,
  fillColorAt,
  fillFactorAt,
  envKeyAt,
  keyLightAt,
  moonDirectionAt,
  shadowFrameFor,
  shadowKnobs,
  shadowRequestDue,
  shouldRefreshShadow,
  skyFillAt,
  sunDirectionAt,
  type EnvKey,
  type ShadowFrame,
} from './sun';

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

  const low = env.quality === 'ci';
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
  // castShadow never toggles at runtime: flipping it changes every lit material's program variant
  // (0.6–1.3 s stall with buildings on a day/night scrub). When sun shadows are off (setting,
  // sunset, night) shadow.intensity goes to 0 and the map stops refreshing instead. Trade-off: lit
  // materials keep sampling the map; pre-compiling both variants would exceed 50 programs.
  key.castShadow = !low;
  key.shadow.intensity = 0;
  let shadow = shadowKnobs(env.quality);
  key.shadow.mapSize.set(shadow.mapSize, shadow.mapSize);
  key.shadow.bias = -0.0004;
  key.shadow.radius = 1.5;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = LIGHT_DISTANCE * 2;
  scene.add(key, key.target);
  // A new map size takes a dispose and reallocation of the map (same program); the frustum fit
  // and normal bias follow on the next shadow update.
  const offQuality = ctx.onQuality((q) => {
    if (low) return;
    const next = shadowKnobs(q);
    if (next.mapSize !== shadow.mapSize) {
      key.shadow.map?.dispose();
      key.shadow.map = null;
      key.shadow.mapSize.set(next.mapSize, next.mapSize);
      resized = true;
    }
    shadow = next;
    renderer.shadowMap.needsUpdate = true;
  });

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
  const fillColor = new THREE.Color(0, 0, 0);
  const fillRgb: [number, number, number] = [0, 0, 0];
  env.fillColor = fillColor;
  env.fillFactor = 0;
  const skyFill = new THREE.Color(0, 0, 0);
  const skyFillRgb: [number, number, number] = [0, 0, 0];
  env.skyFill = skyFill;
  const lastShadowSun = new THREE.Vector3(0, -1, 0);
  let lastShadowFrame: ShadowFrame | null = null;
  // Set when the map size changes: the next shadow update refits the bias and redraws the map
  // while the frustum (and the light target) stays where it is.
  let resized = false;
  let secondsSinceShadow = 0;
  let requested = false;
  const defaultRequest = ctx.requestShadowUpdate;
  ctx.requestShadowUpdate = () => {
    requested = true;
  };
  let frame = 0;
  let pal: PaletteSample = paletteAt(env.timeOfDay);
  let palTime = env.timeOfDay;

  function updateShadowCamera(dt: number, asked: boolean): void {
    const dist = camera.position.distanceTo(controls.target);
    const f = shadowFrameFor(controls.target.x, controls.target.z, dist);
    const changed =
      resized ||
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
      key.shadow.normalBias = ((2 * f.half) / shadow.mapSize) * 0.7;
      lastShadowFrame = f;
      resized = false;
    }
    secondsSinceShadow += dt;
    const sunAngle = lastShadowSun.angleTo(env.sunDirection);
    if (
      asked ||
      shouldRefreshShadow(changed, sunAngle, secondsSinceShadow, frame < 3, shadow.minInterval)
    ) {
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
    env.fillFactor = fillFactorAt(env.sunElevation);

    setSrgb(env.horizonColor, pal.horizonColor);
    setSrgb(env.skyColor, pal.skyColor);
    setSrgb(horizonAnti, pal.horizonAntiSun);
    const zenith = env.skyColor;
    fillColorAt(env.sunElevation, [zenith.r, zenith.g, zenith.b], NIGHT_FILL_AMBIENT, fillRgb);
    fillColor.setRGB(fillRgb[0], fillRgb[1], fillRgb[2]);
    skyFillAt(env.sunElevation, [zenith.r, zenith.g, zenith.b], DAY_SKY_FILL, skyFillRgb);
    skyFill.setRGB(skyFillRgb[0], skyFillRgb[1], skyFillRgb[2]);
    env.neonGain = pal.neonGain;
    env.windowLitRatio = pal.windowLitRatio;

    const kl = keyLightAt(env.sunElevation, moonDir.y);
    const sunShadow =
      settings.shadows &&
      shadow.sunShadows &&
      kl.body === 'sun' &&
      pal.shadows > 0.5 &&
      env.sunElevation > 0.02;
    const shadowIntensity = sunShadow ? 1 : 0;
    if (shadowIntensity !== key.shadow.intensity) {
      key.shadow.intensity = shadowIntensity;
      if (sunShadow) renderer.shadowMap.needsUpdate = true;
    }
    // Shadow frustum first, so the light target below already sits on this frame's frustum.
    // Requests are dropped without sun shadows; the map is redrawn when they come back on.
    const asked = shadowRequestDue(requested, sunShadow);
    requested = false;
    if (sunShadow) updateShadowCamera(dt, asked);
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

  // Baking mid-session stalls a frame, so every key is baked at boot (the ci tier bakes lazily).
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
      ctx.requestShadowUpdate = defaultRequest;
      offQuality();
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
