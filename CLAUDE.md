# Neon Megacity

Browser-based, mouse-explorable cyberpunk city built with three.js (r0.187) + Vite + **TypeScript (strict)**.
The city is an ORIGINAL design inspired by cyberpunk anime aesthetics.

## Commands

- `npm run dev` — dev server (Vite)
- `npm run typecheck` — `tsc --noEmit` for `tsconfig.json` (src/: DOM + `vite/client`, no Node types) and `tsconfig.node.json` (tests, scripts, configs: Node types); must pass
- `npm run lint` / `npm test` — ESLint, Vitest unit tests; must pass
- `npm run build` — typecheck + production build; must pass before any commit
- `npm run format:check` / `npm run format` — Prettier check / write; must pass
- `npm run test:e2e` — Playwright smoke tests (builds and serves on a per-worktree port; `E2E_PORT` overrides, and `SHOTS_PORT` / `PERF_PORT` do the same for `shots` and `perf`). An already-running server is never reused
- `npm run shots -- [label] [--swiftshader|--gpu] [--no-build] [--only=<substring>] [--burst] [--black-limit=<percent>]` — deterministic screenshots into `screenshots/<label>/` (real GPU by default on macOS). Each shot prints its mean luminance and near-black pixel ratio and fails above the limit; `--burst` also shoots frame by frame while zooming, flying and orbiting
- `npm run perf` — real-GPU measurements (frame time, draw calls, memory, boot time); results and budgets live in `docs/PERF.md`
- `npm run size` — first-load JS gzip size of `dist/`; fails above 400 KB, warns above the 260 KB target
- `npm run preview` — serve `dist/`

## Architecture

Read `docs/ARCHITECTURE.md` before editing. Summary:

- `src/main.ts` owns renderer, camera, OrbitControls, loop, GUI root, URL query hooks and `window.__city`.
- Each feature folder exports `init(ctx) -> { update(dt, elapsed), dispose() }` from `index.ts`. Order: lighting → terrain → buildings → infra → neon → atmosphere. `src/ux/` (loader, camera rig, HUD) is driven by main directly.
- `src/city/layout.ts` (layout v2, types in `src/city/types.ts`) is the single source of truth for zones, river, bridges, highways, roads and building specs/tiers. Never place objects using hard-coded coordinates that bypass it.
- `ctx.env` fields have a single owner (see ARCHITECTURE.md and `src/core/types.ts`). Only the owner writes a field; everyone else reads it.
- `env.timeLocked` is set at boot when `?time=` is given; lighting must then not advance `env.timeOfDay`.
- URL query hooks (`src/core/query.ts`): `?time=0..1`, `?cam=overview|street|core|topdown|skyline` (poses via `cameraPreset(name)`), `?rain=0..1`, `?nogui`, `?quality=high|medium|low` (user tier chosen by hand, `env.quality`), `?quality=ci` (software-GL test tier for CI).
- UX query hooks (`src/ux/query.ts`): `?pose=px,py,pz,tx,ty,tz` (initial camera; wins over `?cam` and `?preset`), `?preset=1..8`, `?hud=0`, `?stats`, `?debug` (lil-gui panel and shader error checks).
- `window.__city = { ready, frames }` is updated every frame; e2e tests and the screenshot script wait on it. Don't remove it.
- Colors and exposure constants come from `src/core/palette.ts`; visual targets are in `docs/ART_DIRECTION.md`.

| folder            | owns                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/lighting/`   | time of day, sun/moon, sky, shadows, exposure, `env.horizonColor/skyColor/neonGain/windowLitRatio`, palette    |
| `src/terrain/`    | ground heightfield, river water and banks, parks, far ridges                                                   |
| `src/buildings/`  | roads, sidewalks, building geometry, windows, rooftop props, trees                                             |
| `src/infra/`      | elevated highways, pillars, ramps, bridges                                                                     |
| `src/neon/`       | signs, holograms, street lights, ground + highway + flying traffic                                             |
| `src/atmosphere/` | fog, rain, stars, clouds, searchlights, post-processing (`ctx.render`), `env.rain/wetness/fogColor/fogDensity` |
| `src/ux/`         | loader, camera rig, HUD, `env.powerOn/timeLocked/selectedBuilding`, boot in `src/main.ts`                      |

## Rules

- TypeScript only (`.ts`), `strict: true`. No `any` unless commented with a reason; no `@ts-ignore` (use `@ts-expect-error` with a reason). Shared types (`Ctx`, `Env`, `CityModule`) live in `src/core/types.ts`.
- Pure logic (layout, time-of-day math, placement) lives in side-effect-free functions with unit tests in `tests/`.
- Use only current three r0.187 APIs. No deprecated APIs (`Clock` → `Timer`, `outputEncoding` → `outputColorSpace`, `mergeBufferGeometries` → `mergeGeometries`, set `colorSpace` on color textures).
- No external asset files or CDNs: all textures are procedural (canvas / shaders). One exception: the visitor statistics tag (GA4, `src/ux/analytics.ts`) is loaded from Google after boot, only on the deployed site, never in tests or local runs, and visitors can turn it off.
- 실제 서울 지리(지명, 대교, 지역구, 산)는 사용한다. 궁궐 같은 역사 유적(경복궁의 광화문, 근정전, 경회루 등)은 실제 이름과 배치를 따른다. 실존 브랜드·기업 로고·상호 금지. 현대의 실존 건물은 복제하지 않고 실루엣만 연상. 기존 게임·애니메이션의 이름·캐릭터·장소 금지. 한자 금지. (`docs/SEOUL.md`)
- 코드 주석은 코드만으로 알 수 없는 필수 정보만 쓴다.
- 고층 미디어(거대 스크린, 링 광고판, 옥상 크라운, 가상 기업 로고)는 영어, 저층 간판은 한글로 쓴다. 아파트 단지명은 고층이어도 한글로 쓴다.
- `env.quality`를 읽는 품질 분기 코드는 어느 모듈 폴더에 있든 성능 작업을 맡은 쪽이 소유한다. 필드 값 자체는 ux가 부팅 때 쓴다.
- Performance budget: 60fps on a laptop. Prefer `InstancedMesh`, merged geometry, texture atlases, and shader-uniform animation over per-object CPU work. ≤ 8 real PointLights total.
- Deterministic randomness only via `createRng` from `src/core/random.ts`.
- Dispose GPU resources you create in `dispose()`.

## Workflow

- Conventional commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`); one logical change per commit. Type/scope in English, subject and body in Korean (e.g. `ci: CI 워크플로 추가`). PR titles follow the same format.
- Visual changes are verified with screenshots (`npm run shots -- <label>`, script `scripts/screenshot.ts`, output in `screenshots/<label>/`, gitignored), not by reading code alone.
- CI (`.github/workflows/ci.yml`): every PR runs `check` (format:check, lint, typecheck, unit tests, build, `npm run size`; about 3 minutes). A push to `main` runs `check` plus `smoke` (`tests/e2e/smoke.spec.ts` on SwiftShader with `?quality=ci`), and a newer push cancels the run in progress. The full Playwright suites (`ux`, `overlays`, `perf`) run only by hand (`e2e-full.yml`, or `npm run test:e2e` locally); run them when a change touches camera, HUD or budgets. In e2e, wait on frames or conditions (`waitFrames`, `holdUntil`, `waitMode`), never on wall-clock time.
- Code PRs are merged in batches: when a PR is reviewed and its `check` is green, the batch is merged into a scratch branch on top of `main`, the fast checks and the smoke spec run there, and then the PRs are merged in a row. Two PRs that are each green can still break `main` together. PRs that change only docs are merged on their own.
- Shader, post-processing, lighting and material changes are checked at full quality on a real GPU, at noon, sunset and night, both idle and while the camera moves. CI runs on SwiftShader in the `ci` tier and does not reproduce NaN artifacts; `npm run perf` on a real GPU fails when a frame is mostly black.
- Autofix (`autofix.yml`) pushes `style: 린트 및 포맷 자동 수정` commits as github-actions[bot] to same-repo PR branches, then dispatches CI for them. Pull before pushing again.
- Pages (`pages.yml`) deploys `main` after CI passes on it (`workflow_run`) to https://ldhbenecia.github.io/neon-megacity/ with `BASE_PATH=/neon-megacity/`; locally `base` stays `./`.
- Never force-push, never rewrite history, never read `.env` or credentials.
