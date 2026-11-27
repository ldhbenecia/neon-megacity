// env.rain eases toward ux-owned env.rainTarget. main seeds both from ?rain, so a ?rain boot
// holds that exact value until the user picks another weather.
import { Color, FogExp2, SRGBColorSpace, Vector3 } from 'three';
import { NIGHT, paletteAt, type PaletteSample, type RGB } from '../core/palette';
import { FOG_UNIFORMS } from '../core/shaders/emissiveFog';
import type { CityModuleInstance, Ctx } from '../core/types';
import { createClouds } from './clouds';
import { installFogChunks } from './fogChunks';
import {
  CLOUD_LAYERS,
  computeFog,
  mapFogScale,
  fogBrightness,
  createQualityState,
  rainAltitudeFade,
  searchlightLevelAt,
  stepQuality,
  stepRain,
  stepWetness,
  sunScatterStrength,
  wetnessTarget,
} from './logic';
import { createPost } from './post';
import { createRain } from './rain';
import { createSearchlights } from './searchlights';
import { createStars } from './stars';

const PALETTE_EPSILON = 1e-4;

const setSrgb = (c: Color, rgb: RGB, k = 1): Color =>
  c.setRGB(rgb[0] * k, rgb[1] * k, rgb[2] * k, SRGBColorSpace);

export function init(ctx: Ctx): CityModuleInstance {
  const { scene, camera, gui, env } = ctx;
  const mapFog = mapFogScale(Math.max(ctx.LAYOUT.extentX, ctx.LAYOUT.extentZ));
  // Low tier (CI SwiftShader): no post chain, rain, clouds or searchlights. Fog and stars stay.
  const low = env.quality === 'ci';

  const settings = {
    fogScale: 1,
    heightFog: true,
    bloomScale: 1,
    lens: true,
    lensDrops: true,
    clouds: !low,
    searchlights: !low,
    stars: true,
    autoQuality: true,
  };

  const uninstallFog = installFogChunks();
  env.fogDensity *= mapFog;
  const fog = new FogExp2(env.fogColor.getHex(), env.fogDensity);
  const previousFog = scene.fog;
  scene.fog = fog;

  env.wetness = Math.max(env.wetness, wetnessTarget(env.rain));

  const searchlights = createSearchlights(ctx);
  const stars = createStars(ctx);
  const clouds = createClouds(ctx, searchlights.spots, searchlights.colors);
  const rain = low ? null : createRain(ctx);
  clouds.setVisible(settings.clouds);
  const post = createPost(ctx);
  const previousRender = ctx.render;
  if (post) ctx.render = () => post.render();
  // main's compile stage calls this instead of renderer.compile: the HDR target needs
  // different program variants than the canvas.
  const userData = scene.userData as { compile?: () => void };
  const warmup = (): void => post?.warmup();
  if (post) userData.compile = warmup;

  const quality = createQualityState();

  const folder = gui.addFolder('Atmosphere');
  folder.add(env, 'rain', 0, 1, 0.01).name('Rain').listen().disable();
  folder.add(settings, 'fogScale', 0, 3, 0.01).name('Fog density ×');
  folder.add(settings, 'heightFog').name('Height fog');
  folder.add(settings, 'bloomScale', 0, 3, 0.01).name('Bloom ×');
  folder.add(settings, 'lens').name('Lens FX');
  folder.add(settings, 'lensDrops').name('Lens drops');
  folder
    .add(settings, 'clouds')
    .name('Clouds')
    .onChange((v: boolean) => clouds.setVisible(v));
  folder.add(settings, 'searchlights').name('Searchlights');
  folder.add(settings, 'stars').name('Stars');
  folder
    .add(settings, 'autoQuality')
    .name('Auto quality')
    .onChange((on: boolean) => {
      if (on) return;
      Object.assign(quality, createQualityState());
      post?.setTier(0);
      rain?.setTier(0);
    });
  folder.add(quality, 'tier', 0, 2, 1).name('Quality tier (0 = full)').listen().disable();
  folder.close();

  let palette: PaletteSample = paletteAt(env.timeOfDay);
  let paletteTime = env.timeOfDay;
  const sunFogColor = new Color();
  const dayLow = new Color();
  const dayHigh = new Color();
  const tmp = new Color();
  const sunColor = new Color();
  const sunDir = new Vector3(0, 1, 0);
  const height = FOG_UNIFORMS.cityFogHeight.value;
  const sun = FOG_UNIFORMS.cityFogSun.value;
  const sunCol = FOG_UNIFORMS.cityFogSunColor.value;
  const postSettings = { strength: 0, radius: 0, threshold: 0, lens: true, drops: 0 };
  const applyPalette = (): void => {
    setSrgb(dayLow, palette.hemiSky).lerp(setSrgb(tmp, palette.horizonColor), 0.5);
    setSrgb(dayHigh, palette.horizonColor, 1.08);
    setSrgb(sunColor, palette.fogSunColor);
  };
  applyPalette();
  const cloudInputs = {
    rain: 0,
    night: 1,
    horizon: env.horizonColor,
    sunDir,
    sunColor,
    sunset: 0,
    dayLow,
    dayHigh,
    fogK: 0,
  };

  return {
    update(dt, elapsed) {
      if (Math.abs(env.timeOfDay - paletteTime) > PALETTE_EPSILON) {
        palette = paletteAt(env.timeOfDay);
        paletteTime = env.timeOfDay;
        applyPalette();
      }
      env.rain = stepRain(env.rain, env.rainTarget, dt);
      const r = env.rain;

      const f = computeFog(palette, r, settings.fogScale * mapFog);
      env.fogDensity = f.density;
      setSrgb(env.fogColor, f.color);
      fog.color.copy(env.fogColor);
      fog.density = f.density;

      // CPU fog callers read this flag through heightFogEnabled().
      height[3] = settings.heightFog ? 1 : 0;
      const ds = env.sunDirection.lengthSq();
      if (ds > 1e-6) sunDir.copy(env.sunDirection).multiplyScalar(1 / Math.sqrt(ds));
      const scatter = sunScatterStrength(env.sunElevation);
      sun[0] = sunDir.x;
      sun[1] = sunDir.y;
      sun[2] = sunDir.z;
      sun[3] = scatter;
      setSrgb(sunFogColor, palette.fogSunColor, fogBrightness(r));
      sunCol[0] = sunFogColor.r;
      sunCol[1] = sunFogColor.g;
      sunCol[2] = sunFogColor.b;

      env.wetness = stepWetness(env.wetness, r, dt);

      const below = rainAltitudeFade(camera.position.y);
      rain?.update(elapsed, r, env.fogColor, below);

      stars.update(elapsed, settings.stars ? palette.stars * (1 - 0.6 * Math.min(1, r)) : 0);

      // Relative to the map-scaled night fog, so a wider map keeps the same beam halo.
      const fogK = Math.min(2, Math.max(0.5, f.density / (NIGHT.fogDensity * mapFog)));
      searchlights.update(
        elapsed,
        settings.searchlights ? searchlightLevelAt(env.timeOfDay) : 0,
        fogK,
        CLOUD_LAYERS.lowY,
      );

      cloudInputs.rain = r;
      cloudInputs.night = env.nightFactor;
      cloudInputs.sunset = scatter * 0.8;
      cloudInputs.fogK = f.density * 0.35;
      clouds.update(elapsed, cloudInputs);

      postSettings.strength = palette.bloomStrength * settings.bloomScale;
      postSettings.radius = palette.bloomRadius;
      postSettings.threshold = palette.bloomThreshold;
      postSettings.lens = settings.lens;
      postSettings.drops = settings.lensDrops ? Math.min(1, r * 1.2) * below : 0;
      post?.update(elapsed, postSettings);

      if (settings.autoQuality && stepQuality(quality, dt)) {
        post?.setTier(quality.tier);
        rain?.setTier(quality.tier);
      }
    },
    dispose() {
      if (userData.compile === warmup) delete userData.compile;
      // Shared uniforms outlive this module in compiled materials: back to the defaults.
      height[3] = 1;
      sun.set([0, 1, 0, 0]);
      sunCol.fill(0);
      ctx.render = previousRender;
      post?.dispose();
      rain?.dispose();
      clouds.dispose();
      stars.dispose();
      searchlights.dispose();
      if (scene.fog === fog) scene.fog = previousFog;
      uninstallFog();
      folder.destroy();
    },
  };
}
