# Performance

Budget: `docs/ART_DIRECTION.md` 11. This file records measured numbers; update the snapshot table in
every PR that changes performance, with before / after numbers in the PR body.

## How to measure

```sh
npm run perf -- <label>                  # real GPU (Metal ANGLE), builds first
npm run perf -- <label> --no-build --only=탑다운
npm run perf -- <label> --quality=low    # the CI tier
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

## Snapshot: main e2b7fef (lighting, infra, atmosphere, ux; terrain, buildings, neon are stubs)

Apple M4 (Metal ANGLE), 2400×1350 (DPR 1.5 held for every run), full quality, canvas 4× MSAA.

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
| GPU memory              | ≤ 200 MB / 320 MB         | ~10 MB scene + 99 MB canvas | canvas = 2400×1350 × 8 B × 4 MSAA samples        |
| module update CPU       | ≤ 1.5 / 3 ms              | ≤ 0.06 ms                   |                                                  |
| boot → interactive (M1) | ≤ 3 s / 10 s              | 0.4–0.5 s                   |                                                  |
| JS gzip                 | ≤ 260 / 400 KB            | 243.2 KB                    | **close to the target**                          |

## Findings and candidates

- **Day/night scrub stall (fixed).** Toggling the key light's `castShadow` changed the program
  variant of every lit material. With buildings (#11), preset 2, M4: a timeline jump between night
  and day added 8 programs (35 → 43) and stalled one frame for 0.57–1.26 s, both directions.
  Lighting now keeps `castShadow` fixed and sets `shadow.intensity` to 0 at night: 0 new programs,
  worst frame 16–18 ms for night → noon / sunset.
- **Leaving the noon palette (open).** Booted at noon, the first jump to sunset or night still
  stalls one frame for ~470 ms without any new program (sunset → night: 45 ms, noon → 15:00:
  8 ms). Not a recompile; under investigation.

- **MSAA on the canvas while post-processing is on.** The scene renders into atmosphere's HDR
  target, and the canvas only receives the final full-screen pass, so `antialias: true` on the
  canvas costs 74 MB (3 of the 4 samples) and a resolve per frame for nothing. Candidate fix:
  create the renderer without canvas MSAA when post is active (MSAA on the HDR target instead).
- **Programs and textures.** 28–30 programs and 19–21 textures before buildings and neon arrive.
  Modules should share materials and `onBeforeCompile` variants. The low tier (no post, rain,
  clouds, searchlights, shadows) has 12 programs and 3 textures, so those features account for
  16–18 programs and 16–18 textures.
- **Cold shader cache.** An early run (whose GPU probe did not boot the app) showed first-frame
  0.5–0.9 s, later runs 31–79 ms; the OS shader cache likely explains it. Re-check once buildings
  and neon add programs.
- **JS bundle.** 243 KB gzip, 17 KB under the target with half the modules still stubs.
