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

| key                                             | meaning                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `THREE, scene, camera, renderer, controls, gui` | standard three.js objects, `gui` is lil-gui (add your own folder)                              |
| `CITY, LAYOUT`                                  | constants and the deterministic layout v2 from `src/city/layout.ts` (read only)                |
| `env`                                           | shared environment state, one owner per field (table below)                                    |
| `buildings`                                     | `BuildingsApi` published by buildings during its init; undefined before that                   |
| `infra`                                         | `InfraApi` published by infra during its init (highway curves, `deckHeightAt`); else undefined |
| `render()`                                      | default `renderer.render`; atmosphere replaces with the post-processing composer               |
| `onResize(fn)`                                  | register `(w, h) => {}`                                                                        |

### `ctx.env` fields and owners

Only the owner writes a field; everyone else reads it. Types and comments live in `src/core/types.ts`.

| field                          | owner      | meaning                                                                 |
| ------------------------------ | ---------- | ----------------------------------------------------------------------- |
| `timeOfDay`                    | lighting   | 0..1, 0 = midnight, 0.5 = noon. Initial value from `?time`              |
| `timeLocked`                   | ux (main)  | true when `?time=` was given; lighting must not advance `timeOfDay`     |
| `sunDirection`, `sunElevation` | lighting   | unit vector toward the sun, and its y                                   |
| `dayFactor`, `nightFactor`     | lighting   | 0..1 smooth blend, sum to 1                                             |
| `horizonColor`, `skyColor`     | lighting   | sky colors (palette)                                                    |
| `neonGain`                     | lighting   | sign brightness multiplier: night 1.0, sunset 0.7, day 0.3              |
| `windowLitRatio`               | lighting   | city-wide lit window ratio; buildings applies per-district factors      |
| `rain`                         | atmosphere | 0..1 rain intensity. Initial value from `?rain` (default 0.35)          |
| `wetness`                      | atmosphere | 0..1 surface wetness (road roughness, reflection decals)                |
| `fogColor`, `fogDensity`       | atmosphere | final FogExp2 color / density this frame (palette base × rain)          |
| `powerOn`                      | ux         | 0..1 boot fade-in; lighting multiplies exposure, neon lights up by zone |
| `selectedBuilding`             | ux         | picked building id or null; neon draws the highlight                    |

Colors and tuning numbers come from `src/core/palette.ts` (`paletteAt(t)`, `NEON`, `WINDOW_LIT`, `MATERIAL`, …);
do not hard-code hex values in modules. Emissive materials use `applyEmissiveFog` from `src/core/shaders/emissiveFog.ts`.

## URL query hooks

Parsed by `parseQuery` in `src/core/query.ts` (pure, unit tested) and applied by `src/main.ts`.
They exist for deterministic screenshots, e2e tests and debugging.

| param        | effect                                                                        |
| ------------ | ----------------------------------------------------------------------------- |
| `?time=0..1` | initial `env.timeOfDay` and sets `env.timeLocked = true` (cycle paused)       |
| `?cam=name`  | camera preset from `CAMERA_PRESETS`: overview, street, core, topdown, skyline |
| `?rain=0..1` | initial `env.rain`                                                            |
| `?nogui`     | hides the lil-gui panel                                                       |

Numbers are clamped to 0..1; invalid values are ignored.

## Test hook: `window.__city`

`src/main.ts` sets `window.__city = { ready: true, frames }` at the end of every frame (the type lives in `src/global.d.ts`, which both tsconfigs include).
The Playwright e2e tests (`tests/e2e/`) and the screenshot script (`scripts/screenshot.ts`, `npm run shots`)
wait on it before asserting or capturing. Keep it in place.

## Coordinates and layout

Y up, ground at `y = 0`, 1 unit = 1 m, north = -Z, east = +X. The map spans `[-1200, 1200]` on X and Z (`CITY.extent = 2400`).
`rotY` / `gridAngle` follow three.js `rotation.y`; `w` is the local X extent and `d` the local Z extent.

`src/city/` is the single source of truth (data types in `src/city/types.ts`, all re-exported by `src/city/layout.ts`):

| data               | what                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `LAYOUT.districts` | zone polygons partitioning the map (`zoneAt`, `districtAt`), each with its own rotated road grid |
| `LAYOUT.river`     | 흑린강 centerline (33 points), channel 240 m incl. 40 m parks, water y -4                        |
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

| workflow                        | trigger                                                   | what it does                                                                                                                                                                                               |
| ------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`      | pull_request, push to main, dispatch                      | format:check, lint, typecheck, unit tests, build, Playwright e2e (report uploaded on failure)                                                                                                              |
| `.github/workflows/autofix.yml` | pull_request (same-repo only)                             | `lint:fix` + `format`; if anything changed, commits `style: 린트 및 포맷 자동 수정` as github-actions[bot], pushes to the PR branch and dispatches `ci.yml` for it (GITHUB_TOKEN pushes do not trigger CI) |
| `.github/workflows/pages.yml`   | CI succeeded on a push to main (`workflow_run`), dispatch | checks out the commit CI tested, builds with `BASE_PATH=/neon-megacity/` and deploys `dist/` to GitHub Pages                                                                                               |

`vite.config.ts` uses `base: process.env.BASE_PATH ?? './'`, so dev, preview, e2e and screenshots run with a relative base.
