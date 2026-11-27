# Performance

Budget: `docs/ART_DIRECTION.md` 11. This file records measured numbers; update the snapshot table in
every PR that changes performance, with before / after numbers in the PR body.

## How to measure

```sh
npm run perf -- <label>                  # real GPU (Metal ANGLE), builds first
npm run perf -- <label> --no-build --only=topdown
npm run perf -- <label> --quality=ci     # the CI tier
npm run perf -- <label> --swiftshader    # software GL, slow
```

`scripts/perf.ts` serves `dist/` on its per-worktree port (`localPort`, `PERF_PORT` overrides) and opens headless Chromium at 1600×900, device scale 2
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

## Snapshot: main c546911 (Seoul presets #105, phase-2 modules)

Apple M4 (Metal ANGLE), 1600×900 at DPR 1.5 (tier high), full quality, `rain=0.35`, `npm run perf`
(240 frames per scenario). No screen-check failures and no console errors. The views are the number-key presets 1, 2, 6, 7 (`?preset=`) and
`?cam=overview` / `?cam=topdown`. Topdown is the worst view (most draw calls, longest frames), so the
full-quality e2e budget scenario (`tests/e2e/perf.spec.ts`) boots there at noon, when the shadow
pass runs (night has 2 more calls, no shadow pass).

| scenario                   | frame ms (mean / p95) | calls | tris   | programs | textures | geo MB | tex MB | black % (rest / move) |
| -------------------------- | --------------------- | ----- | ------ | -------- | -------- | ------ | ------ | --------------------- |
| 1 반포대교 남단 · night    | 4.9 / 6.3             | 82    | 0.93 M | 37       | 29       | 60.0   | 61.4   | 17 / 30               |
| 1 반포대교 남단 · sunset   | 5.1 / 6.6             | 82    | 0.93 M | 37       | 29       | 60.0   | 61.4   | 42 / 42               |
| 1 반포대교 남단 · noon     | 5.2 / 6.4             | 80    | 0.93 M | 37       | 29       | 60.0   | 61.4   | 2 / 3                 |
| 2 여의도 상공 · night      | 5.5 / 6.8             | 70    | 0.91 M | 37       | 28       | 59.4   | 61.4   | 0 / 18                |
| 2 여의도 상공 · sunset     | 5.9 / 7.5             | 70    | 0.91 M | 37       | 28       | 59.4   | 61.4   | 2 / 58                |
| 2 여의도 상공 · noon       | 6.3 / 8.5             | 68    | 0.91 M | 37       | 28       | 59.4   | 61.4   | 0 / 3                 |
| 6 잠실 스카이라인 · night  | 5.8 / 10.0            | 68    | 0.90 M | 37       | 28       | 61.3   | 61.4   | 4 / 9                 |
| 6 잠실 스카이라인 · sunset | 6.4 / 8.0             | 68    | 0.90 M | 37       | 28       | 61.3   | 61.4   | 11 / 49               |
| 6 잠실 스카이라인 · noon   | 6.9 / 8.3             | 66    | 0.90 M | 37       | 28       | 61.3   | 61.4   | 0 / 1                 |
| 7 홍대 골목 · night        | 7.4 / 8.8             | 89    | 0.94 M | 37       | 28       | 61.1   | 61.4   | 1 / 2                 |
| 7 홍대 골목 · sunset       | 8.1 / 9.7             | 89    | 0.94 M | 37       | 28       | 61.1   | 61.4   | 28 / 28               |
| 7 홍대 골목 · noon         | 8.1 / 9.5             | 87    | 0.94 M | 37       | 28       | 61.1   | 61.4   | 2 / 3                 |
| overview · night           | 9.8 / 11.3            | 118   | 0.91 M | 37       | 29       | 59.4   | 61.4   | 0 / 0                 |
| overview · sunset          | 10.1 / 11.6           | 118   | 0.91 M | 37       | 29       | 59.4   | 61.4   | 0 / 1                 |
| overview · noon            | 10.0 / 11.5           | 116   | 0.91 M | 37       | 29       | 59.4   | 61.4   | 0 / 0                 |
| topdown · night            | 12.7 / 14.4           | 120   | 0.91 M | 37       | 29       | 59.4   | 61.4   | 0 / 1                 |
| topdown · sunset           | 13.3 / 14.9           | 120   | 0.91 M | 37       | 29       | 59.4   | 61.4   | 0 / 0                 |
| topdown · noon             | 12.8 / 14.5           | 118   | 0.91 M | 37       | 29       | 59.4   | 61.4   | 0 / 0                 |

Budget (ART_DIRECTION 11: 300 calls, 2 M triangles, 50 programs): worst 120 calls, 0.94 M
triangles, 37 programs, 28–29 textures. Boot stages in ms. The load average rose during the run,
so compare the first three boots with older baselines and treat the rest as an upper bound:

| stage       | first three boots (load 5.6) | all 18 boots (load rising to 18) |
| ----------- | ---------------------------- | -------------------------------- |
| lighting    | 41–48 ms                     | 41–78 ms                         |
| terrain     | 190–249 ms                   | 190–390 ms                       |
| buildings   | 295–351 ms                   | 295–611 ms                       |
| infra       | 77–96 ms                     | 77–155 ms                        |
| neon        | 140–172 ms                   | 140–278 ms                       |
| atmosphere  | 40–50 ms                     | 40–78 ms                         |
| compile     | 145–168 ms                   | 134–219 ms                       |
| interactive | 1409–1698 ms                 | 1409–2704 ms                     |

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

| item                      | rule for v3                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| draw calls (buildings 90) | one draw per visible chunk × LOD × material. ~70 chunks of 400 m fit; adding a material per chunk does not                                                                                                                                                                                                                      |
| buildings LOD0            | LOD distance measured to the chunk AABB, not its centre (SEOUL.md 2.1), so 400 m chunks keep the v2 LOD0 radius (380 m); LOD0 built lazily near the camera                                                                                                                                                                      |
| geometry memory           | ≤ 120 MB total (v2 is 122 MB; ×1.43 buildings would be ~175 MB)                                                                                                                                                                                                                                                                 |
| street slots              | one `InstancedMesh` per kind; street lights as emissive quads / shader, real `PointLight`s ≤ 8 in total; trees LOD0 only                                                                                                                                                                                                        |
| infra triangles           | ≤ 300 k on screen; bridge detail on / off by 3D distance to the deck centre (`BRIDGE_LOD_NEAR_BY_QUALITY`): high 600 / 660 m, medium 400 / 440 m, hidden in low (built, so moving up needs no rebuild), not built in ci; test limit 300 k, worst over a 100 m camera grid plus bridge centres and midpoints: v2 134 k, v3 285 k |
| triangles on screen       | ≤ 1.2 M target at the top-down and river presets (v2: 0.36 M)                                                                                                                                                                                                                                                                   |
| layout generation         | ≤ 1 s in the browser on an M1-class laptop; otherwise precompute it at build time or move it to a Worker in parallel with PMREM bakes                                                                                                                                                                                           |
| boot → interactive        | ≤ 3 s M1, ≤ 6 s Intel iGPU (v2 with buildings: 1.0–1.6 s on M4)                                                                                                                                                                                                                                                                 |
| low tier (`env.quality`)  | every new module adds its branch in the same PR: skip LOD0 / near meshes, props, per-pixel noise and post                                                                                                                                                                                                                       |

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

## Baseline: layout v3 (main 0d4c9de, Seoul map)

Apple M4, full quality, `npm run perf -- v3-base` (15 scenarios; machine under load, so frame times
are indicative). Every scenario passes the screen check.

| item                      | v3 range            | budget (target / ceiling) |
| ------------------------- | ------------------- | ------------------------- |
| draw calls                | 79–119              | 220 / 300                 |
| triangles                 | 0.92–0.98 M         | 1.2 M / 2.0 M             |
| shader programs           | 37                  | 35 / 50                   |
| textures                  | 28–29               | 24 / 40                   |
| geometry / texture memory | 60.7–66.4 / 61.4 MB |                           |
| boot → interactive        | 2.7–4.5 s           | M1 3 s / 10 s             |

Main thread during boot (`PerformanceObserver('longtask')`, preset 2 night, 3 runs): blocked
2.8–3.0 s in total, `__city.ready` at 3.1–3.4 s. Longest tasks: JS evaluation + layout generation
764–811 ms, buildings 585–637 ms, terrain 501–516 ms, neon 351–392 ms, compile 233–289 ms, infra
207–252 ms. Structured clone of the v3 layout: 31 ms (3.8 MB, 5,662 buildings, plain objects only).

## Module init-time budget (review gate for layout v3 PRs)

A PR may not make a module's boot `init` (and layout generation) more than **1.3×** its v3
baseline, measured back to back with main on the same machine (`npm run perf -- <label>
--no-build --no-screen --frames=30 --only="여의도 상공"`, three boots; the absolute numbers move with
machine load, the ratio does not). Baseline (main 0d4c9de, M4, under load): layout 0.8 s,
buildings 0.6 s, terrain 0.5 s, neon 0.37 s, compile 0.26 s, infra 0.23 s. Over 1.3× the reviewer
comments on the PR and the manager decides; work moving to the boot worker does not count.

First checks (M4, low load, main 31ead8a measured in the same session; compare ratios only, not
these absolute numbers with the loaded 0d4c9de baseline above):

| PR                  | module init (ms)  | main (ms) | ratio      |
| ------------------- | ----------------- | --------- | ---------- |
| #101 terrain-seoul  | terrain 151–176   | 211–225   | 0.7–0.8×   |
| #97 buildings-seoul | buildings 293–334 | 259–261   | 1.13–1.28× |
| #104 infra-seoul    | infra 78–86       | 87–95     | 0.9×       |

Top-down view: #97 triangles 0.92 → 0.93 M, geometry 60.7 → 62.0 MB; #104 0.92 → 0.86 M,
60.7 → 56.1 MB (bridge LOD). Programs 37 and textures 29 in all three.

**Textures: two budgets (manager decision).** `info.memory.textures` (29) mixes two kinds:

- **Module textures** (neon atlas, car paths, cloud noise, window digits, puddles, …): about 12;
  **target 14**, counted per module in review.
- **Render targets and env maps** (bloom bright + 5 + 5 mips = 11, HDR scene target 1, shadow map
  1, four baked PMREM maps 4): budgeted by **memory** (resolution × format, MB), not by count. At
  2400×1350 the HDR target alone is ≈ 37 MB (8 B colour + 4 B depth per pixel).

Bloom keeps 5 mips: fewer mips would remove the wide glow around neon in fog, and the count target
is not a reason to change the picture. The mip count becomes a quality-tier knob instead (high 5,
medium 4, low 3, by pass count only, no program change), done with env in the per-module knobs.

## Proposal: move boot work off the main thread (Web Worker)

Status: implemented as far as it pays off; results, timeouts and the parts left out are in
"Result: async boot" below. This section keeps the original measurements and plan.

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

**Async boot plan on v3 (goal: no main-thread task over 200 ms, `__city.ready` no later than
3.1–3.4 s).** Layout and buildings alone leave terrain (0.5 s), neon (0.35–0.4 s), compile and
infra above 200 ms, so the plan has phases, each measured with the long-task probe:

1. **Bootstrap + layout worker (perf).** A small first chunk shows the loader, starts the city
   worker and preloads the app chunk (no waterfall). The worker runs `generateLayout` and posts
   the layout (structured clone, ~31 ms on main); `setLayout()` publishes it before the app chunk
   runs (`ux/cameraRig` reads `LAYOUT` at import time, so it must come after). Without workers the
   current synchronous path runs. Removes the 0.76–0.81 s task.
2. **Buildings geometry in the same worker (perf).** LOD1/LOD2 per chunk come back as
   transferable typed arrays; the time-sliced LOD0 jobs move too. Removes the 0.59–0.64 s task.
3. **Terrain and neon pure data in the worker (with hangang-env and hangang-neon).** Ground /
   channel / ridge arrays and neon placement (`placeSigns`, `planStreet`) are pure; their modules
   then only wrap arrays. Removes 0.5 s and 0.35–0.4 s.
4. **Compile.** atmosphere's warm-up hook calls the synchronous `renderer.compile`, so main's
   `compileAsync` (`KHR_parallel_shader_compile`) is bypassed; switching the hook to
   `compileAsync` on the HDR target should split the 0.23–0.29 s task. Infra (0.21–0.25 s) is
   time-sliced if still above 200 ms.
5. **Lazy neon / atmosphere chunks** (bundle decision #88) ride on the same bootstrap.

**Costs.** A worker chunk duplicates part of three (BufferGeometry and math; est. 40–60 KB gzip,
lazy, not counted in the initial-load budget). Determinism is unchanged (same code, same seeds;
`tests/buildings-lod.test.ts` pins sliced vs direct LOD0 bytes, `tests/buildings-passes.test.ts`
(#57) far / near passes vs the full emit). Debugging spans two threads.

**Verification.** Same longtask probe: the buildings slice must vanish from the main thread, the
boot → interactive time must not grow, and the loader must keep animating (no task > 100 ms
during the buildings stage).

## Result: async boot

**What runs where now.** `src/boot.ts` (the entry in `index.html`, 2 KB) starts the city worker
and imports the app chunk at the same time; modulepreload links fetch the app chunks with the HTML.
No module reads `LAYOUT` while it is evaluated (`tests/layout-import.test.ts`), so the app is
evaluated while the worker works. The worker posts three messages in module init order:

1. the layout (`generateLayout`); main publishes it (`setLayout`) and calls `start()`;
2. terrain ground and channel geometry (`buildGround`, `buildChannel`, typed arrays transferred);
3. road and sidewalk geometry and the puddle mask (`buildRoads`, `buildSidewalks`, `puddleData`).

`main.ts` awaits a module's prebuilt entry (`src/core/prebuilt.ts`) just before its init; terrain
and buildings wrap the arrays (`unpackGeometry`) or, with no entry, build as before. Entries are
tied to the layout object they were built from. Without workers, or when the worker throws, errs
or times out, every module builds on the main thread as it did before the worker existed. The
worker bundles `src/city/three-lite.ts` (a few three source modules) instead of three.core; `npm
run size` fails if three's entry module (`__THREE__`) or more than 60 KB ends up in it.
Identity: `tests/worker-prebuilt.test.ts` builds through the three-lite module graph, transfers,
unpacks and compares bytes, item sizes, flags, index types and groups with the main-thread build.

**Per step** (M4 Metal, `?preset=2&time=0`, DPR 2, 1600×900, `PerformanceObserver('longtask')`;
each row is main vs the PR, alternating boots in one session, so compare within a row: the
absolute values move with machine load).

| step                               | runs | longest main task | main blocked total | `__city.ready`         |
| ---------------------------------- | ---- | ----------------- | ------------------ | ---------------------- |
| v3 baseline (main 0d4c9de, loaded) | 3    | 764–811 ms        | 2.8–3.0 s          | 3.1–3.4 s              |
| #114 layout in the worker          | 7+7  | 312 → 258 ms      | 1204 → 890 ms      | 1498 → 1535 ms (noise) |
| #139 app evaluated beside it       | 7+7  | 625 → 597 ms      | 2169 → 1603 ms     | 3082 → 2538 ms         |
| #147 terrain geometry in it        | 7+7  | 323 → 274 ms      | 901 → 569 ms       | 1488 → 1209 ms         |
| #158 roads, sidewalks, puddles     | 7+7  | 296 → 193 ms      | 595 → 501 ms       | 1284 → 1279 ms         |

Goal met: no main-thread task over 200 ms on the M4 (longest: buildings init 193 ms, then neon
~170 ms), and ready ~1.2–1.3 s against the 3.1–3.4 s v3 baseline.

**Boot timeline after #158** (5 boots, ms since navigation): app chunk evaluated ~47; layout
arrives ~350 (setup starts); terrain stage starts ~450, its geometry arrives ~530; buildings stage
starts ~545, its data arrives ~630; neon ~890; first frame ~1200; ready ~1240. The critical path
is the worker (layout ~350, terrain ~180, roads ~95 ms); the main thread waits ~80 ms before
terrain and before buildings.

**Timeouts** (`src/city/loadLayout.ts`). After the layout, the worker has `WORKER_TIMEOUT_MS`
= 8 s for its geometry; after terrain, buildings gets `BUILDINGS_AFTER_TERRAIN_MS` = 1.5 s. On
the M4 the worker needs ~0.3 s for both after the layout (~13× margin on 8 s; a 6× slower CPU
still fits), and buildings' share is ~95 ms against a ~90 ms main-thread fallback, so 1.5 s only
fires for a worker that hangs or was killed without an error event (memory pressure). A timeout
logs a warning, terminates the worker and the modules build on the main thread.

**Left out, and why** (measured; do not retry without new numbers):

- **Lazy neon / atmosphere chunks (plan step 5).** The app chunk is evaluated at ~47 ms and then
  waits ~300 ms for the layout: splitting it saves nothing on the critical path, and every module
  is needed before `__city.ready` anyway.
- **A second worker for the buildings data.** It would remove the ~80 ms wait before buildings
  (the critical path is layout → terrain in one worker); below the 100 ms bar for a step.
- **Neon placement in the worker (plan step 3, neon half).** Neon init is ~170 ms (`placeSigns`
  69, `decalList` 32, `planStreet` 22 ms), already under 200 ms, and the main thread reaches it
  long after the worker is done: no ready gain.
- **Buildings chunk geometry (plan step 2 proper).** `collectChunks` (82 ms) and the LOD1/LOD2
  emit build closures and three objects per chunk; with roads and puddles moved, buildings init
  is 193 ms, so the remaining work is not worth a second transfer format.
- **Compile (plan step 4).** Done by env/ux (#93, #106: `compileAsync` on the HDR target); the
  compile stage is ~100 ms.

## User quality tiers

Design #66, implemented (#87 controller, #143 picker API, #145 picker UI; module knobs below).

**Tiers.** `env.quality` is `'high' | 'medium' | 'low'` for users (owner ux, may change at
runtime) plus `'ci'` (CI SwiftShader: DPR 0.5, no shadows / post / rain / LOD0 / bridge detail,
never changes). Modules apply their knobs in `ctx.onQuality`, never by polling.

**Selection.** At boot `tierFromRenderer` (`src/ux/quality.ts`) maps the WebGL renderer string:
Apple M* / NVIDIA / RTX / Radeon RX / Radeon Pro → high; Intel / Iris / UHD / other Radeon →
medium; SwiftShader, llvmpipe, Mali, Adreno, PowerVR → low; Safari's masked "Apple GPU" → medium on
a Mac, low on touch devices; unreadable → medium. A pick in the panel (자동 / 상 / 중 / 하) or
`?quality=` overrides it; the pick is stored under `hangang.quality` ('auto' clears it).

**Controller** (`QualityController`, automatic mode only). Median frame time over 2 s (a median:
a few long frames must not move the tier); the first 60 frames are skipped; a 2 s boot probe
steps down at once above 25 ms. Down: DPR first in 0.25 steps (caps high 1.5, medium 1, low 0.75,
never above the device ratio), then the next tier, after 2 s above 20 ms. Up: after 8 s below
18.2 ms (55 fps: a 60 Hz display never reports less than 16.7 ms), up to high; a step up that
makes the median slow within 6 s is undone once and climbing stops for the session. At most one
step per 3 s. Hidden tabs and frames over 0.25 s are ignored.

**Runtime rule.** No knob may change a material's program variant at runtime (the #31 / #42
stalls): use intensity, visibility, instance counts, distances or render-target sizes. Light
counts stay fixed (lights fade to 0), shadows stay enabled (low stops refreshing), hidden detail
stays compiled at boot (#141 hides instances, not the mesh). Every tier boots with 37 programs.

| knob (module, PR)                      | high                                                                                                                             | medium      | low                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------- |
| DPR cap (ux, #87)                      | min(dpr, 1.5)                                                                                                                    | 1           | 0.75                    |
| sun shadow map (lighting, #148)        | 2048²                                                                                                                            | 1024²       | 1024² kept, intensity 0 |
| shadow refresh, minimum gap (lighting) | 1 s                                                                                                                              | 2 s         | none                    |
| bloom blur mips (atmosphere, #148)     | 5                                                                                                                                | 4           | 3                       |
| bloom resolution ratio                 | 1                                                                                                                                | 0.5         | 0.5                     |
| rain instances                         | 100 %                                                                                                                            | 50 %        | 0 %                     |
| clouds, searchlights                   | on                                                                                                                               | on          | hidden                  |
| buildings LOD0 radius (#140)           | 380 m                                                                                                                            | 250 m       | no LOD0                 |
| interior mapping                       | on (LOD0)                                                                                                                        | on (LOD0)   | off (no LOD0)           |
| bridge detail on / off distance (#141) | 600 / 660 m                                                                                                                      | 400 / 440 m | base only               |
| point lights in use (neon, #144)       | 6                                                                                                                                | 4           | 0 (all 6 stay, faded)   |
| halos, road reflections, fountain      | on                                                                                                                               | on          | off                     |
| ground / highway / flying traffic      | 100 %                                                                                                                            | 70 %        | 40 %                    |
| signs, fog, window lights              | on                                                                                                                               | on          | on (never dropped)      |
| terrain                                | no runtime knob: three static merged meshes, the forest is vertex color and canopy height, water ripples are a boot-only program |

Measured per PR on the M4 under the heavy-job lock (init within 1.07× of main, 37 programs at
every tier): at the 반포대교 남단 night view calls go 87 → 85 → 74–79 (high → medium → low,
#148) and geometry 68.9 → 62.4 → 60.3 MB (#140); frame times are vsync-capped on the M4 and
only show on slower GPUs. Shadow updates requested by buildings and infra are to go through
lighting (`ctx.requestShadowUpdate`, #155) so that low runs no shadow pass at all.

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

**Update (manager, after async boot): target ~330 KB, ceiling 400 KB.** The lazy neon /
atmosphere chunks were dropped (they save nothing once the app chunk is evaluated beside the
worker, see "Result: async boot"), so 260 KB would only be reachable by loading modules after
`__city.ready`, which contradicts the boot goal. Initial JS is 342.1 KB on main 0d15df1 (app
chunk 214.5 KB, the shared three + city chunk ~122 KB). Taking the layout generator out of the
static graph (only the worker and the main-thread fallback import it; the app needs a few
constants) measured 342.1 → 327.2 KB and is done by hangang-seoul. `npm run size` warns above
330 KB and fails above 400 KB.

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
- **JS bundle.** lil-gui now loads only with `?debug` (#89): first chunk 298.7 → 291.9 KB gzip,
  lil-gui a 7.7 KB lazy chunk; without `?debug` modules get a chainable no-op stand-in. The 260
  KB target was later replaced by ~330 KB (see "JS bundle", update).
