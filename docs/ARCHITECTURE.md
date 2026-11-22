# Architecture

## Module contract

Every feature lives in its own folder under `src/` and exposes from `index.ts` (types in `src/core/types.ts`):

```ts
import type { Ctx, CityModuleInstance } from '../core/types';

export function init(ctx: Ctx): CityModuleInstance {
  /* build objects, add to ctx.scene */ return { update(dt, elapsed) {}, dispose() {} };
}
```

`src/main.ts` calls `init` in this order: **lighting → buildings → neon → atmosphere**, and each frame calls `update` in the same order, then `ctx.render()`.

## Shared context (`ctx`)

| key                                             | meaning                                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `THREE, scene, camera, renderer, controls, gui` | standard three.js objects, `gui` is lil-gui (add your own folder)                       |
| `CITY, LAYOUT`                                  | deterministic city layout from `src/city/layout.ts` (blocks, buildings, roads)          |
| `env.timeOfDay`                                 | 0..1, 0 = midnight, 0.5 = noon. **Owned by lighting.** Initial value comes from `?time` |
| `env.timeLocked`                                | true when `?time=` was given. **Set by main.** Lighting must not advance `timeOfDay`    |
| `env.sunDirection`                              | unit Vector3 from ground toward the sun. **Owned by lighting.**                         |
| `env.sunElevation`                              | sin(sun elevation) == `sunDirection.y`. **Owned by lighting.**                          |
| `env.dayFactor / env.nightFactor`               | 0..1 smooth blend, sum to 1. **Owned by lighting.**                                     |
| `env.horizonColor / env.skyColor`               | sky colors for fog and reflections. **Owned by lighting.**                              |
| `env.rain`                                      | 0..1 rain intensity. **Owned by atmosphere.** Initial value comes from `?rain`          |
| `buildings`                                     | `BuildingsApi` published by buildings during its init; undefined before that            |
| `render()`                                      | default `renderer.render`; atmosphere replaces with the post-processing composer        |
| `onResize(fn)`                                  | register `(w, h) => {}`                                                                 |

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

`src/main.ts` sets `window.__city = { ready: true, frames }` at the end of every frame.
The Playwright e2e tests (`tests/e2e/`) and the screenshot script (`scripts/screenshot.ts`, `npm run shots`)
wait on it before asserting or capturing. Keep it in place.

## Coordinates

Y up, ground at `y = 0`, 1 unit = 1 m. City spans `[-CITY.extent/2, CITY.extent/2]` on X and Z.
Roads are `LAYOUT.roads` strips; buildings are `LAYOUT.buildings` `{x, z, w, d, h, district}` (x/z = center, h = height).

## Ownership

| folder            | owner                                                    |
| ----------------- | -------------------------------------------------------- |
| `src/lighting/`   | sun, moon, sky, day/night cycle, shadows                 |
| `src/buildings/`  | ground, roads, building geometry, windows                |
| `src/neon/`       | neon signs, holograms, street lights, flying traffic     |
| `src/atmosphere/` | fog, rain, wet-ground look, stars, bloom post-processing |

## CI and deployment

| workflow                        | trigger                              | what it does                                                                                                                                                                                                    |
| ------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`      | pull_request, push to main, dispatch | format:check, lint, typecheck, unit tests, build, Playwright e2e (report uploaded on failure)                                                                                                                   |
| `.github/workflows/autofix.yml` | pull_request (same-repo only)        | `lint:fix` + `format`; if anything changed, commits `style: autofix lint and formatting` as github-actions[bot], pushes to the PR branch and dispatches `ci.yml` for it (GITHUB_TOKEN pushes do not trigger CI) |
| `.github/workflows/pages.yml`   | push to main, dispatch               | builds with `BASE_PATH=/neon-megacity/` and deploys `dist/` to GitHub Pages                                                                                                                                     |

`vite.config.ts` uses `base: process.env.BASE_PATH ?? './'`, so dev, preview, e2e and screenshots run with a relative base.
