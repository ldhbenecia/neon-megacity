# Neon Megacity

Browser-based, mouse-explorable cyberpunk city built with three.js (r0.187) + Vite + **TypeScript (strict)**.
The city is an ORIGINAL design inspired by cyberpunk anime aesthetics.

## Commands

- `npm run dev` — dev server (Vite)
- `npm run typecheck` — `tsc --noEmit` for `tsconfig.json` (src/: DOM + `vite/client`, no Node types) and `tsconfig.node.json` (tests, scripts, configs: Node types); must pass
- `npm run lint` / `npm test` — ESLint, Vitest unit tests; must pass
- `npm run build` — typecheck + production build; must pass before any commit
- `npm run format:check` / `npm run format` — Prettier check / write; must pass
- `npm run test:e2e` — Playwright smoke tests (builds and serves on :4173)
- `npm run shots -- [label] [--swiftshader] [--no-build]` — deterministic screenshots into `screenshots/<label>/`
- `npm run preview` — serve `dist/`

## Architecture

Read `docs/ARCHITECTURE.md` before editing. Summary:

- `src/main.ts` owns renderer, camera, OrbitControls, loop, GUI root, URL query hooks and `window.__city`.
- Each feature folder exports `init(ctx) -> { update(dt, elapsed), dispose() }` from `index.ts`. Order: lighting → terrain → buildings → infra → neon → atmosphere. `src/ux/` (loader, camera rig, HUD) is driven by main directly.
- `src/city/layout.ts` (layout v2, types in `src/city/types.ts`) is the single source of truth for zones, river, bridges, highways, roads and building specs/tiers. Never place objects using hard-coded coordinates that bypass it.
- `ctx.env` fields have a single owner (see ARCHITECTURE.md and `src/core/types.ts`). Only the owner writes a field; everyone else reads it.
- `env.timeLocked` is set at boot when `?time=` is given; lighting must then not advance `env.timeOfDay`.
- URL query hooks (`src/core/query.ts`): `?time=0..1`, `?cam=overview|street|core|topdown|skyline` (poses via `cameraPreset(name)`), `?rain=0..1`, `?nogui`.
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
- No external asset files or CDNs: all textures are procedural (canvas / shaders).
- 실제 서울 지리(지명, 대교, 지역구, 산)는 사용한다. 실존 브랜드·기업 로고·상호 금지. 실존 건물은 복제하지 않고 실루엣만 연상. 기존 게임·애니메이션의 이름·캐릭터·장소 금지. 한자 금지. (`docs/SEOUL.md`)
- 코드 주석은 코드만으로 알 수 없는 필수 정보만 쓴다.
- Performance budget: 60fps on a laptop. Prefer `InstancedMesh`, merged geometry, texture atlases, and shader-uniform animation over per-object CPU work. ≤ 8 real PointLights total.
- Deterministic randomness only via `createRng` from `src/core/random.ts`.
- Dispose GPU resources you create in `dispose()`.

## Workflow

- Conventional commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`); one logical change per commit. Type/scope in English, subject and body in Korean (e.g. `ci: CI 워크플로 추가`). PR titles follow the same format.
- Visual changes are verified with screenshots (`npm run shots -- <label>`, script `scripts/screenshot.ts`, output in `screenshots/<label>/`, gitignored), not by reading code alone.
- CI (`.github/workflows/ci.yml`) runs format:check, lint, typecheck, unit tests, build and e2e on every PR and push to main.
- Autofix (`autofix.yml`) pushes `style: 린트 및 포맷 자동 수정` commits as github-actions[bot] to same-repo PR branches, then dispatches CI for them. Pull before pushing again.
- Pages (`pages.yml`) deploys `main` after CI passes on it (`workflow_run`) to https://ldhbenecia.github.io/neon-megacity/ with `BASE_PATH=/neon-megacity/`; locally `base` stays `./`.
- Never force-push, never rewrite history, never read `.env` or credentials.
