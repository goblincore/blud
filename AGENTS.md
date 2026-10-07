# Blud — agent context

This file is the cross-harness entry point for coding agents (Claude Code,
Codex, DSH, etc.). It is intentionally concise. **The status board is
[TASKS.md](TASKS.md); the current vs. proposed source layout is
[docs/architecture/repository-map.md](docs/architecture/repository-map.md); which
module owns what is in the generated
[docs/architecture/module-index.md](docs/architecture/module-index.md).**

## Active vs. retired — read this first

- **Active project:** the SDF-rendered FPS under
  [`src/lab/sdf-zombie/`](src/lab/sdf-zombie). The `lab` path is a historical
  name, **not** obsolete code. This is the game plus its character-authoring
  tools, WebGPU lab, benchmarks and modules. It keeps its existing default
  renderer; the retired game and the active game's legacy rendering mode are
  different concepts. Deferred rendering stays opt-in.
- **Retired project:** the sprite/bestiary/arena procedural-generation game and
  the old NotBlood simulation. It is reference-only for behavior comparison
  (dynamite, gibbing) **unless explicitly requested.** Do not treat historical
  roadmap entries as current work.

**Do not conflate two different concepts:**

| Concept | What it is |
| --- | --- |
| Retired game | A separate, older gameplay implementation (`src/main.ts`) |
| Active game's legacy rendering mode | The *renderer* for the current game, not the old game |

## Paths

- Active entrypoint: `/sdf-game.html` → `src/lab/sdf-zombie/webgpu/game-main.ts`
- Character/tooling labs: `/sdf-lab.html`, `/sdf-lab-webgpu.html`
- Retired entrypoint: `/index.html` → `src/main.ts`

**Stage 1 keeps every existing HTML URL path and runtime code path unchanged.**
`npm run dev` / `dev:fps` now open `/sdf-game.html`; `dev:legacy` opens
`/index.html`; plain `npx vite` stays non-opening for browser-free automation.
The old `/index.html` still serves legacy until Stage 2.

## Finding and placing code

- **Find it:** [docs/architecture/module-index.md](docs/architecture/module-index.md)
  lists every module of the active tree with a one-line summary, grouped by
  area. Grep it before you grep the tree.
- **Every module starts with a header comment** whose first sentence says what
  the module owns (`// <path>`, a blank `//`, then the sentence). The index is
  generated from it. After adding, moving or re-describing a module, run
  `npx tsx scripts/module-index.ts`; `scripts/module-index.test.ts` fails
  otherwise.
- **Do not grow `webgpu/game-main.ts`.** A new feature goes in its own module
  beside it (as `game-flail.ts`, `game-axe.ts`, `game-head-split.ts` do): state
  in the matching `game-state-<slice>.ts`, logic in pure functions that take the
  `GameContext`, and only the wiring call in `game-main.ts`.
- **Name a module for what it holds**, not for how it was made (no new
  `-leaves`, `-misc`, `-2` files).

## Rules

- **Memory:** Every session starts by running **both** launcher commands:

  ```
  ~/.config/dualmem/bin/dualmem-run context "session context" --budget 3000
  ~/.config/dualmem/bin/dualmem-run context "session context" --budget 1500 --ns claude:infra
  ```

  Search memory **before** broad grep/glob exploration for how something works or
  where it lives. **Do not** create a `MEMORY.md` or a `/memory/` persistence.
  Record durable code facts with `--files` pinned to the source file(s).
- **Verification:** Run the verification appropriate to the change. Locally that is
  `npm run typecheck` and `npm run test:changed` (the tests beside the files your
  branch changed, plus the source guards), or `npx vitest run <path>` for one area.
  **Do not run the full suite locally** unless asked: it takes about ten minutes of
  every core, and CI (`.github/workflows/ci.yml`) runs it on every push. After a
  push, read the result with `gh run list --branch <branch>` / `gh run view`. The
  GPU gates are not in CI; run the ones your change touches by hand. Coordinate any
  GPU / heavy job to avoid concurrent measurements; own and clean up only your
  own resources; respect user-authorized work and preserve unrelated edits.
- **Resource ownership:** Extracted Blood assets are **dev placeholders only** —
  never commit, never ship. `.gitignore` enforces this (`public/assets/**/*-placeholder*`,
  `assets-source/blood-extracted/`, `public/assets/post-fx/`,
  `public/assets/map-research/`). `scripts/link-dev-assets.sh` links them from the
  primary checkout into a worktree; it does not extract them for a fresh clone.
- **Plans:** start every implementation plan from
  [`docs/superpowers/plan-template.md`](docs/superpowers/plan-template.md) and
  carry its **Rules for every task** block into the plan. The key rule: game
  logic in pure, renderer-free, tested modules; load-bearing rendering in
  hand-written WGSL — the release is a Rust + wgpu port (production scope §4.6).
- **Shared modules:** some `src/game/*` modules are shared by both projects
  (e.g. `game/gibs/tuning.ts`, `game/weapons/muzzle-pos.ts`). Pay attention to
  provenance — do not move the old tree blindly. See the repository map.

## Verdicts & constraints

- Prefer evidence over claims: run the verification, record the output, report
  limits honestly. Do not claim a full build/test/gameplay/GPU pass from
  lightweight checks.
- **Repo boundaries:** Don't merge/push or edit the primary checkout beyond the
  user-authorized scope of the current task; preserve unrelated edits. Transient
  task constraints (e.g. "no GPU, no build, no main-checkout edits" for a specific
  dispatch) belong in that task's dated plan/dev-notes, not here — this file sets
  durable guidance and does not add approval requirements for routine authorized
  development.

## Accepted skeleton default — 2026-09-08

Forward FPS actor skeletons now default to mesh in development and production.
Use `?skeleton=procedural` for the SDF reference; `?skeleton=volume` remains
dev-only. Deferred rendering and detached chunks retain procedural bones.
The mesh path lives in `webgpu/skeleton-spike/` despite the historical name.
Skull geometry/eye damage and material polish are accepted; stop further polish
unless requested. Torso cavity brightness remains a documented limitation.
See `docs/dev-notes/2026-09-07-skeleton-comparison/wrap-up.md`.
