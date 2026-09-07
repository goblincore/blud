# FPS / legacy repo-structure design

- **Date:** 2026-09-07
- **Status:** approved (Stage 1 of 2). Stage 2 is the physical migration and is
  **pending**, not executed.
- **Scope:** correct navigation and launch commands without moving runtime files.

## Problem

The repository does not make the active SDF FPS obvious. `CLAUDE.md` introduced
the old sprite/voxel-gib game as current, `TASKS.md` mixes active SDF work with
extensive old history, and the ambiguous entries point at stale plans. Meanwhile
the active game lives under a path (`src/lab/sdf-zombie`) whose "lab" label reads
as obsolete, and the retired sprite/bestiary/arena/NotBlood simulation is kept
runnable as a behavior reference for dynamite and gibbing.

## Goals

1. Make the active SDF FPS obvious to agents and humans.
2. Retain a runnable old game for dynamite/gibbing reference.
3. Prepare an exact, dependency-aware physical migration plan (Stage 2).

## Non-goals (Stage 1)

- No physical renames, no broad test/build split, no root-page change.
- No behavior, renderer, tuning, or asset changes.
- No full-suite tests, production builds, GPU captures, previews, dependency
  installation, or heavy indexing.

## Target layout (Stage 2, proposed — not executed)

```
src/fps/      # active game / tooling / benchmarks / modules
src/legacy/   # retired runtime (old game, old sim, old gib stack)
src/shared/   # ONLY real dual consumers (small boundary)
```

Rules:

- **Active project:** SDF-rendered FPS, currently `src/lab/sdf-zombie`
  (character authoring tools, WebGPU lab, benchmarks, supporting modules). The
  lab name does not mean obsolete code.
- **Retired project:** sprite/bestiary/arena procedural generation + old
  NotBlood simulation. Kept runnable for behavior comparison (dynamite,
  gibbing). Never deleted; historical roadmap entries are reference, not
  current work.
- **`src/shared`** is used **only** where a consumer actually imports from both
  projects. The clear-cut case is `game/gibs/tuning.ts` (pure data consumed by
  both) and its `notblood-tables.gen.ts` dependency; also `muzzle-pos.ts`,
  `renderer.ts`, `post-fx/*`, `theme-material-set.ts`.

## Staging

- **Stage 1 (this):** documentation navigation + launch commands only. No moving
  runtime files. All existing HTML entry URLs and runtime code paths stay
  unchanged; the old `/index.html` still serves legacy — documented as a
  transition.
- **Stage 2:** physical migration. Starts **only after** the in-flight
  deferred-rendering migration has been reviewed and integrated, and after
  Stage 1 is committed. Task completion alone does not satisfy that gate.

## Launch / build / test intent

After Stage 1, package scripts are exactly:

```json
"dev": "vite --open /sdf-game.html",
"dev:fps": "vite --open /sdf-game.html",
"dev:legacy": "vite --open /index.html"
```

- `npm run dev` and `dev:fps` open the **active** game.
- `dev:legacy` opens the **retired** game.
- Plain `npx vite` stays non-opening for browser-free automation
  (`scripts/lab-servers.sh` uses `npx vite`).
- `build`/`test` still cover the existing combined tree until Stage 2. A full
  active/legacy/all command split is a Stage 2 deliverable.

## Compatibility

- Every existing HTML entry URL and runtime code path is preserved in Stage 1.
- Vite's checkout-local `.vite` cache is preserved.
- Node modules are shared through the worktree symlink; do not reinstall.

## Dependency extraction

Before moving anything, map **direct and transitive** dependencies between
active game/tooling, old game and shared code — runtime imports, `?raw`/`.blob`/
`.glb` assets, scripts, Vite entrypoints, TypeScript/Vitest globs, `dev-save`
paths and generated-output paths. Preserve assets/scripts whose consumers cross
both projects. See the [Stage 2 plan](../plans/2026-09-07-fps-legacy-repo-structure.md).

## Validation & integration prerequisite

- Stage 2 begins only after the deferred-rendering migration is reviewed and
  integrated **and** Stage 1 is in place.
- Before Stage 2 moves: verify no active runtime import from legacy, no shared
  import that belongs to a single side, old game still runnable, active FPS and
  authoring tools work, old references/provenance retained, and test
  counts/baselines preserved. No gameplay or renderer tuning changes.

## Stage 1 verification (lightweight only)

HTTP/config validation is enough for these documentation + npm-script changes.
No browser launch, no GPU capture, no full build/test.

- `npm` script metadata and `vite --open [path]` CLI support.
- A temporary Vite server (programmatic `createServer`, `open:false`) to bind
  a port, GET both HTML pages, and confirm the expected module entrypoint in
  each response. Always `await server.close()`.
- JSON validity and `git diff --check`.

## Interaction constraints

- A separate M2 dispatcher runs GPU checks on ports 5326/9326. Never stop
  others' processes or touch their worktrees/plans. No merge/push/main-checkout
  changes here.
- Use `~/.config/dualmem/bin/dualmem-run` for memory. No `MEMORY.md` or
  `/memory/` persistence. Record durable code facts with `--files`.
