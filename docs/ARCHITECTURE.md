# Architecture

## Module contract

Every feature lives in its own folder under `src/` and exposes from `index.ts` (types in `src/core/types.ts`):

```ts
import type { Ctx, CityModuleInstance } from '../core/types';

export function init(ctx: Ctx): CityModuleInstance {
  /* build objects, add to ctx.scene */ return { update(dt, elapsed) {}, dispose() {} };
}
```

`src/main.ts` calls `init` in this order: **lighting → terrain → buildings → infra → neon → atmosphere**, and each frame runs
`ux.beforeUpdate` (camera rig) → every module's `update` in the same order → `ux.afterUpdate` (HUD) → `ctx.render()`.
`src/ux/` is not in the module list: main drives it directly (`createLoader()` for boot stages, `initUx(ctx)` for the
camera rig and HUD), so feature PRs never need to edit `src/main.ts`.

## Shared context (`ctx`)

| key                                             | meaning                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `THREE, scene, camera, renderer, controls, gui` | three.js objects; `gui` is lil-gui with `?debug`, otherwise a chainable no-op stand-in (add your folder, never read values back)                  |
| `CITY, LAYOUT`                                  | constants and the deterministic layout v2 from `src/city/layout.ts` (read only)                                                                   |
| `env`                                           | shared environment state, one owner per field (table below)                                                                                       |
| `buildings`                                     | `BuildingsApi` published by buildings during its init; undefined before that                                                                      |
| `infra`                                         | `InfraApi` published by infra during its init (drawn highway curves, `deckHeightAt`, optional `railTracks` and `fountainNozzles`); else undefined |
| `render()`                                      | default `renderer.render`; atmosphere replaces with the post-processing composer                                                                  |
| `onResize(fn)`                                  | register `(w, h) => {}`                                                                                                                           |
| `onQuality(fn)`                                 | register `(quality) => {}` for runtime `env.quality` changes; returns the unsubscribe function                                                    |

### `ctx.env` fields and owners

Only the owner writes a field; everyone else reads it. Types and comments live in `src/core/types.ts`.

| field                          | owner      | meaning                                                                 |
| ------------------------------ | ---------- | ----------------------------------------------------------------------- |
| `timeOfDay`                    | lighting\* | 0..1, 0 = midnight, 0.5 = noon. Initial value from `?time`              |
| `timeLocked`                   | ux (main)  | true when `?time=` was given; lighting must not advance `timeOfDay`     |
| `quality`                      | ux (main)  | `'high' \| 'medium' \| 'low'` (user, may change) or `'ci'` (CI, fixed)  |
| `sunDirection`, `sunElevation` | lighting   | unit vector toward the sun, and its y                                   |
| `dayFactor`, `nightFactor`     | lighting   | 0..1 smooth blend, sum to 1                                             |
| `horizonColor`, `skyColor`     | lighting   | sky colors (palette)                                                    |
| `horizonAntiColor`             | lighting   | horizon away from the sun (optional; set in lighting init)              |
| `fillFactor`, `fillColor`      | lighting   | shadow fill: weight 0..1 (night and late sunset) and its linear color   |
| `neonGain`                     | lighting   | sign brightness multiplier: night 1.0, sunset 0.7, day 0.3              |
| `windowLitRatio`               | lighting   | city-wide lit window ratio; buildings applies per-district factors      |
| `rain`                         | atmosphere | 0..1 rain intensity this frame, eased toward `rainTarget`               |
| `rainTarget`                   | ux         | 0..1 rain the user picked (weather buttons). Initial value from `?rain` |
| `wetness`                      | atmosphere | 0..1 surface wetness (road roughness, reflection decals)                |
| `fogColor`, `fogDensity`       | atmosphere | final FogExp2 color / density this frame (palette base × rain)          |
| `powerOn`                      | ux         | 0..1 boot fade-in; lighting multiplies exposure, neon lights up by zone |
| `selectedBuilding`             | ux         | picked building id or null; neon draws the highlight                    |

\* Exception: while `timeLocked` is true, ux writes `timeOfDay` from the timeline scrubber. Lighting does not
advance `timeOfDay` while locked, so the two never write it in the same frame.

Colors and tuning numbers come from `src/core/palette.ts` (`paletteAt(t)`, `NEON`, `WINDOW_LIT`, `MATERIAL`, …);
do not hard-code hex values in modules. Emissive materials use `applyEmissiveFog` from `src/core/shaders/emissiveFog.ts`.

### Renderer and scene state owned by lighting

Besides its `env` fields, lighting owns a few pieces of shared renderer / scene state. Others read them, never write them.

| state                                                      | meaning                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scene.environment`                                        | PMREM environment map (teal dome + neon panel band), baked once per palette key at init (4 bakes). `MeshStandardMaterial`s get it free                                                                                                                                      |
| `scene.environmentIntensity`                               | palette `envMapIntensity` (night 0.6 → day 1.0)                                                                                                                                                                                                                             |
| `renderer.toneMappingExposure`                             | palette `toneMappingExposure × env.powerOn`                                                                                                                                                                                                                                 |
| `renderer.shadowMap` (`type`, `autoUpdate`, `needsUpdate`) | `autoUpdate = false`; lighting sets `needsUpdate` when the shadow frustum moves or the sun moves ≥ 0.5° (≤ 1 Hz). Others set `castShadow` / `receiveShadow` on meshes and ask for a redraw only through `ctx.requestShadowUpdate()` (lighting skips it without sun shadows) |

The only moon disc is drawn by lighting's sky dome; atmosphere draws stars (and clouds) over it.

## URL query hooks

Parsed by `parseQuery` in `src/core/query.ts` (pure, unit tested) and applied by `src/main.ts`.
They exist for deterministic screenshots, e2e tests and debugging.

| param         | effect                                                                            |
| ------------- | --------------------------------------------------------------------------------- |
| `?time=0..1`  | initial `env.timeOfDay` and sets `env.timeLocked = true` (cycle paused)           |
| `?cam=name`   | camera preset from `CAMERA_PRESETS`: overview, street, core, topdown, skyline     |
| `?rain=0..1`  | initial `env.rain` and `env.rainTarget`                                           |
| `?nogui`      | hides the lil-gui panel                                                           |
| `?quality=ci` | software-GL test tier for CI e2e: see below; `high\|medium\|low` pick a user tier |

Numbers are clamped to 0..1; invalid values are ignored.

`src/ux/query.ts` (`parseUxQuery`, applied by `src/ux/index.ts`) adds ux-only hooks:

| param                        | effect                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `?pose=px,py,pz,tx,ty,tz`    | initial camera position and target; wins over `?cam` and `?preset` (see below) |
| `?preset=1..8`               | rig preset (number keys)                                                       |
| `?hud=0`, `?stats`, `?debug` | hide the HUD, show the perf overlay and `window.__hangang`, show lil-gui       |

`?pose=` is used only with 6 finite numbers whose distance is within `CAMERA_LIMITS`
(20..maxDistance m). It then goes through `safePose` (outside buildings, above ground, within
`maxPolarAngle`, so keep the target below the camera for an exact pose) and is dropped if that
pulls it out of the distance limits. Like `?cam`, it disables the intro dolly and idle cinematic.

`env.quality === 'ci'` is the CI tier (SwiftShader renders the full city at a few fps). Quality
branches are owned by perf and stay minimal: DPR 0.5 and no MSAA (ux/main), no shadow map and one
lazy 64 px PMREM bake (lighting), no post chain, rain, clouds or searchlights (atmosphere; fog and
stars stay), flat river water without noise normals (terrain). All e2e specs use it through
`app()` in `tests/e2e/helpers.ts`, except one full-quality budget check in `perf.spec.ts`
(overview at noon, shadow pass included).

## Test hook: `window.__city`

`src/main.ts` sets `window.__city = { ready: true, frames }` at the end of every frame (the type lives in `src/global.d.ts`, which both tsconfigs include).
The Playwright e2e tests (`tests/e2e/`) and the screenshot script (`scripts/screenshot.ts`, `npm run shots`)
wait on it before asserting or capturing. Keep it in place.

## Coordinates and layout

Y up, ground at `y = 0`, 1 unit = 1 m, north = -Z, east = +X. The map spans `[-1200, 1200]` on X and Z (`CITY.extent = 2400`).
`rotY` / `gridAngle` follow three.js `rotation.y`; `w` is the local X extent and `d` the local Z extent.

`LAYOUT` is published once at boot: `src/boot.ts` (the entry in `index.html`) generates it in the city worker (`src/city/loadLayout.ts`, main-thread fallback), while the app chunks (`src/main.ts` and its imports) are evaluated in parallel, then calls `setLayout` and `start()`. It is `undefined` until then, so no module may read it while it is evaluated (`tests/layout-import.test.ts`); derive layout constants on first use. Tests publish it in `tests/setup-layout.ts`. The layout must stay plain data (no class instances or functions) so the worker's structured clone keeps it intact (`tests/load-layout.test.ts`).

`src/city/` is the single source of truth (data types in `src/city/types.ts`, all re-exported by `src/city/layout.ts`):

| data               | what                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `LAYOUT.districts` | zone polygons partitioning the map (`zoneAt`, `districtAt`), each with its own rotated road grid |
| `LAYOUT.river`     | 한강 centerline (33 points), channel 240 m incl. 40 m parks, water y -4                          |
| `LAYOUT.bridges`   | 3 bridges: abutments `a/b`, approach landings `landA/landB`, deck heights                        |
| `LAYOUT.highways`  | Catmull-Rom control points (`highwayCurve`), pillars, no-build corridor                          |
| `LAYOUT.ridges`    | 3 far ridge rings (`ridgeHeight`, `ridgePoint`)                                                  |
| `LAYOUT.roads`     | straight segments in any direction (`a`, `b`, `width`, `kind`)                                   |
| `LAYOUT.buildings` | `BuildingSpec`: footprint, `rotY`, `baseY`, archetype, `tiers` (setbacks), tags                  |
| `LAYOUT.slots`     | street prop slots (street lights, trees, sign poles, 포장마차, bus stops, stair lamps)           |

Pure queries: `terrainHeight`, `surfaceHeight`, `riverSignedDistance`, `buildingsInAabb`, `buildingContaining`,
`raycastBuildings`, `buildingFaces`, `deckHeightAt`. Never place objects with hard-coded coordinates that bypass them.

## Ownership

| folder            | owner                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `src/city/`       | layout v2: zones, river, bridges, highways, roads, buildings, slots, pure queries (2 reviewers)   |
| `src/lighting/`   | sky, sun/moon, hemisphere, shadows, exposure, environment map; also `src/core/palette.ts`         |
| `src/terrain/`    | ground heightfield, river water, embankments and parks, far ridges and their beacons              |
| `src/buildings/`  | roads, sidewalks, stairs, building geometry, window shader, rooftop/facade props, trees, LOD      |
| `src/infra/`      | elevated highway decks, pillars, ramps, sound walls, the three bridges                            |
| `src/neon/`       | signs, screens, holograms, halos, street lights, reflections, traffic, PointLights, selection     |
| `src/atmosphere/` | fog chunks, rain, clouds, stars, searchlights, post-processing; `src/core/shaders/emissiveFog.ts` |
| `src/ux/`         | loader, camera rig, HUD, favicon, `?stats`; boot/loop in `src/main.ts`, `scripts/`, `tests/e2e/`  |

## CI and deployment

| workflow                         | trigger                                                   | what it does                                                                                                                                                                                                                       |
| -------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`       | pull_request, push to main, dispatch                      | job `check` (format, lint, typecheck, unit tests, build, size) always; job `smoke` (`tests/e2e/smoke.spec.ts`) on main only. A newer commit on the same PR or on main cancels the run in progress; Pages deploys a green main head |
| `.github/workflows/e2e-full.yml` | dispatch (manual only)                                    | the full Playwright suite (ux, overlays, perf budget, smoke), 2 shards                                                                                                                                                             |
| `.github/workflows/autofix.yml`  | pull_request (same-repo only)                             | `lint:fix` + `format`; if anything changed, commits `style: 린트 및 포맷 자동 수정` as github-actions[bot], pushes to the PR branch and dispatches `ci.yml` for it (GITHUB_TOKEN pushes do not trigger CI)                         |
| `.github/workflows/pages.yml`    | CI succeeded on a push to main (`workflow_run`), dispatch | deploys only if the tested commit is still main's head (a failing newest commit pauses deploys), builds it with `BASE_PATH=/neon-megacity/` and deploys `dist/`; dispatch only from main                                           |

Local e2e, `npm run shots` and `npm run perf` each serve `dist/` on a per-worktree port
(`localPort` in `tests/e2e/helpers.ts`, 4200–4979, never reusing a running server). If two worktrees
hash to the same port the server fails to start: set `E2E_PORT`, `SHOTS_PORT` or `PERF_PORT`.

`vite.config.ts` uses `base: process.env.BASE_PATH ?? './'`, so dev, preview, e2e and screenshots run with a relative base.
