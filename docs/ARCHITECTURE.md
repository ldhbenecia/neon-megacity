# Architecture

## Module contract
Every feature lives in its own folder under `src/` and exposes:

```js
export function init(ctx) { /* build objects, add to ctx.scene */ return { update(dt, elapsed) {}, dispose() {} }; }
```

`main.js` calls `init` in this order: **lighting → buildings → neon → atmosphere**, and each frame calls `update` in the same order, then `ctx.render()`.

## Shared context (`ctx`)
| key | meaning |
|---|---|
| `THREE, scene, camera, renderer, controls, gui` | standard three.js objects, `gui` is lil-gui (add your own folder) |
| `CITY, LAYOUT` | deterministic city layout from `src/city/layout.js` (blocks, buildings, roads) |
| `env.timeOfDay` | 0..1, 0 = midnight, 0.5 = noon. **Owned by lighting.** |
| `env.sunDirection` | unit Vector3 from ground toward the sun. **Owned by lighting.** |
| `env.dayFactor / env.nightFactor` | 0..1 smooth blend, sum to 1. **Owned by lighting.** |
| `env.rain` | 0..1 rain intensity. **Owned by atmosphere.** |
| `render()` | default `renderer.render`; atmosphere replaces with the post-processing composer |
| `onResize(fn)` | register `(w, h) => {}` |

## Coordinates
Y up, ground at `y = 0`, 1 unit = 1 m. City spans `[-CITY.extent/2, CITY.extent/2]` on X and Z.
Roads are `LAYOUT.roads` strips; buildings are `LAYOUT.buildings` `{x, z, w, d, h, district}` (x/z = center, h = height).

## Ownership
| folder | owner |
|---|---|
| `src/lighting/` | sun, moon, sky, day/night cycle, shadows |
| `src/buildings/` | ground, roads, building geometry, windows |
| `src/neon/` | neon signs, holograms, street lights, flying traffic |
| `src/atmosphere/` | fog, rain, wet-ground look, stars, bloom post-processing |
