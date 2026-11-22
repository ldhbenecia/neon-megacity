# Neon Megacity

Browser-based, mouse-explorable cyberpunk city built with three.js (r0.187) + Vite + **TypeScript (strict)**.
The city is an ORIGINAL design inspired by cyberpunk anime aesthetics.

## Commands
- `npm run dev` — dev server (Vite)
- `npm run typecheck` — `tsc --noEmit`; must pass
- `npm run lint` / `npm test` — ESLint, Vitest unit tests; must pass
- `npm run build` — production build; must pass before any commit
- `npm run preview` — serve `dist/`

## Architecture
Read `docs/ARCHITECTURE.md` before editing. Summary:
- `src/main.js` owns renderer, camera, OrbitControls, loop, GUI root.
- Each feature folder exports `init(ctx) -> { update(dt, elapsed) }`. Order: lighting → buildings → neon → atmosphere.
- `src/city/layout.js` is the single source of truth for block / road / building positions. Never place objects using hard-coded coordinates that bypass it.
- `ctx.env` fields have a single owner (see ARCHITECTURE.md). Only the owner writes a field; everyone else reads it.

| folder | owns |
|---|---|
| `src/lighting/` | time of day, sun/moon, sky, shadows, exposure, `env.horizonColor/skyColor` |
| `src/buildings/` | ground, roads, building geometry, windows |
| `src/neon/` | signs, holograms, street lights, ground + flying traffic |
| `src/atmosphere/` | fog, rain, stars, clouds, searchlights, post-processing (`ctx.render`) |

## Rules
- TypeScript only (`.ts`), `strict: true`. No `any` unless commented with a reason; no `@ts-ignore` (use `@ts-expect-error` with a reason). Shared types (`Ctx`, `Env`, `CityModule`) live in `src/core/types.ts`.
- Pure logic (layout, time-of-day math, placement) lives in side-effect-free functions with unit tests in `tests/`.
- Use only current three r0.187 APIs. No deprecated APIs (`Clock` → `Timer`, `outputEncoding` → `outputColorSpace`, `mergeBufferGeometries` → `mergeGeometries`, set `colorSpace` on color textures).
- No external asset files or CDNs: all textures are procedural (canvas / shaders).
- No real brands, logos, or names/characters/places from existing games or anime. Invent fictional names.
- Performance budget: 60fps on a laptop. Prefer `InstancedMesh`, merged geometry, texture atlases, and shader-uniform animation over per-object CPU work. ≤ 8 real PointLights total.
- Deterministic randomness only via `createRng` from `src/core/random.js`.
- Dispose GPU resources you create in `dispose()`.

## Workflow
- Conventional commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`); one logical change per commit.
- Visual changes are verified with screenshots (`scripts/screenshot.mjs`, output in `screenshots/`, gitignored), not by reading code alone.
- Never force-push, never rewrite history, never read `.env` or credentials.
