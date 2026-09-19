# Blud — Claude Code project context

Blood-inspired FPS. TypeScript + Three.js. (Rapier3D.js is used only by the
retired sprite game, not the active SDF FPS.)

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
  ship. `.gitignore` enforces this for `public/assets/**/*-placeholder*`,
  `assets-source/blood-extracted/`, `public/assets/post-fx/` and
  `public/assets/map-research/`.
- The **active FPS** (`/sdf-game.html`) uses tracked `public/assets/lab/*` assets
  and needs no placeholder link. The **retired game** (`/index.html`) and the
  lab's post-fx path need dev assets: run
  [`scripts/link-dev-assets.sh`](scripts/link-dev-assets.sh) once per worktree to
  symlink the gitignored placeholders from the primary checkout into the worktree
  (it fills holes only; it does not extract for a fresh clone). The **WebGL lab**
  (`/sdf-lab.html`) post-fx additionally loads `/assets/post-fx/BLOOD.PAL.png`.

## Repo layout

| Path | Purpose |
| --- | --- |
| `src/lab/sdf-zombie/` | Active SDF game + character tools + WebGPU lab + benchmarks |
| `src/game/`, `src/sim/`, `src/main.ts` | Retired game + old NotBlood sim (reference only) |
| `docs/game/` | Game design and content: vision, production scope, the flat, per-level design + tasks |
| `docs/superpowers/specs/` | Design specs (one per direction change) |
| `docs/superpowers/plans/` | Implementation plans (one per milestone) |
| `docs/tuning-sources.md`, `docs/tuning-sources-gibs.md` | NotBlood value sources |
| `docs/dev-notes/` | Ad-hoc dev notes |
| `public/` | Static web assets served by Vite |

## Guardrails

- Extracted Blood assets: dev placeholders only, never commit/ship.
- Prefer focused tests; don't claim a build/test/GPU pass from lightweight checks.
- Plans start from [`docs/superpowers/plan-template.md`](docs/superpowers/plan-template.md):
  logic in pure renderer-free modules, rendering in hand-written WGSL (release
  is a Rust + wgpu port).
- When in doubt, update `TASKS.md` to reflect new state.
