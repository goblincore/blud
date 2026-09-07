# Blud — Claude Code project context

Blood-inspired FPS. TypeScript + Three.js + Rapier3D.js.

**The active project is the SDF-rendered FPS** in
[`src/lab/sdf-zombie/`](src/lab/sdf-zombie) (the "lab" name is historical, not a
marker of obsolete code). The retired sprite/bestiary/arena/NotBlood game is
reference-only for behavior comparison (dynamite, gibbing).

## Start here

- **Status board:** [`TASKS.md`](TASKS.md) — in-flight, blocked, done, next action.
- **Source map (current vs. proposed):** [`docs/architecture/repository-map.md`](docs/architecture/repository-map.md)
- **Legacy dynamite/gibbing reference:** [`docs/reference/legacy-dynamite-gibbing.md`](docs/reference/legacy-dynamite-gibbing.md)
- **Cross-harness agent context:** [`AGENTS.md`](AGENTS.md)

## Running

| Command | Opens | Target |
| --- | --- | --- |
| `npm run dev` / `npm run dev:fps` | `/sdf-game.html` | Active SDF FPS |
| `npm run dev:legacy` | `/index.html` | Retired legacy game |
| `npx vite` | *(no browser)* | Plain server for automation |

The retired game and the active FPS's *legacy rendering mode* are **different
concepts** — do not conflate them.

## Assets

- **Extracted Blood assets are dev placeholders only** — never commit, never
  ship. `.gitignore` enforces this for `public/assets/**/*-placeholder*` and
  `assets-source/blood-extracted/`.
- [`scripts/link-dev-assets.sh`](scripts/link-dev-assets.sh) links the gitignored
  placeholders from the primary checkout into a worktree (run once per worktree,
  or the game will not boot). It does not extract them for a fresh clone.

## Repo layout

| Path | Purpose |
| --- | --- |
| `src/lab/sdf-zombie/` | Active SDF game + character tools + WebGPU lab + benchmarks |
| `src/game/`, `src/sim/`, `src/main.ts` | Retired game + old NotBlood sim (reference only) |
| `docs/superpowers/specs/` | Design specs (one per direction change) |
| `docs/superpowers/plans/` | Implementation plans (one per milestone) |
| `docs/tuning-sources.md`, `docs/tuning-sources-gibs.md` | NotBlood value sources |
| `docs/dev-notes/` | Ad-hoc dev notes |
| `public/` | Static web assets served by Vite |

## Guardrails

- Extracted Blood assets: dev placeholders only, never commit/ship.
- Prefer focused tests; don't claim a build/test/GPU pass from lightweight checks.
- When in doubt, update `TASKS.md` to reflect new state.
