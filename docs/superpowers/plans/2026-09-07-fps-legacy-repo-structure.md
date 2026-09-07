# Stage 2 — fps/legacy/shared physical migration plan

- **Date:** 2026-09-07
- **Status:** **PENDING — NOT EXECUTED.** This is a handoff plan, not a change set.
- **Owner:** prepared for the coordinator / a future Stage 2 executor.
- **Prerequisite (hard gate):** In-flight deferred-rendering (M2) work reviewed and
  integrated **and** Stage 1 is committed **and** the review corrections to this
  docset are integrated. Task completion alone does **not** satisfy this gate.

> This plan is **dependency-aware** and deliberately ordered to avoid breaking a
> consumer at any single step. It moves **no runtime code**.
> The base-source inventory below is **evidence**, not a substitute for Step 0:
> the tree may have grown (or M2 may have added deferred files) since this was
> written, so Step 0 re-scans the import/path surface at the execution HEAD.

---

## 0. Objective

Physically separate the active SDF FPS (`src/fps`), the retired game
(`src/legacy`) and a small `src/shared` boundary, **without changing behavior**,
assets, renderer, gameplay or tuning. Then add explicit active/legacy/all
build+test commands and update documentation last. The relocation and the broader
GPU validation happen only after the M2 review/integration and queue/resource
gate — Stage 2's initial move is sequenced **after** that gate, and the
no-GPU/no-build/no-main-checkout constraints of this dispatch apply to the
execution of **this** plan (they are recorded in the dated dev-notes, not as
global rules).

No gameplay/renderer/tuning changes are in scope. Any runtime difference that
would be required to match behaviour is out of scope and must be raised, not
silently "fixed".

---

## 0.1 Step 0 — verify the gate and re-scan (do this FIRST, at execution HEAD)

Before any move, at the execution HEAD, in the worktree:

1. Confirm the M2 deferred-rendering work is reviewed and integrated (its files
   are present and merge-clean in `src/lab/sdf-zombie/webgpu/`).
2. Confirm Stage 1 + the review corrections are integrated (this plan, the spec,
   README/AGENTS/CLAUDE, repository map and reference guide all describe the
   active/retired split).
3. Confirm the repo is at a known HEAD and the working tree is clean (or has only
   the intended Stage 1/2 files staged).
4. **Re-scan** the import surface and path strings at that HEAD, not the base
   `c120a3e7` used here. Specifically re-run a grep for import paths that leave
   each app subtree, and for hard-coded path strings (`src/lab/sdf-zombie`,
   `src/lab/dev-save`, `src/game/...`, `public/assets/lab/faces/...`). The base
   inventory in §1 is evidence, never an excuse to ignore files M2 added after it.

Only proceed once Step 0 passes.

---

## 1. Current dependency map (verified at base `c120a3e7`; re-verify in Step 0)

### 1.1 Entrypoints

| URL | Module | Project |
| --- | --- | --- |
| `/index.html` | `src/main.ts` | retired |
| `/sdf-game.html` | `src/lab/sdf-zombie/webgpu/game-main.ts` | active |
| `/sdf-lab.html` | `src/lab/sdf-zombie/lab-main.ts` | active (WebGL/forward) |
| `/sdf-lab-webgpu.html` | `src/lab/sdf-zombie/webgpu/lab-main.ts` | active (WebGPU lab, dynamite/FPV demo) |
| `/sdf-bench.html` | `src/lab/sdf-zombie/webgpu/bench-main.ts` | active |
| `/sdf-lab-webgl-bench.html` | `src/lab/sdf-zombie/webgl-bench.ts` | active |
| `/sdf-lab-webgpu-bench.html` | `src/lab/sdf-zombie/webgpu/spike-main.ts` | active |
| `/humanoid-sdf-spike.html` | `src/lab/sdf-zombie/webgpu/humanoid-spike-main.ts` | active |
| `/sdf-hull-spike.html` | `src/lab/sdf-zombie/webgpu/hull-spike-main.ts` | active |
| `/sdf-shell-spike.html` | `src/lab/sdf-zombie/webgpu/shell-spike-main.ts` | active |
| `/normal-gradient-check.html` | `src/lab/sdf-zombie/webgpu/normal-gradient-probe.ts` | active |
| `/shared-wounds-probe.html` | `src/lab/sdf-zombie/shared-wounds/probe.js` | active |
| `/bounded-wounds-bench.html` | `docs/dev-notes/2026-09-07-bounded-torso-regions/bench.js` | active (scratch) |
| `/theme-preview.html` | `src/dev/theme-preview.ts` | dev theme-reference tool (see §6) |

### 1.2 Active-tree imports that **leave** `src/lab/sdf-zombie` (verified)

These are the coupling edge the migration must sever (via `src/shared`):

| Active file | Imports (exact symbols) | External target |
| --- | --- | --- |
| `explosion-aoe.ts` | `BU_PER_METER`, `EXPLOSION_LAUNCH`, `EXPLOSION_STANDARD`, `EXPLOSION_VFX_HEIGHT_SCALE`, `GIB_THRESHOLD`, `GROUND_BURST_THRESHOLD_M` | `src/game/gibs/tuning.ts` |
| `blood-sim.ts` | `BLOOD_TRAIL`, `GIB_BURST`, `BLOOD_SPLAT` | `src/game/gibs/tuning.ts` |
| `dynamite-flight.ts` | `BALLISTIC_BOUNDS`, `DYNAMITE_COOK` | `src/game/gibs/tuning.ts` |
| `fpv.ts` | `BALLISTIC_BOUNDS`, `DYNAMITE_COOK` | `src/game/gibs/tuning.ts` |
| `hands.ts` | `DYNAMITE_COOK` | `src/game/gibs/tuning.ts` |
| `webgpu/game-main.ts` | `dungeonMaterialSet` | `src/game/level/theme-material-set.ts` |
| `webgpu/game-main.ts` | `muzzleWorldPosition` | `src/game/weapons/muzzle-pos.ts` |
| `lab-main.ts` (WebGL path) | `createRenderer` | `src/engine/renderer.ts` |
| `lab-main.ts` (WebGL path) | `createPostFxComposer`, `PostFxBus`, `DEFAULT_POST_FX` | `src/vfx/post-fx/*` |
| `webgl-bench.ts` | `createRenderer` | `src/engine/renderer.ts` |

The same tuning symbols are imported by the sibling tests:
`explosion-aoe.test.ts`, `blood-sim.test.ts`, `dynamite-flight.test.ts`,
`fpv.test.ts`, `hands.test.ts`. (`webgpu/lab-main.ts`, the WebGPU lab, imports
`fpv`, `fpv-mode`, `dynamite-prop`, `hand-volume-clip`, etc. — all inside the
active tree; it does **not** import `engine/` or `vfx/`.)

### 1.3 Transitive edges

- `src/game/gibs/tuning.ts` imports `src/game/notblood/notblood-tables.gen.ts`
  (`explodeInfo`, `dudeInfo`, `gibList`, `KDude`) and exposes general tuning plus
  old-enemy tables/profiles. The general-constant subset is the active side's need;
  the old-enemy tables/profiles stay retired (see §3.1).
- **Generated table (`src/game/notblood/notblood-tables.gen.ts`)** is written by
  `scripts/gen_notblood_tables.py` (`OUT_PATH` constant) and imported by the
  retired game (`game/notblood/death-outcome.ts`, `game/notblood/outcome-adapter.ts`,
  `game/gibs/index.ts`, `game/enemy/axe-zombie.ts`) **and** by `game/gibs/tuning.ts`
  (shared data). It is a shared data module, not an application; after the split it
  lives at `src/shared/notblood-tables.gen.ts` and both sides import it from there.
- `src/game/weapons/muzzle-pos.ts` imports **only a `Vec3` type** from
  `src/game/gibs/particles.ts` (retired gib stack). See §3.2 — this is severed.
- `src/game/level/theme-material-set.ts` → `stone-textures.ts` (both self-contained
  except `three`).
- `src/engine/renderer.ts` → `three` only (self-contained).
- `src/vfx/post-fx/composer.ts` → `config`, `post-fx-bus`, `palette-dither-pass`,
  `barrel-pass` (self-contained postprocessing stack); `dev-panel.ts` → `config`.
  `composer.ts` loads `/assets/post-fx/BLOOD.PAL.png` (gitignored baked LUT).

### 1.4 Asset & tooling coupling

- **Active character assets:** `src/lab/sdf-zombie/characters/*.blob|*.wam` (many)
  + `src/lab/sdf-zombie/gait-curves/*` + GLB/GLTF clips and PNG refs, loaded via
  `?raw` / `import.meta.glob('./characters/*.blob')` and
  `public/assets/lab/*.glb|*.gltf?raw`.
- **Dev-save paths** (`src/lab/dev-save.ts`, used by `vite.config.ts`):
  - reads/writes `src/lab/sdf-zombie/characters/<name>.blob` (see §5 for the move).
  - writes `public/assets/lab/faces/<file>.png` — **stays** (public assets put).
- **Codegen** (`scripts/gen_notblood_tables.py`) writes
  `src/game/notblood/notblood-tables.gen.ts` (see §5 for the move).
- **Placeholder assets** (`scripts/link-dev-assets.sh`) link `public/assets/*`
  from the primary checkout; only fills holes, no source change expected.
- **Scripts referencing active paths:** `scripts/probe-facing-chain.ts`,
  `scripts/blob-measure.ts`, `scripts/zombie-normal-gradient-check.mjs`,
  `scripts/probe-head-drift.ts`, `scripts/verify-soldier-wound.mjs`,
  `scripts/blob-render-check.ts`, `scripts/pose_measure_hands.py`,
  `scripts/gen-dispatch-dungeon.py`, `scripts/zombie-skeleton-gen.ts`,
  `scripts/sdf-game-bench.mjs` (re-scan in Step 0).

### 1.5 Vite / TS / Vitest globs

- `vite.config.ts` `build.rollupOptions.input` lists the HTML entrypoints (a
  subset — the probe/scratch html are served, not built).
- `vite.config.ts` `test.include`: `src/**/*.test.ts`, `scripts/**/*.test.ts`;
  `test.exclude`: `node_modules`, `.claude`, `docs`, `dist`.
- `tsconfig.json` `include: ["src"]`.

---

## 2. Shared boundary definition

Only modules imported by **both** sides (or by an active module that is itself
dual) go to `src/shared`. `src/shared` may carry the non-application dependencies
its real dual-consumer modules need; it must **not** import either application
(`src/fps` or `src/legacy`).

Verified shared set (move exactly these):

- `shared/vec.ts` — standalone object-shaped muzzle Vec3 (NOT the SDF tuple `Vec3`
  from `src/fps/vec.ts`, and NOT a dependency on legacy `particles.ts` — see §3.2).
- `shared/muzzle-pos.ts` — from `src/game/weapons/muzzle-pos.ts`, typed against
  `shared/vec.ts`.
- `shared/tuning.ts` — the **general-constant subset** of `src/game/gibs/tuning.ts`
  that the active side imports (see §1.2), plus `shared/notblood-tables.gen.ts`.
- `shared/notblood-tables.gen.ts` — moved output of `gen_notblood_tables.py`; a
  data dependency of `shared/tuning.ts`, **not** an application.
- `shared/renderer.ts` — from `src/engine/renderer.ts` (consumers: `src/fps/lab-main.ts`,
  `src/fps/webgl-bench.ts`, `src/legacy/main.ts`).
- `shared/post-fx/*` — the `src/vfx/post-fx` stack: `composer`, `config`,
  `post-fx-bus`, `palette-dither-pass`, `barrel-pass`, `dev-panel` (and their
  tests). Consumers: `src/fps/lab-main.ts` + `src/legacy/main.ts`.
- `shared/theme-material-set.ts` + `shared/stone-textures.ts` — from
  `src/game/level/` (consumer: `src/fps/webgpu/game-main.ts`).

Everything else in `src/engine`, `src/physics`, `src/ui`, `src/audio`,
`src/animation`, `src/vfx` (non-post-fx) and the retired `src/game`† / `src/sim` /
`src/main.ts` moves to `src/legacy`, minus the shared set above. Keep the retired
game's `game/gibs` helper/profile constants (e.g. `GibProfile`,
`pickChunkPicnum`, `rollChunkCount`, `HUMANOID_FLESH_PICNUMS`, `BONE_PICNUMS`) in
`src/legacy` — the active side does **not** import them.

† `src/game` is mostly retired, but `gibs/tuning.ts` (general subset),
`level/theme-material-set.ts`, `level/stone-textures.ts`,
`weapons/muzzle-pos.ts` hoist to shared; its **remaining** files move to legacy.

---

## 3. Dependency extraction (do this BEFORE any move)

These two extractions are the risk. Do them first, in the current tree, and
verify nothing breaks.

### 3.1 Split `game/gibs/tuning.ts`

`tuning.ts` holds **both** (a) general Blud/tuning constants the active side
imports and (b) the old-enemy tables/profiles the retired game imports. The active
side's exact need is: `BU_PER_METER`, `EXPLOSION_LAUNCH`, `EXPLOSION_STANDARD`,
`EXPLOSION_VFX_HEIGHT_SCALE`, `GIB_THRESHOLD`, `GROUND_BURST_THRESHOLD_M`,
`BLOOD_TRAIL`, `GIB_BURST`, `BLOOD_SPLAT`, `DYNAMITE_COOK`, `BALLISTIC_BOUNDS`
(plus the unit-conversion helpers those depend on). The **retired-only** set that
stays in legacy: `AXE_ZOMBIE`, `SHOTGUN_CULTIST`, `TOMMY_CULTIST`,
`CULTIST_GIB_PROFILE`, `ZOMBIE_GIB_PROFILE`, `SHOTGUN_BLAST`, `TOMMY_BULLET`,
`FLARE_GUN`, `WAVE_PRESETS`, `GibProfile`, `pickChunkPicnum`, `rollChunkCount`,
`HUMANOID_FLESH_PICNUMS`, `BONE_PICNUMS`.

Plan:

- **`shared/tuning.ts`**: the general constants above, importing
  `shared/notblood-tables.gen.ts` for the raw tables it derives from.
- **`src/legacy/game/gibs/tuning.ts`**: the old-enemy profile/helper constants that
  only the retired game imports. Keep this at
  `src/legacy/game/gibs/tuning.ts` (do **not** invent a flattened
  `enemy-tuning.ts` alternative — preserve the `game/gibs/tuning.ts` path and its
  provenance comments on the moved block).

> Reason: moving `tuning.ts` wholesale to shared drags old enemy tables into the
> active boundary; moving it wholesale to legacy breaks the active imports. A
> **narrow split** is required, and the per-value NotBlood provenance comments
> must travel with each block.

**Consumers to update:** `src/legacy/{main,game/arena,game/weapons/*,game/enemy/*,game/encounter/*,game/notblood/outcome-adapter}.ts`
→ legacy imports; `src/fps/{blood-sim,dynamite-flight,explosion-aoe,fpv,hands}.ts`
(+ their tests) → shared imports.

### 3.2 Fix `game/weapons/muzzle-pos.ts` `Vec3`

`muzzle-pos.ts` imports `Vec3` (a type) from `game/gibs/particles.ts` (retired gib
stack). Before moving the gib stack to legacy, replace that type import with a
**standalone object-shaped interface** declared in `shared/vec.ts` (for example
`interface MuzzleVec3 { x: number; y: number; z: number }`). Do **not** reuse the
SDF tuple `Vec3` (`[number, number, number]` in `src/fps/vec.ts`) and do **not**
create a dependency on legacy `particles.ts`.

**Consumers:** `src/legacy/main.ts` (legacy) + `src/fps/webgpu/game-main.ts`
(active). Both keep working after the fix.

---

## 4. Ordered migration steps (Stage 2, to be executed later)

Each step = exact source/destination + consumers. Steps 1–2 run in the **current**
tree (before the moves); the physical moves start at step 3. Re-verify the
import/path surface at the execution HEAD (Step 0) before step 1.

1. **Extract shared data/types** (§3.1, §3.2) **in the current tree** (before any
   move): create `src/shared/{vec.ts, muzzle-pos.ts, tuning.ts, notblood-tables.gen.ts}`.
   The general constants come OUT of `src/game/gibs/tuning.ts` into
   `src/shared/tuning.ts`; the old-enemy block stays at `src/game/gibs/tuning.ts`
   for now (it moves to `src/legacy/game/gibs/tuning.ts` in step 4). Update the
   active modules (still at `src/lab/sdf-zombie/…`) to import `src/shared/tuning.ts`
   / `src/shared/muzzle-pos.ts`, and point the generated-table consumers at
   `src/shared/notblood-tables.gen.ts`. Verify: no behavior change; tests pass.
2. **Move shared render/post-fx/level** →
   `src/shared/{renderer.ts, post-fx/*, theme-material-set.ts, stone-textures.ts}`.
   Update `src/main.ts` (old) + `src/lab/sdf-zombie/lab-main.ts` (WebGL path) and
   `src/lab/sdf-zombie/webgpu/game-main.ts` (all still in their current locations
   until steps 3–4). Confirm `composer.ts` `BLOOD.PAL.png` path still loads.
3. **Move active tree** `src/lab/sdf-zombie` → `src/fps` **as a directory move**,
   preserving its internal structure (`src/fps/webgpu/`, `src/fps/characters/`,
   `src/fps/gait-curves/`, `src/fps/shared-wounds/`, and every module/test).
   - Relative imports inside the dir are unchanged; fix the absolute-from-root
     imports (`../../../game/...` → `../../shared/...`, `../../game/...` →
     `../shared/...`).
   - `?raw` / `glob('./characters/*.blob')` and `public/assets/lab/*` references
     move with the dir or adjust for depth.
   - Move `src/lab/dev-save.ts` → `src/fps/dev-save.ts`, and its test
     `src/lab/dev-save.test.ts` → `src/fps/dev-save.test.ts`; update the Vite
     import and the saved `.blob` destination to `src/fps/characters/`.
   - Update every `scripts/*` path reference (§1.4).
   - Keep Vite entrypoint URLs valid (§6).
4. **Move old game** → `src/legacy`:
   - `src/main.ts` → `src/legacy/main.ts`.
   - `src/sim/*` → `src/legacy/sim/`.
   - `src/game/*` → `src/legacy/game/` minus the hoisted shared modules (§2). The
     old-enemy block keeps living at `src/legacy/game/gibs/tuning.ts`.
   - Non-shared `src/engine/{loop,input,...}` → `src/legacy/engine/`,
     `src/physics/*`, `src/ui/*`, `src/audio/*`, `src/animation/*`,
     `src/vfx/{explosion,smoke-particles,screenshake,...}` → `src/legacy/vfx/`
     (these retain their existing directory structure under `src/legacy/`).
   - `src/dev/theme-preview.ts` → `src/legacy/dev/theme-preview.ts` (see §6).
5. **Update tooling/assets references**: `vite.config.ts`, `scripts/*`, `dev-save`,
   `gen_notblood_tables.py` and the HTML entry strategy (§6); keep the old lab URLs
   valid.
6. **Add explicit build/test commands** (§7).
7. **Update documentation last** (this map, CLAUDE/AGENTS/README paths, the design
   spec status).

---

## 5. Tooling & asset path updates (exact)

- `src/lab/dev-save.ts` → `src/fps/dev-save.ts`. `blobPath()` writes
  `src/fps/characters/<name>.blob` (was `src/lab/sdf-zombie/characters/<name>.blob`).
  `saveFace` still writes `public/assets/lab/faces/<file>.png` — **unchanged**.
  Update `vite.config.ts` import to `./src/fps/dev-save`, and the relative
  `./sdf-zombie/{blob-parse,blob-emit,blob-compile,panel}` imports to `./fps/...`.
- `scripts/gen_notblood_tables.py` writes `src/shared/notblood-tables.gen.ts`
  (was `src/game/notblood/notblood-tables.gen.ts`); update the `OUT_PATH` constant.
- `vite.config.ts` `build.rollupOptions.input`: point at the moved HTML/module
  paths (§6) and add the active/legacy entry strategy.
- `scripts/link-dev-assets.sh` is worktree/primary-relative — no source change
  needed; re-run after the move and confirm placeholders still land under
  `public/assets/*`.

---

## 6. Entrypoint / root strategy (exact)

- **Canonical active entry `index.html`:** replace today's retired-markup
  `index.html` with markup identical to `sdf-game.html` and pointing its module
  entry at `src/fps/webgpu/game-main.ts`. Because `index.html` then serves the
  active module **directly** (not via a redirect), any query parameters
  (`?tiles-playtest`, telemetry/bench flags, etc.) are preserved for whichever
  entry the caller uses.
- **Canonical legacy entry `legacy.html` (new file):** contains today's old
  `index.html` markup, pointing at `src/legacy/main.ts`. This is where retired-game
  callers go after the move.
- `dev:legacy` opens **`/legacy.html`** (no longer `/index.html`).
- **`/index.html` intentionally switches to the active game.** Old-game callers
  must switch to `/legacy.html`. There is **no** redirect loop and **no** claim
  that `/index.html` serves both games.
- **Preserve every existing working URL:** `/sdf-game.html`, `/sdf-lab.html`,
  `/sdf-lab-webgpu.html`, `/sdf-bench.html`, `/sdf-lab-webgl-bench.html`,
  `/sdf-lab-webgpu-bench.html`, `/humanoid-sdf-spike.html`, `/sdf-hull-spike.html`,
  `/sdf-shell-spike.html`, `/normal-gradient-check.html`,
  `/shared-wounds-probe.html`, `/bounded-wounds-bench.html`, `/theme-preview.html`.
  Each keeps serving the same role; only the module path inside the HTML is
  updated for the new location (e.g. `/src/fps/lab-main.ts`). `/theme-preview.html`
  keeps serving `src/legacy/dev/theme-preview.ts` — it is a **theme-reference
  tool**, not active FPS.
- **`src/dev/theme-preview.ts`** is an old theme-family reference preview
  (loads `/assets/map-research/patterns.json`; imports only `three`). Move it to
  `src/legacy/dev/theme-preview.ts`; do **not** label it active FPS.

---

## 7. Build / test command split (Stage 2 — implement, but specify exactly here)

To be added in Stage 2 (do **not** implement now; these are the intended
commands/configs):

- `tsconfig.fps.json`, `tsconfig.legacy.json`, `tsconfig.shared.json` — each
  `extends` `tsconfig.json` and sets `include` to its subtree
  (`"src/fps"`, `"src/legacy"`, `"src/shared"`). The root `tsconfig.json` retains
  `include: ["src"]` so the **combined tree is always typechecked**; no scope is
  silently excluded from `tsc`.
- `vite.config.ts` `test.projects` (Vitest projects), one per test scope:
  - `fps`: `include: ['src/fps/**/*.test.ts']`
  - `legacy`: `include: ['src/legacy/**/*.test.ts']`
  - `shared`: `include: ['src/shared/**/*.test.ts']`
  - `tools`: `include: ['scripts/**/*.test.ts']`
  - Keep `exclude` for `node_modules`, `.claude`, `docs`, `dist`.
  Shared tests run in their own project (once); `fps` and `legacy` run only their
  own app tests; `tools` keeps the shell-out script tests. Nothing is dropped —
  `src/legacy` is not merely excluded from Vitest while `tsc` still scans it, and
  scripts tests always run.
- Package scripts:
  - `"build:fps": "tsc -p tsconfig.fps.json --noEmit && vite build"`
  - `"build:legacy": "tsc -p tsconfig.legacy.json --noEmit && vite build"`
  - `"build:all": "tsc -p tsconfig.json --noEmit && vite build"`
  - `"test:fps": "vitest run --project fps"`
  - `"test:legacy": "vitest run --project legacy"`
  - `"test": "vitest run"` (existing) becomes the combined/all run, exercising
    every project (fps + legacy + shared + tools); the combined tree is typechecked
    via `build:all`.
- `vite.config.ts` `build.rollupOptions.input` keeps the URL→module list (§1.1)
  updated to the new paths so each entry is a valid build input; the probe/scratch
  HTML stay served-not-built.

---

## 8. Verification & acceptance

### Stage 1 tier (already done — evidence, not a new claim)

The Stage 1 doc + npm-script changes were validated with lightweight HTTP/config
checks only: `package.json` JSON validity, `git diff --check`, and a programmatic
`createServer` GET of the two HTML pages confirming the expected module entrypoint.
HTTP smoke is **only** valid for Stage 1, whose changes touch no runtime code. It
is **not** a Stage 2 acceptance gate.

### Stage 2 tier (after the M2 review/integration + queue/resource gate)

Run after the running migration is finished, using owned resources:

- **Post-move invariants:**
  - No active runtime import from `src/legacy` (re-scan imports leaving `src/fps`).
  - `src/shared` imports are neither application (it holds only real dual consumers
    + their non-application dependencies).
  - Old game runnable via `/legacy.html`; active FPS + authoring tools run via
    their URLs (§6).
  - Old references/provenance retained (docs + provenance comments carried with
    each move).
  - Test counts/baselines preserved (per-scope and combined suites run
    before/after).
  - No gameplay/renderer/tuning change (diff shows only path/import edits).
- **Real startup, not a page GET:** after the moves, actually launch each
  application/module/asset entrypoint and collect the observed errors; exercise the
  authoring **controls and save/reload paths** (dev-save writes/loads a `.blob` and
  a face PNG, preserving original data). HTTP smoke alone is insufficient.
- **Sequenced checks:** tests, typecheck (`tsc` per scope + combined), build
  (`vite build` per scope + combined), and GPU checks run **after** the running
  migration is finished and use owned resources. Do not run GPU/heavy jobs
  concurrently with another dispatcher's measurements.

**Exclusions (removed):** Stage 2's initial move is **not** excluded from the
physical relocation, and it is **not** validated by a bare GET. The relocation and
GPU validation are sequenced after the gate but are part of Stage 2.

---

## 9. Guardrails

- No merge/push or primary-checkout edits here.
- A separate M2 dispatcher runs GPU checks; never stop others' processes.
- Assignments documented; do not claim a full build/test/GPU pass from
  lightweight checks.
