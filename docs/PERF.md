# Performance

Budget: `docs/ART_DIRECTION.md` 11. This file records measured numbers; update the snapshot table in
every PR that changes performance, with before / after numbers in the PR body.

## How to measure

```sh
npm run perf -- <label>                  # real GPU (Metal ANGLE), builds first
npm run perf -- <label> --no-build --only=탑다운
npm run perf -- <label> --quality=ci     # the CI tier
npm run perf -- <label> --swiftshader    # software GL, slow
```

`scripts/perf.ts` serves `dist/` on :4175 and opens headless Chromium at 1600×900, device scale 2
(the app caps DPR at 1.5, so 2400×1350 pixels). For each preset 1, 2, 3, 5, 8 × time 0.0, 0.78,
0.5 it boots a fresh page with `?stats`, waits for `__city.powered` and 60 warm-up frames, then:

| column             | source                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| frame ms, fps      | `requestAnimationFrame` intervals over 240 frames, vsync off (`--disable-gpu-vsync --disable-frame-rate-limit`) |
| calls, tris        | `renderer.info.render` over one whole frame (post passes included, `autoReset = false`)                         |
| programs, textures | `renderer.info.programs.length`, `info.memory.textures`                                                         |
| geo MB, tex MB     | `__hangang.memory()`: buffers and textures reachable from the scene graph (post targets not included)           |
| update ms          | `__city.cpu`: moving average of each module's `update()` (main), summed                                         |
| boot stages        | `performance.mark('boot:<stage>')` from the loader; a stage includes its `nextFrame()` (two rAF)                |
| JS gzip            | `dist/assets/*.js`, gzip level 9                                                                                |

Texture bytes use format × type per texel and add 1/3 only for mipmapped min filters. Not
counted: post-processing render targets, and textures that only live in an `onBeforeCompile`
closure instead of on the material or its `uniforms` (arrays of textures are counted).

Results also go to `perf-results/<label>.json` (gitignored). fps above 60 only says how much
headroom is left: on a real display rAF is capped by vsync.

## Screen verification: full quality, several times of day, while moving

Counts, fps and e2e did not catch the black-rectangle bug (592da37 → #63): a shader `pow()` of a
slightly negative base gave NaN in the HDR target, and bloom spread it over most of the screen.
Only real-GPU full quality showed it; the low tier and SwiftShader did not (SwiftShader, 960×540:
noon overview 0 % black, sunset skyline 9–10 %, night street 12–14 %; Metal: 94 %, 100 % and
whole-frame flashes while moving).

So every `npm run perf` scenario (presets 1, 2, 3, 5, 8 × night, sunset, noon) also runs
`scripts/screen.ts`. A rAF callback queued after the app's loop downsamples the WebGL canvas to
64×36 on **every frame** (a 1–3 frame flash cannot slip between samples), first 1 s at rest, then
during a short zoom out and back, a W / S flight and a small orbit drag, then 1 s at rest. A pixel
is black when R + G + B < 6. Limits by time of day (`lightAt`, from Metal runs of the fixed build):

| light               | at rest | moving | why                                                      |
| ------------------- | ------- | ------ | -------------------------------------------------------- |
| day 07–17 h         | 30 %    | 50 %   | healthy views ≤ 13 % black                               |
| dusk 05–07, 17–20 h | 50 %    | 70 %   | street at sunset 26–27 % rest, 46–48 % moving            |
| night               | 90 %    | 90 %   | street / hillside up to 57–76 %: only whole black frames |

Any frame darker than mean 2 fails too. The run then exits with code 1. The table column is
`max black % at rest / moving, min brightness`; `--no-screen` skips it. Fixed build (#63 + #64):
all 15 scenarios pass; main c0fc4be: noon overview 100 % black at rest and moving.

Limit: at night only whole black frames fail, so a partial black block (say 15 % of the screen) at
night would pass; a follow-up could track the largest connected black region or a sudden jump in
the black share between frames.

The motion stays small on purpose: wide orbits at street level swing the camera against unlit
walls (legitimately black at night) and once clipped into a building (99 % black, mean 0.1).

Because SwiftShader does not reproduce GPU-specific NaN or precision bugs, **a full-quality
`npm run perf` on a real GPU is required before merging** any change to shaders, post-processing,
lighting or materials; paste its screen column in the PR body. CI keeps its SwiftShader checks.

## Snapshot: main e2b7fef (lighting, infra, atmosphere, ux; terrain, buildings, neon are stubs)

Apple M4 (Metal ANGLE), 2400×1350 (DPR 1.5 held for every run), full quality, canvas 4× MSAA
(before #43; the canvas has no MSAA since).

| scenario               | frame ms (mean / p95) | fps | calls | tris   | programs | textures | geo MB | tex MB |
| ---------------------- | --------------------- | --- | ----- | ------ | -------- | -------- | ------ | ------ |
| 1 강변 히어로 · night  | 4.3 / 6.4             | 231 | 25    | 0.15 M | 28       | 19       | 6.7    | 3.1    |
| 1 강변 히어로 · sunset | 4.1 / 5.9             | 242 | 25    | 0.15 M | 30       | 21       | 6.7    | 3.1    |
| 1 강변 히어로 · noon   | 3.7 / 5.1             | 272 | 23    | 0.15 M | 30       | 21       | 6.7    | 3.1    |
| 2 코어 상공 · night    | 4.3 / 6.3             | 232 | 25    | 0.15 M | 28       | 19       | 6.7    | 3.1    |
| 2 코어 상공 · noon     | 3.7 / 5.6             | 270 | 23    | 0.15 M | 30       | 21       | 6.7    | 3.1    |
| 3 등불가 거리 · night  | 4.2 / 6.2             | 237 | 25    | 0.15 M | 28       | 19       | 6.7    | 3.1    |
| 5 별계단동 · night     | 4.2 / 5.8             | 240 | 26    | 0.15 M | 28       | 19       | 6.7    | 3.1    |
| 8 탑다운 · night       | 4.8 / 5.9             | 210 | 25    | 0.14 M | 28       | 19       | 6.7    | 3.1    |
| 8 탑다운 · noon        | 4.2 / 5.7             | 237 | 23    | 0.14 M | 30       | 21       | 6.7    | 3.1    |

The other 6 scenarios fall inside the same ranges. Module `update()` total: ≤ 0.07 ms everywhere.
Boot to interactive (`loader.done()`): 353–621 ms; lighting init (4 PMREM bakes) 42–90 ms,
infra init 46–83 ms, first frame 31–79 ms. Canvas: 98.9 MB (`gl.SAMPLES` = 4). JS: 243.2 KB gzip.

## Against the budget (ART_DIRECTION 11)

| item                    | budget (target / ceiling) | now                         | note                                             |
| ----------------------- | ------------------------- | --------------------------- | ------------------------------------------------ |
| draw calls              | ≤ 220 / 300               | 23–26                       | buildings 90 + neon 60 still to come             |
| triangles               | ≤ 1.2 M / 2.0 M           | 0.15 M                      |                                                  |
| shader programs         | ≤ 35 / 50                 | 28–30                       | **already close to the target with 3 modules**   |
| textures                | ≤ 24 / 40                 | 19–21                       | **close to the target**; post targets count here |
| GPU memory              | ≤ 200 MB / 320 MB         | ~10 MB scene + 99 MB canvas | before #43; canvas now 24.7 MB (×1)              |
| module update CPU       | ≤ 1.5 / 3 ms              | ≤ 0.06 ms                   |                                                  |
| boot → interactive (M1) | ≤ 3 s / 10 s              | 0.4–0.5 s                   |                                                  |
| JS gzip                 | ≤ 260 / 400 KB            | 243.2 KB                    | **close to the target**                          |

## With buildings (#11 + #31 merged, terrain + buildings, neon still a stub)

Measured while verifying #31 (M4, full quality, night, two runs each); not a full snapshot yet:

| scenario              | frame ms (mean) | calls | tris   | programs | textures | geo MB |
| --------------------- | --------------- | ----- | ------ | -------- | -------- | ------ |
| 1 강변 히어로 · night | 6.5–6.7         | 70    | 0.36 M | 37       | 23       | 122.1  |
| 8 탑다운 · night      | 7.2–7.9         | 112   | 0.34 M | 37       | 23       | 122.1  |

Boot to interactive 1.0–1.6 s (buildings init 0.5–0.65 s). SwiftShader, low tier, 960×540: a frame
costs ~40 ms and ~31–39 ms at 400×225, so in CI the floor is per-vertex / per-draw work (0.32 M
triangles, 61 calls), not fill.

## Top bottlenecks (real GPU)

1. **GPU memory: over the 200 MB target.** Geometry 122 MB, almost all buildings LOD0 (the low
   tier, which skips LOD0, has 29.8 MB), canvas 24.7 MB since #43 (was 99 MB with 4× MSAA), plus
   post targets that `__hangang.memory()` cannot reach (not measured; at DPR 1.5 the HDR scene
   target alone is 2400×1350 × (8 B color + 4 B depth) ≈ 37 MB, then the bloom mips). Next: build
   LOD0 only for chunks near the camera.
2. **Shader programs: 37 against the target 35** (ceiling 50). Buildings adds 2 facade variants,
   shadows keep their variant at night (#31). Neon has not arrived yet. Next: shared materials
   and `onBeforeCompile` variants across modules; every new program needs a reason.
3. **Leaving the noon palette: one ~470 ms frame** (below). Not a recompile; next to investigate.

## Budget for layout v3 (map 4000×2600 m, ~6200 buildings, ~3850 street slots, 11 bridges)

Same ART_DIRECTION 11 ceilings; v3 must fit them, not raise them. Per-module rules for v3:

| item                      | rule for v3                                                                                                                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| draw calls (buildings 90) | one draw per visible chunk × LOD × material. ~70 chunks of 400 m fit; adding a material per chunk does not                                                                                                                                         |
| buildings LOD0            | LOD distance measured to the chunk AABB, not its centre (SEOUL.md 2.1), so 400 m chunks keep the v2 LOD0 radius (380 m); LOD0 built lazily near the camera                                                                                         |
| geometry memory           | ≤ 120 MB total (v2 is 122 MB; ×1.43 buildings would be ~175 MB)                                                                                                                                                                                    |
| street slots              | one `InstancedMesh` per kind; street lights as emissive quads / shader, real `PointLight`s ≤ 8 in total; trees LOD0 only                                                                                                                           |
| infra triangles           | ≤ 300 k on screen; bridge detail (`BRIDGE_LOD_NEAR` 600 m / `BRIDGE_LOD_FAR` 660 m, 3D distance to the deck centre) is off in the low tier; test limit 300 k, worst over a 100 m camera grid plus bridge centres and midpoints: v2 134 k, v3 285 k |
| triangles on screen       | ≤ 1.2 M target at the top-down and river presets (v2: 0.36 M)                                                                                                                                                                                      |
| layout generation         | ≤ 1 s in the browser on an M1-class laptop; otherwise precompute it at build time or move it to a Worker in parallel with PMREM bakes                                                                                                              |
| boot → interactive        | ≤ 3 s M1, ≤ 6 s Intel iGPU (v2 with buildings: 1.0–1.6 s on M4)                                                                                                                                                                                    |
| low tier (`env.quality`)  | every new module adds its branch in the same PR: skip LOD0 / near meshes, props, per-pixel noise and post                                                                                                                                          |

Check after each v3 PR with `npm run perf -- v3` on the heaviest presets (SEOUL.md 7: overview and namsan) plus top-down.

## Shader programs: what splits them, and the budget per team

`renderer.info.programs` (HUD `prog`, `npm run perf` column) counts compiled programs. three makes a
new one for every distinct combination of:

- shader source: every `ShaderMaterial` with its own GLSL string. Branch by attribute or uniform
  (type id, colour, blink phase) inside one shader instead of near-copies.
- `defines`: a define on some materials only (e.g. `BLINK`) doubles the program. UnrealBloomPass did
  this with `KERNEL_PAIRS` per mip (5 programs; now one shared blur, `src/atmosphere/bloomBlur.ts`).
- `onBeforeCompile` patches: shared only with the same `customProgramCacheKey`.
- mesh kind: the same material on `InstancedMesh` and `Mesh` (USE_INSTANCING), or on `BatchedMesh`
  (USE_BATCHING), is two programs.
- built-in material flags: vertexColors, map, alphaTest, side, transparent, fog on / off,
  receiveShadow (USE_SHADOWMAP), castShadow (adds a depth variant).
- render target: with post on, the scene renders untonemapped into the HDR target; drawing one
  material to both the canvas and the target compiles both variants.
- day / night: swap uniforms, never materials or shadow flags (#31).
- helpers that stay alive: a `PMREMGenerator` keeps its programs until disposed. Lighting disposes
  it once every env key is baked: at boot in full quality; the low tier bakes lazily and usually
  keeps it.

Budget (ceiling 50 stays the CI gate; team total 45 leaves a reserve):

| team                  | now (main, full quality) | allocation incl. v3 |
| --------------------- | ------------------------ | ------------------- |
| lighting              | 1                        | 2                   |
| terrain               | 4                        | 4                   |
| buildings             | 4                        | 6 (v3 archetypes)   |
| infra                 | 6                        | 8 (bridge types)    |
| atmosphere            | ~11                      | 12                  |
| neon                  | (#46 pending)            | 8                   |
| shadow depth variants | 3                        | 3                   |
| reserve               |                          | 2                   |
| **total**             | **29**                   | **45**              |

## Proposal: move boot work off the main thread (Web Worker)

Status: measured and decided (Worker), not implemented. Engine stays three.js; this is about where
the CPU work runs.

**Measured** (main c0fc4be, M4, preset 2 night, `PerformanceObserver('longtask')`, 3 runs): the
main thread is blocked 2.1–3.2 s in total during boot, so the loader skeleton cannot update.

| boot slice                                 | blocked (ms)             | shape         |
| ------------------------------------------ | ------------------------ | ------------- |
| JS evaluation + layout generation (import) | 394–599                  | one task      |
| buildings init (LOD1/LOD2 emit + build)    | 444–640                  | one task      |
| compile (shader link)                      | 248–293 (cold run: 1735) | one task      |
| neon init                                  | 173–200                  | one task      |
| lighting, terrain, infra, setup            | 85–171 each              | one task each |

**Decision (manager, #78): one Worker, no build-time JSON.** Precomputed layout data would add a
download outside the bundle budget (slower than computing on a slow link, and it cannot overlap
with JS evaluation and shader compiles the way a worker can) and could drift from the generator.

**Design conditions.**

1. **One worker**: it generates the layout, posts it to main, then builds the buildings geometry
   in the same worker and transfers the `ArrayBuffer`s. The layout is never sent to two workers.
2. Main needs the layout too (src/city queries: camera collision, neon placement, terrain). It
   arrives by structured clone; measure the clone cost. If it is large, building specs become a
   bundle of typed arrays (agree with hangang-seoul, owner of src/city).
3. Boot becomes asynchronous. The module init order (lighting → terrain → buildings → infra →
   neon → atmosphere) and the meaning of `window.__city.ready` stay; the loader covers the wait
   (with hangang-ux). Without workers (old browsers, worker creation failure) the current
   synchronous main-thread path remains.
4. Deterministic: the worker and the main path call the same pure functions; a unit test pins
   that layout and geometry are identical.
5. Vite `new Worker(new URL(..., import.meta.url), { type: 'module' })`; an e2e run with
   `BASE_PATH` checks the worker chunk URL; the worker chunk counts in `npm run size`.
6. Order: (1) buildings geometry worker, built as the single worker of point 1; (2) layout. Both
   after quality tiers (a). Re-measure on layout v3 (#32) first: more buildings, longer freezes.

**Expected payoff.** Buildings in the worker remove the 0.44–0.64 s freeze and overlap boot with
lighting / infra / neon init (est. 0.2–0.4 s shorter); the time-sliced LOD0 jobs (#53) move too,
removing the 12 ms `build()` spike per chunk. Layout in the worker removes the 0.39–0.60 s import
task (v3: Node ~1.0 s, likely 1–2 s in a laptop browser).

**Costs.** A worker chunk duplicates part of three (BufferGeometry and math; est. 40–60 KB gzip,
lazy, not counted in the initial-load budget). Determinism is unchanged (same code, same seeds;
`tests/buildings-lod.test.ts` pins sliced vs direct LOD0 bytes, `tests/buildings-passes.test.ts`
(#57) far / near passes vs the full emit). Debugging spans two threads.

**Verification.** Same longtask probe: the buildings slice must vanish from the main thread, the
boot → interactive time must not grow, and the loader must keep animating (no task > 100 ms
during the buildings stage).

## JS bundle: what it is made of, and a proposed target

Measured on main 3db3a31 (neon included): initial JS 298.7 KB gzip (target 260, ceiling 400).
Attribution from the production source map (`vite build --sourcemap`, minified bytes per source,
gzip share scaled to the real total):

| part                     | raw KB | gzip KB (share) |
| ------------------------ | ------ | --------------- |
| three core               | 715.5  | 173.6           |
| src/neon                 | 75.2   | 25.7            |
| src/buildings            | 56.3   | 20.8            |
| src/city                 | 33.5   | 13.3            |
| src/ux                   | 30.9   | 12.7            |
| src/atmosphere           | 29.8   | 10.6            |
| src/infra                | 21.1   | 8.5             |
| lil-gui                  | 29.9   | 7.6             |
| three/examples           | 33.8   | 7.5             |
| src/terrain              | 14.0   | 5.5             |
| src/lighting             | 10.4   | 4.3             |
| src/core, main, unmapped | 21.2   | 8.5             |

three core is 58 % and sets the floor; our modules add ~125 KB. Shader strings and sign text are
inside their modules (neon's 25.7 KB includes its GLSL and catalogue).

**Options, with their effect on the initial chunk:**

| change                                                          | initial gzip | note                                                     |
| --------------------------------------------------------------- | ------------ | -------------------------------------------------------- |
| today                                                           | 298.7 KB     |                                                          |
| lil-gui only with `?debug` (dynamic import + stub GUI)          | ~291 KB      | the only change that also cuts total download (−7.6 KB)  |
| + neon and atmosphere as lazy chunks loaded at their boot stage | ~255 KB      | same total download; the first chunk parses ~15 % sooner |
| + buildings, infra lazy too                                     | ~225 KB      | diminishing returns: every stage waits for its own fetch |

**Decision (manager, #88).** The 400 KB ceiling covers _all_ JS (every chunk, worker chunks
included); the 260 KB target covers the _first_ chunk. three core (173.6 KB) is the floor, so the
target is met by splitting, not trimming:

1. lil-gui only with `?debug` (dynamic import, stub panel otherwise): now, small PR.
2. neon and atmosphere as lazy chunks, designed together with the boot Worker as one "async boot"
   change after layout v3 (#32), with these conditions: no waterfall (all lazy chunks start
   downloading as soon as the first chunk runs: `import()` on the first line of boot or
   modulepreload); first paint and `__city.ready` measured before / after, and dropped if ready
   gets slower; the init order and the meaning of `__city.ready` stay; a failed chunk download
   shows an error and retry in the loader (never half a city); an e2e run under `BASE_PATH`
   checks chunk URLs. `npm run size` already reports first and lazy chunks separately (#45).

## Findings and candidates

- **Signs in layout v3 always hit the cap.** The sign total stays at its 16,000 cap, so thinning
  always runs (building signs ~10,300, street panels ~4,070, street lights 1,456 / 1,500, ground
  traffic 1,199 / 1,200; caps scaled to the map in #67).

- **Day/night scrub stall (fixed).** Toggling the key light's `castShadow` changed the program
  variant of every lit material. With buildings (#11), preset 2, M4: a timeline jump between night
  and day added 8 programs (35 → 43) and stalled one frame for 0.57–1.26 s, both directions.
  Lighting now keeps `castShadow` fixed and sets `shadow.intensity` to 0 at night: 0 new programs,
  worst frame 16–18 ms for night → noon / sunset. Trade-off: at night lit materials still sample
  the shadow map (PCF runs before the intensity mix). Steady-state night frames with buildings,
  two runs each: river 5.1 / 6.7 ms on main vs 6.7 / 6.5 ms, top-down 7.8 / 7.3 vs 7.9 / 7.2, i.e.
  within run-to-run noise on the M4; re-check on an integrated GPU. The alternative, compiling
  both variants at boot, keeps 52 programs alive (ceiling 50) for the same night frame times.
- **Leaving the noon palette (fixed).** Booted at noon, the first jump to sunset or night
  stalled one frame for ~500 ms with no new program: no link happened, but a CPU profile showed
  ~300 ms in `getProgramInfoLog`. three's `checkShaderErrors` reads it on a program's first use,
  and the driver blocks there. Main now turns the check off for users (kept in dev and under
  automation and with `?debug`, so e2e still fails on shader errors). M4, buildings, preset 2:
  noon → night 505 → 17 ms, noon → sunset 522 → 25 ms (worst of 30 frames after a timeline
  input event). `npm run perf` cannot show this: Playwright sets `navigator.webdriver`, which keeps
  the check on; the numbers came from a probe launched with
  `--disable-blink-features=AutomationControlled`. On GPUs where linking itself is slow
  (`KHR_parallel_shader_compile`), the first use may still wait inside three's uniform and
  attribute lookups; re-measure on an integrated GPU.

- **MSAA on the canvas while post-processing is on (fixed).** The scene renders into
  atmosphere's HDR target (4 / 2 / 0 MSAA samples at DPR ≤ 1 / < 1.5 / ≥ 1.5, `msaaSamplesFor`)
  and only the final full-screen pass reaches the canvas, so canvas MSAA never touched scene edges
  and cost 74 MB and a resolve per frame. Main now creates the renderer without canvas MSAA and
  recreates it with MSAA only if that context cannot run post (`postEnabled` in `src/core/gl.ts`,
  shared with atmosphere). M4, buildings, preset 2:
  canvas 98.9 → 24.7 MB, frame 6.5–7.0 → 4.5–5.1 ms (machine under load; indicative), screenshots
  equal within run-to-run noise.
- **Programs and textures.** 28–30 programs and 19–21 textures before buildings and neon arrive.
  Modules should share materials and `onBeforeCompile` variants. The low tier (no post, rain,
  clouds, searchlights, shadows) has 12 programs and 3 textures, so those features account for
  16–18 programs and 16–18 textures.
- **Cold shader cache.** An early run (whose GPU probe did not boot the app) showed first-frame
  0.5–0.9 s, later runs 31–79 ms; the OS shader cache likely explains it. Re-check once buildings
  and neon add programs.
- **JS bundle.** 266.5 KB gzip on main after buildings, over the 260 KB target (`npm run size`
  warns in CI). Candidate: load lil-gui (only shown with `?debug`) lazily; every module calls
  `ctx.gui.addFolder` at init, so it needs a typed stand-in when the panel is off.
