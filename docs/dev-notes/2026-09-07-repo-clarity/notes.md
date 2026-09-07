# Repo clarity — Stage 1 notes

- **Date:** 2026-09-07
- **Branch:** `codex/dispatch/2026-09-07-repo-clarity-stage1`
- **Base:** `c120a3e7`
- **Type:** navigation/documentation + npm-script correction. **No runtime code,
  asset, renderer or behavior changes.**

## What this stage did

Made the active SDF FPS obvious and the retired game explicitly reference-only,
corrected the launch commands so the active game is the default, and produced the
dependency-aware Stage 2 handoff plan (still pending, not executed).

## Changed files

- `README.md` — **created.** Human entry: active project statement, setup,
  `dev`/`dev:fps`/`dev:legacy` commands and explicit URLs, character-lab URLs,
  docs links, build/test note.
- `AGENTS.md` — **created.** Cross-harness entry: active paths first, retired
  game reference-only, retired-game vs active-legacy-renderer distinction,
  DualMem/no-`MEMORY.md` rules, focused tests/resource ownership, source-map/status
  links, asset guardrails.
- `CLAUDE.md` — **rewritten** as a short pointer with accurate active scope; removed
  stale April "current plan" and old queued-task execution instructions; kept asset
  setup guidance through canonical links.
- `TASKS.md` — **orientation banner** added near the top identifying historical vs
  active entries and linking the repository map. Content preserved; no checkboxes
  reinterpreted.
- `docs/architecture/repository-map.md` — **created.** Current-state tree (facts),
  active-tree entrypoints, verified external-import edges, shared-set definition,
  and a clearly labeled target-state tree.
- `docs/reference/legacy-dynamite-gibbing.md` — **created.** Behavior → legacy source
  → current SDF counterpart, with units/provenance, presentation-vs-authoritative-sim
  distinction, and comparison run instructions.
- `docs/superpowers/specs/2026-09-07-fps-legacy-repo-structure-design.md` — **created.**
  Approved design: staging, target boundaries, launch/build/test intent,
  compatibility, dependency extraction, validation/integration prerequisite. Stage 2
  stated as pending.
- `docs/superpowers/plans/2026-09-07-fps-legacy-repo-structure.md` — **created.**
  Dependency-aware Stage 2 plan (pending, gated on deferred integration + Stage 1).
- `docs/dev-notes/2026-09-07-repo-clarity/notes.md` — **this file.**
- `package.json` — **modified.** `dev` and `dev:fps` → `vite --open /sdf-game.html`,
  `dev:legacy` → `vite --open /index.html`. All other commands unchanged. No other
  file (lockfile, HTML entrypoints, `vite.config.ts`, runtime modules, server scripts)
  touched.

## Validation evidence (lightweight, per stage intent)

- `package.json` parses as valid JSON (`node -e "JSON.parse(...)"` → ok). The three
  script strings are exactly as spec'd; all other scripts preserved.
- `git diff --check` → clean (no whitespace errors).
- Vite CLI supports `--open [path]` (`vite --help`).
- Programmatic `createServer` smoke test
  (`server: { host: '127.0.0.1', port: 0, open: false, strictPort: false }`):
  bound port `5173`; `GET /sdf-game.html` → `200` with entrypoint
  `src/lab/sdf-zombie/webgpu/game-main.ts`; `GET /index.html` → `200` with
  entrypoint `src/main.ts`; `server.close()` awaited in `finally`. No browser
  launched, no game modules fetched/executed.

## Limitations — what is NOT claimed

- **No** full `npm run build` / `tsc --noEmit` / `vitest run` was run here (out of
  scope for these doc/script changes; a separate M2 dispatcher is running GPU checks).
- **No** gameplay, renderer, GPU, or visual verification.
- The `createServer` check validates **serving and command intent only**, not
  gameplay or GPU acceptance. `port: 0` resolved to `5173` (Vite default) — the
  bound port was inspected from the live HTTP server, not assumed.
- All existing HTML entry URLs and runtime code paths are **unchanged**; `/index.html`
  still serves legacy until Stage 2.

## Exact next step

Coordinate with the M2/integration gate: once the in-flight deferred-rendering work
is reviewed and integrated **and** Stage 1 is committed, re-run the import scan at
the new HEAD, then execute
[`docs/superpowers/plans/2026-09-07-fps-legacy-repo-structure.md`](../../superpowers/plans/2026-09-07-fps-legacy-repo-structure.md).
No Stage 2 work is queued by this stage.

---

## Review corrections (2026-09-07, post Stage 1)

Stage 1 was reviewed by the coordinator and an independent reviewer. This section
records how each review finding was addressed and the source evidence used. It is
**docs-only**: no runtime/build/test/GPU/asset change and no new gameplay test was
run. The Stage 1 validation claims above ("Limitations") remain historical and are
unchanged.

### Finding 1 — wrong dynamite comparison entrypoint

- **Evidence:** `src/lab/sdf-zombie/webgpu/lab-main.ts` is the entry that wires
  dynamite/FPV — it imports `loadDynamiteProp` (`./dynamite-prop`),
  `makeFpvMode`/`enterFpvMode`/`exitFpvMode`/`stepFpvMode`/`forceThrow`
  (`../fpv-mode`), builds an `fpv: enter` button (`addButton(fpvBox,'fpv: enter',…)`)
  and toggles FPV on **Tab** (`if (ev.key === 'Tab')`). This serves `/sdf-lab-webgpu.html`.
- **Evidence:** `webgpu/game-main.ts` header line 13 states "NOT the lab: no panel, no
  wounds, no chunks, no dynamite." (`/sdf-game.html`, the active FPS, has no
  dynamite integration).
- **Evidence:** `fpv.ts` is `type CookPhase = 'idle' | 'cooking' | 'cooldown'`; on
  release it emits a `throw` **signal** (charge fraction + speed) and the wiring
  composes the direction and hands the flight to `dynamite-flight.ts`. There is no
  `'thrown'` phase; `overcook` returns to `idle`.
- **Fix:** reference guide §3 (reusable active-project modules vs playable FPS
  wiring; corrected `fpv` state machine and the `dynamite-prop` "active game path"
  label), §4 (comparison URL table: `/index.html` retired,
  `/sdf-lab-webgpu.html` = SDF dynamite demo via `fpv: enter`/Tab,
  `/sdf-game.html` = active FPS but **not** the dynamite demo). Repository map got a
  note; README got an "SDF dynamite/FPV demo" bullet.

### Finding 2 — invalid Stage 2 runtime acceptance

- **Fix:** plan §8 now scopes HTTP smoke to the **Stage 1 tier** (valid only because
  Stage 1 touches no runtime code) and sets a separate **Stage 2 tier** that
  requires real application/module/asset startup + error collection, authoring
  controls and save/reload paths, per-scope and combined tests/typecheck/build, and
  preserved baselines. The contradictory "physical relocation … not part of Stage
  2's initial move" sentence was removed.
- **Spec:** "no active runtime import from `src/legacy`" reframed as a **post-move
  acceptance invariant**, not an impossible pre-move prerequisite on today's
  intentionally mixed tree.

### Finding 3 — incorrect shared export inventory

- **Evidence:** grep across `src/lab/sdf-zombie/` finds **none** of
  `GibProfile`, `pickChunkPicnum`, `rollChunkCount`, `HUMANOID_FLESH_PICNUMS`,
  `BONE_PICNUMS`.
- **Evidence (actual per-symbol imports):**
  - `explosion-aoe.ts`: `BU_PER_METER`, `EXPLOSION_LAUNCH`, `EXPLOSION_STANDARD`,
    `EXPLOSION_VFX_HEIGHT_SCALE`, `GIB_THRESHOLD`, `GROUND_BURST_THRESHOLD_M`.
  - `blood-sim.ts`: `BLOOD_TRAIL`, `GIB_BURST`, `BLOOD_SPLAT`.
  - `dynamite-flight.ts` / `fpv.ts`: `DYNAMITE_COOK`, `BALLISTIC_BOUNDS`.
  - `hands.ts`: `DYNAMITE_COOK`. (Same symbols in the sibling `.test.ts` files.)
  - `webgpu/game-main.ts`: `dungeonMaterialSet` (`game/level/theme-material-set`),
    `muzzleWorldPosition` (`game/weapons/muzzle-pos`).
  - `lab-main.ts` (WebGL `/sdf-lab.html`): `createRenderer` (`engine/renderer`),
    `createPostFxComposer`/`PostFxBus`/`DEFAULT_POST_FX` (`vfx/post-fx/*`);
    `webgl-bench.ts` also imports `createRenderer`.
- **Fix:** plan §1.2/§2/§3.1 and repository-map §2 enumerate the exact shared set;
  the retired-only helpers/profiles/constants stay in `src/legacy`; the generated
  table (`notblood-tables.gen.ts`) and its writer
  (`scripts/gen_notblood_tables.py`) + consumers are documented; `src/shared` may
  hold non-application dependencies but must not import either application.

### Finding 4 — incomplete migration instructions

- **Fix:** plan rewritten with exact paths/commands (no ellipses / `'or'` / `'e.g.'` /
  `JSON.parse(...)`). `src/lab/sdf-zombie` → `src/fps` as a directory move preserving
  structure; `dev-save.ts` + `dev-save.test.ts` → `src/fps/`; legacy tree preserved
  under `src/legacy/` (incl. `src/legacy/game/gibs/tuning.ts` — no flattened
  `enemy-tuning`); muzzle `Vec3` → standalone object-shaped `MuzzleVec3` in
  `shared/vec.ts` (not the SDF tuple `Vec3`, not legacy `particles`);
  `index.html` = canonical active entry (same markup/module as `sdf-game.html`,
  query params preserved, no redirect), `legacy.html` = canonical retired entry
  (`dev:legacy` → `/legacy.html`, old callers switch), all existing lab/probe URLs
  preserved; `src/dev/theme-preview.ts` → `src/legacy/dev/theme-preview.ts`
  (theme-reference tool, `/theme-preview.html` preserved). Exact active/legacy/all
  build+test commands/configs/globs defined (§7) with scripts tests and combined
  typecheck retained. **Step 0** verifies M2 integrated, Stage 1 + corrections
  integrated, current HEAD/clean scope, and re-scans import/path strings at that
  HEAD. Final validation runs games/labs and exercises asset/save paths after the
  moves. The dead `§Revalidation` cross-reference was removed.
- **Command/config names are newly specified, not created** in this docs task.

### Finding 5 — temporary restrictions leaked into AGENTS

- **Fix:** AGENTS.md "Tests" bullet and the "No merge/push or primary-checkout
  edits" bullet replaced with durable guidance (verification appropriate to the
  change; coordinate GPU/heavy jobs to avoid concurrent measurements; own/clean only
  your resources; respect user-authorized work, preserve unrelated edits; no new
  approval requirements for routine authorized development). This dispatch's
  no-GPU/no-build/no-main constraints now live in this dated notes + the plan only.
  Both required startup commands were added explicitly:
  `~/.config/dualmem/bin/dualmem-run context "session context" --budget 3000` and
  `~/.config/dualmem/bin/dualmem-run context "session context" --budget 1500 --ns
  claude:infra`. Search-before-broad-exploration, the launcher, `--files` and the
  no-`MEMORY.md` rule are preserved.

### Finding 6 — unproven bit identity

- **Evidence:** `DYNAMITE_COOK.fuseMaxSec = 2.0` (`src/game/gibs/tuning.ts`) vs
  `THROW.fuseMaxTics = Math.round(1.5 * TICS_PER_SEC)` = `1.5 * 120`
  (`src/sim/projectile.ts`) — two different values. Float SDF flight vs fixed-point
  sim, and SDF-surface AoE vs sprite-center AoE, are not bit-identical.
- **Fix:** reference guide §3 adds a "Not bit-identical (intentional differences)"
  note citing those and the per-module, not cross-module, determinism. **No runtime
  change** was made to force the docs to match behaviour.

### Finding 7 — setup clarity

- **Fix:** README/CLAUDE now separate active tracked assets
  (`public/assets/lab/*`, no link needed) from the retired game's extracted sprite
  placeholders (the entrypoint that actually fails without them), and call out the
  specific WebGL-lab post-fx palette dependency (`/assets/post-fx/BLOOD.PAL.png`,
  `public/assets/post-fx/`, gitignored). `link-dev-assets.sh` is described as
  filling holes from the primary checkout, not as a fresh-clone extraction. Dev-only
  never-commit/never-ship guardrails preserved.

### Checks performed for this correction

- `git diff --check` clean.
- Only `README.md`, `AGENTS.md`, `CLAUDE.md` and files under `docs/` modified;
  `package.json`, lockfile, `vite.config.ts`, `tsconfig.json`, HTML entrypoints,
  runtime modules and assets are **unchanged** relative to Stage 1 (`3ee3aa54`).
- All relative Markdown links in the edited docs resolve.
- Every newly cited entrypoint/module/script path was checked against the source
  (`webgl-bench.ts` → `engine/renderer`, `theme-material-set.ts` → `stone-textures.ts`,
  `gen_notblood_tables.py` `OUT_PATH`, `vfx/post-fx/*`, `notblood-tables.gen.ts`
  consumers, `webgpu/lab-main.ts` outside-imports = none).

### Limits of this correction

- **No** `tsc`, `vitest`, `vite build`, browser/GPU or gameplay verification was run
  (docs-only; a live dispatch is using this machine). The above are code-resolution
  checks, not a build/test pass.
- Future-file paths (e.g. `src/fps/...`, `src/shared/...`, `legacy.html`, the staged
  tsconfig/vitest configs and npm scripts) are **specified for Stage 2**, not created
  here.
