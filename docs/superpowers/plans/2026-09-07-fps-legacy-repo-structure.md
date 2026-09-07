# Stage 2 — fps/legacy/shared physical migration plan

- **Date:** 2026-09-07
- **Status:** **PENDING — NOT EXECUTED.** This is a handoff plan, not a change set.
- **Owner:** prepared for the coordinator / a future Stage 2 executor.
- **Prerequisite (hard gate):** In-flight deferred-rendering work reviewed and
  integrated **and** Stage 1 is committed. Task completion alone does **not**
  satisfy this gate.

> This plan is **dependency-aware** and deliberately ordered to avoid breaking a
> consumer at any single step. It moves **no runtime code**. Re-search the
> import surface at the execution HEAD (see §Revalidation) — the tree may have
> grown since this was written.

---

## 0. Objective

Physically separate the active SDF FPS (`src/fps`), the retired game
(`src/legacy`) and a small `src/shared` boundary, **without changing behavior**,
assets, renderer, gameplay or tuning. Then add explicit active/legacy/all
build+test commands and update documentation last.

No gameplay/renderer/tuning changes are in scope. The physical relocation and
broader GPU validation happen only after the resource/integration gate.

---

## 1. Current dependency map (verified at base `c120a3e7`)

### 1.1 Entrypoints

| URL | Module | Project |
| --- | --- | --- |
| `/index.html` | `src/main.ts` | retired |
| `/sdf-game.html` | `src/lab/sdf-zombie/webgpu/game-main.ts` | active |
| `/sdf-lab.html` | `src/lab/sdf-zombie/lab-main.ts` | active |
| `/sdf-lab-webgpu.html` | `src/lab/sdf-zombie/webgpu/lab-main.ts` | active |
| `/sdf-bench.html` | `src/lab/sdf-zombie/webgpu/bench-main.ts` | active |
| `/sdf-lab-webgl-bench.html` | `src/lab/sdf-zombie/webgl-bench.ts` | active |
| `/sdf-lab-webgpu-bench.html` | `src/lab/sdf-zombie/webgpu/spike-main.ts` | active |
| `/humanoid-sdf-spike.html` | `src/lab/sdf-zombie/webgpu/humanoid-spike-main.ts` | active |
| `/sdf-hull-spike.html` | `src/lab/sdf-zombie/webgpu/hull-spike-main.ts` | active |
| `/sdf-shell-spike.html` | `src/lab/sdf-zombie/webgpu/shell-spike-main.ts` | active |
| `/normal-gradient-check.html` | `src/lab/sdf-zombie/webgpu/normal-gradient-probe.ts` | active |
| `/shared-wounds-probe.html` | `src/lab/sdf-zombie/shared-wounds/probe.js` | active |
| `/bounded-wounds-bench.html` | `docs/dev-notes/2026-09-07-bounded-torso-regions/bench.js` | active (scratch) |
| `/theme-preview.html` | `src/dev/theme-preview.ts` | active |

### 1.2 Active-tree imports that **leave** `src/lab/sdf-zombie` (verified)

These are the coupling edge the migration must sever (via `src/shared`):

| Active file | Imports | External target |
| --- | --- | --- |
| `blood-sim.ts`, `dynamite-flight.ts`, `explosion-aoe.ts`, `fpv.ts`, `hands.ts` | `tuning` | `src/game/gibs/tuning.ts` |
| `lab-main.ts` | `createRenderer` | `src/engine/renderer.ts` |
| `lab-main.ts` | `composer`, `post-fx-bus`, `config` | `src/vfx/post-fx/*` |
| `webgpu/game-main.ts` | `dungeonMaterialSet` | `src/game/level/theme-material-set.ts` |
| `webgpu/game-main.ts` | `muzzleWorldPosition` | `src/game/weapons/muzzle-pos.ts` |

(plus every `.test.ts` sibling for `tuning`; `carry.test.ts`/kit tests import
`public/assets/lab/*.glb|gltf?raw`.)

### 1.3 Transitive edges

- `game/gibs/tuning.ts` → `game/notblood/notblood-tables.gen.ts` (and imports
  the old enemy tables `dudeInfo`, `gibList`, ...). `tuning.ts` is a **shared
  dual consumer** (active + old game) and pulls in old enemy tables.
- `game/weapons/muzzle-pos.ts` → `game/gibs/particles.ts` (only a `Vec3` type).
  `particles.ts` is part of the retired gib stack.
- `game/level/theme-material-set.ts` → `stone-textures.ts` (both self-contained
  except `three`).
- `engine/renderer.ts` → `three` only (self-contained).
- `vfx/post-fx/composer.ts` → `config`, `post-fx-bus`, `palette-dither-pass`,
  `barrel-pass` (self-contained postprocessing stack). `dev-panel.ts` → `config`.
  `composer.ts` loads `/assets/post-fx/BLOOD.PAL.png`.

### 1.4 Asset & tooling coupling

- **Active character assets:** `src/lab/sdf-zombie/characters/*.blob|*.wam` (many)
  + `src/lab/sdf-zombie/gait-curves/*` + GLB/GLTF clips and PNG refs. Loaded via
  `?raw`/`import.meta.glob('./characters/*.blob')` and
  `public/assets/lab/*.glb|*.gltf?raw`.
- **Dev-save paths** (`src/lab/dev-save.ts`, used by `vite.config.ts`):
  writes `src/lab/sdf-zombie/characters/<name>.blob` and
  `public/assets/lab/faces/<file>.png`. Path-sensitive.
- **Codegen** (`scripts/gen_notblood_tables.py`) writes
  `src/game/notblood/notblood-tables.gen.ts`.
- **Placeholder assets** (`scripts/link-dev-assets.sh`) link
  `public/assets/*` from the primary checkout; only fills holes.
- **Scripts referencing active paths:** `scripts/probe-facing-chain.ts`,
  `scripts/blob-measure.ts`, `scripts/zombie-normal-gradient-check.mjs`,
  `scripts/probe-head-drift.ts`, `scripts/verify-soldier-wound.mjs`,
  `scripts/blob-render-check.ts`, `scripts/pose_measure_hands.py`,
  `scripts/gen-dispatch-dungeon.py`, `scripts/zombie-skeleton-gen.ts`,
  `scripts/sdf-game-bench.mjs` (re-scan at execution HEAD).

### 1.5 Vite / TS / Vitest globs

- `vite.config.ts` `build.rollupOptions.input` lists the HTML entrypoints (a
  subset — the probe/scratch html are served not built).
- `vite.config.ts` `test.include`: `src/**/*.test.ts`, `scripts/**/*.test.ts`.
- `tsconfig.json` `include: ["src"]`.

---

## 2. Shared boundary definition

Only modules imported by **both** sides go to `src/shared`. Verified shared set:

- `shared/tuning.ts` (+ `shared/notblood-tables.gen.ts`) — **split** (see §3).
- `shared/muzzle-pos.ts` — **fix** the `Vec3` import (see §3).
- `shared/renderer.ts` (from `engine/renderer.ts`).
- `shared/post-fx/*` (the whole `vfx/post-fx` stack: `composer`, `config`,
  `post-fx-bus`, `palette-dither-pass`, `barrel-pass`, `dev-panel`, `post-fx-bus.test`).
- `shared/theme-material-set.ts` + `shared/stone-textures.ts`.

Everything else in `src/engine`, `src/physics`, `src/ui`, `src/audio`,
`src/animation`, `src/vfx` (non-post-fx) and the retired `src/game`†/`src/sim`/
`src/main.ts` moves to `src/legacy`, minus the shared set.

† `src/game` is mostly retired, but its `gibs/tuning.ts`, `level/theme-material-set.ts`,
`level/stone-textures.ts`, `weapons/muzzle-pos.ts` hoist to shared.

---

## 3. Dependency extraction (do this BEFORE any move)

These two extractions are the risk. Do them first, in the current tree, and
verify nothing breaks.

### 3.1 Split `game/gibs/tuning.ts`

`tuning.ts` holds **both** (a) general Blud/tuning constants that both sides use
(`BU_PER_METER`, `TICS_PER_SECOND`, `buPerTicToMps`, `EXPLOSION_STANDARD`,
`EXPLOSION_LAUNCH`, `GIB_THRESHOLD`, `GROUND_BURST_THRESHOLD_M`,
`EXPLOSION_VFX_HEIGHT_SCALE`, `DYNAMITE_COOK`, `BALLISTIC_BOUNDS`,
`BLOOD_TRAIL`, `BLOOD_SPLAT`, `GIB_BURST`, `GIB_CHUNK_VELOCITY_SCALE`,
`CORPSE`, `BURN`, ...) and (b) old-enemy tables/profiles (`AXE_ZOMBIE`,
`SHOTGUN_CULTIST`, `TOMMY_CULTIST`, `CULTIST_GIB_PROFILE`, `ZOMBIE_GIB_PROFILE`,
`SHOTGUN_BLAST`, `TOMMY_BULLET`, `FLARE_GUN`, `WAVE_PRESETS`, `GibProfile`,
`pickChunkPicnum`, `rollChunkCount`, `HUMANOID_FLESH_PICNUMS`, `BONE_PICNUMS`).

Plan:

- **`shared/tuning.ts`**: the general constants + `GibProfile` interface +
  `pickChunkPicnum`/`rollChunkCount` + `HUMANOID_FLESH_PICNUMS`/`BONE_PICNUMS`
  that the active side needs, importing `shared/notblood-tables.gen.ts` for the
  raw tables it derives from.
- **`legacy/enemy-tuning.ts`** (or keep under legacy `game/gibs/tuning` if a
  re-export is acceptable): the old-enemy profile constants (`AXE_ZOMBIE`,
  `SHOTGUN_CULTIST`, `TOMMY_CULTIST`, `CULTIST_GIB_PROFILE`, `ZOMBIE_GIB_PROFILE`,
  `SHOTGUN_BLAST`, `TOMMY_BULLET`, `FLARE_GUN`, `WAVE_PRESETS`) that only the
  retired game imports.

> Reason: moving `tuning.ts` wholesale to shared drags old enemy tables into the
> active boundary; moving it wholesale to legacy breaks the active imports. A
> **narrow split** is required. Preserve provenance comments (the per-value
> NotBlood cites) on each moved block.

**Consumers to update:** `src/main.ts`, `src/game/{arena,weapons/*,enemy/*,encounter/*,notblood/outcome-adapter}.ts` →
legacy imports; `src/lab/sdf-zombie/{blood-sim,dynamite-flight,explosion-aoe,fpv,hands}.ts`
(+ tests) → shared imports.

### 3.2 Fix `game/weapons/muzzle-pos.ts` `Vec3`

`muzzle-pos.ts` imports `Vec3` (a type) from `game/gibs/particles.ts` (retired
gib stack). Before moving the gib stack to legacy, replace that type import with
a standalone shared `Vec3` (either hoist `particles.ts`'s `Vec3` to `shared/vec.ts`
or inline the 3-field interface). `muzzle-pos.ts` only needs the type.

**Consumers:** `src/main.ts` (legacy) + `src/lab/sdf-zombie/webgpu/game-main.ts`
(active). Both keep working after the fix.

---

## 4. Ordered migration steps (Stage 2, to be executed later)

Each step = exact source/destination + consumers. Revalidated after M2 integration.

1. **Extract shared data/types** (§3.1, §3.2): make `shared/{tuning,notblood-tables.gen,muzzle-pos,vec}.ts`.
   Update both importers. Verify: no behavior change; tests pass.
2. **Move shared render/post-fx/level** →
   `shared/{renderer.ts, post-fx/*, theme-material-set.ts, stone-textures.ts}`.
   Update `src/main.ts` (old) + `src/lab/sdf-zombie/lab-main.ts` and
   `webgpu/game-main.ts`. Confirm `composer.ts` `BLOOD.PAL.png` path still loads.
3. **Move active tree** `src/lab/sdf-zombie` → `src/fps`. Inside `src/fps`, keep
   `webgpu/`, `characters/`, `gait-curves/`, `shared-wounds/`, etc.
   - Update `?raw`/`glob('./characters/*.blob')` (relative, moves with the dir).
   - Update absolute-from-root imports (`../../../game/...` → `../../shared/...`).
   - Update `public/assets/lab/*.glb|gltf` consumers (relative paths adjust).
   - Update `src/lab/dev-save.ts` (see §5).
   - Update every `scripts/*` path reference (§1.4).
   - Keep Vite entrypoint URLs valid (§6).
4. **Move old game** → `src/legacy`:
   `src/main.ts`, `src/sim/*`, `src/game/*` (minus hoisted shared), and the
   non-shared `src/engine/{loop,input,...}`, `src/physics/*`, `src/ui/*`,
   `src/audio/*`, `src/animation/*`, `src/vfx/{explosion,smoke-particles,screenshake,...}`.
5. **Update tooling/assets references** (`vite.config.ts`, `scripts/*`,
   `dev-save`) and keep old lab URLs valid (see §6).
6. **Add explicit build/test commands** (see §7).
7. **Update documentation last** (this map, CLAUDE/AGENTS/README paths, the
   design spec status).

---

## 5. Tooling & asset path updates

- `src/lab/dev-save.ts` writes `src/lab/sdf-zombie/characters/<name>.blob` →
  becomes `src/fps/characters/<name>.blob`; `public/assets/lab/faces/<file>.png`
  stays. Update `vite.config.ts` import path (`./src/lab/dev-save` →
  `./src/fps/...` or a `src/dev` shared location) and update `isCharacterName`
  path helper.
- `scripts/gen_notblood_tables.py` writes `src/game/notblood/notblood-tables.gen.ts`
  → becomes `shared/notblood-tables.gen.ts`; update the `OUT_PATH` constant.
- `vite.config.ts` `build.rollupOptions.input`: point at the moved HTML/module
  paths; add the active/legacy entry strategy (§6).
- `scripts/link-dev-assets.sh` is worktree/primary-relative — no source change
  needed, but re-run after a move and confirm placeholders still land under
  `public/assets/*`.

---

## 6. Entrypoint / root strategy

- **Stage 2 root `/` becomes the active game** (`src/fps`), so `/` serves the SDF
  FPS. The retired `/index.html` callers need an **explicit legacy entry
  strategy** — e.g. `index.html` → `legacy-main` via a distinct path (documented
  choice at execution time). Do not implement now.
- **Preserve query parameters** on whichever entry is used and document
  compatibility (e.g. `?tiles-playtest`, telemetry/bench flags).
- **Keep the retired lab URLs valid** for behavior comparison (the
  dynamite/gibbing reference), even if the retired entry moves under
  `legacy/`.

---

## 7. Build / test command split (Stage 2)

Add explicit commands alongside the existing ones (e.g. in `package.json`):

- `build:fps`, `build:legacy`, `build:all`, and `test:fps`, `test:legacy`.
- Update `vite.config.ts` `test.include` to split `src/fps/**/*.test.ts`,
  `src/legacy/**/*.test.ts`, `src/shared/**/*.test.ts`, `scripts/**/*.test.ts`
  (documented; exact globs decided at execution).

---

## 8. Verification checklist & acceptance per stage

For each stage, run focused verification; record results. **No GPU capture, no
browser launch, no full suite unless explicitly required.**

**Current-stage (identity) checks:**
- [ ] `node -e "JSON.parse(...)"` package.json valid.
- [ ] `git diff --check` clean.
- [ ] `tsc --noEmit` (focused scopes where possible) — no type regressions.

**Post-move acceptance gates:**
- [ ] No active runtime import from `src/legacy` (re-scan imports leaving `src/fps`).
- [ ] `src/shared` imports are neither application (it only holds real dual consumers).
- [ ] Old game remains runnable (serve `/index.html`, GET 200, correct entrypoint).
- [ ] Active FPS + authoring tools run (serve the lab URLs, GET 200, correct entrypoints).
- [ ] Old references/provenance retained (docs, provenance comments carried with each move).
- [ ] Test counts/baselines preserved (focused suite runs unchanged before/after).
- [ ] No gameplay/renderer/tuning change (diff shows only path/import edits).

**Exclusions:** Physical relocation + broad GPU validation happen only after the
resource/integration gate; they are not part of Stage 2's initial move.

---

## 9. Guardrails

- No merge/push or primary-checkout edits here.
- A separate M2 dispatcher runs GPU checks; never stop others' processes.
- Assignments documented; do not claim a full build/test/GPU pass from
  lightweight checks.
