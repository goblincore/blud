# march.wgsl.ts Split (Phase 1) Implementation Plan

> **For agentic workers:** implement task-by-task. Tasks run in order (each builds on the previous task's branch). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Split `src/lab/sdf-zombie/webgpu/march.wgsl.ts` into focused modules under `webgpu/march/` with every export's name and string value unchanged, proven bit-identical.

**Spec:** `docs/superpowers/specs/2026-09-18-march-wgsl-refactor-design.md` — read it first (Phase 1 only; Phase 2 is NOT this plan).

**Architecture:** Pure moves. Each module owns one band of the current file; `march.wgsl.ts` becomes a barrel re-exporting everything, so no importer changes. Big strings are split into feature blocks re-joined with `${…}` interpolation, so the joined WGSL is byte-identical. A sha1 golden snapshot of every string export and the exact-float `march-hash` pixel gate prove nothing changed.

**Tech Stack:** TypeScript, three.js WebGPU + TSL, WGSL string modules, Vitest, headless-Chrome capture scripts (`scripts/*.mjs`).

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port — production scope §4.6):** logic in pure renderer-free tested modules; load-bearing rendering in hand-written WGSL; state on `ctx` or in a feature module; deterministic sim; plain-data seams. (This plan moves code only — do not change what any of it does.)
- **This is a MOVE-ONLY refactor.** Do not rename an export, reformat WGSL, fix typos inside template strings, reorder `HELPERS`, or "tidy" whitespace in a string. The golden test fails on a single byte. Comments OUTSIDE template strings move with their code.
- **wgslFn parse rules (header of `march.wgsl.ts`):** every WGSL helper string must BEGIN with `fn` — no leading comment or blank line inside the template. A split block that is spliced into the middle of a body is not a helper and has no such constraint, but keep its exact bytes.
- Work ONLY in your dispatch worktree. Never `git stash`. `node_modules` is symlinked — do not reinstall.
- **Targeted tests only** (`npm test -- <names>`) plus `npx tsc --noEmit`. Never the bare full suite. Known pre-existing failure: `game-actor-torso-slug` (2 tests), also on main.
- **Headless capture only** — the in-app browser pane loses the WebGPU device.
- **Boot time is a gate:** report cold-boot `drawOnce` against the base branch (fresh browser profile each run; see Task 1 Step 2).
- Kill anything you start outside a capture script in the same step.
- Extracted Blood assets are dev placeholders — never commit them.

**Importers today** (must keep working without edits): `baked-chunks.ts`, `crowd-atlas.ts`, `crowd-records.ts`, `crowd-type.ts`, `deferred-sdf.ts`, `fpv-view.ts`, `game-main.ts`, `game-seams-debug-probe.ts`, `game-seams-misc.ts`, `normal-gradient-probe.ts`, `normal-gradient.wgsl.ts`, `shell-spike-main.ts`, `surface-nets-compute.ts`, `zombie-gpu.ts`, and the tests `crowd-atlas`, `crowd-records`, `deferred-sdf`, `game-actor-bounded-wounds`, `march-step-soundness`, `march-tracer`, `march-wound-list`, `march.wgsl`, `normal-gradient.wgsl`, `surface-nets.wgsl`, `write-wounds`, `zombie-gpu-burn`, `zombie-gpu`. Circular-import check: `march/*` modules must NOT import from `../march.wgsl` (the barrel); they import each other directly.

**Verification command used by every task** (call it VERIFY):

```bash
npx tsc --noEmit && npm test -- march crowd-atlas crowd-records deferred-sdf game-actor-bounded-wounds normal-gradient surface-nets write-wounds zombie-gpu
```

---

## Task 1: Golden gate, then the leaf modules

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/march/march-golden.test.ts` (+ its `__snapshots__/`)
- Create: `webgpu/march/layout.ts`, `webgpu/march/math.wgsl.ts`, `webgpu/march/primitives.wgsl.ts`, `webgpu/march/melt.ts`, `webgpu/march/shade-helpers.wgsl.ts`
- Modify: `webgpu/march.wgsl.ts` (remove moved code, add re-exports)
- Notes: `docs/dev-notes/2026-09-18-march-split/NOTES.md`

- [ ] **Step 1: Write the golden test and record it BEFORE moving anything.**

```ts
// src/lab/sdf-zombie/webgpu/march/march-golden.test.ts
//
// THE MOVE-ONLY GATE for the march.wgsl.ts split (spec 2026-09-18). Every
// string export of the barrel, plus the joined include list and both entry
// points, hashed. Recorded before the first move; it must never change during
// phase 1. A diff here means a move altered shader text — fix the move, never
// update this snapshot.
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import * as M from '../march.wgsl';

const sha = (s: string) => createHash('sha1').update(s).digest('hex');

describe('march.wgsl split golden', () => {
  it('keeps every string export byte-identical', () => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(M).sort(([a], [b]) => a.localeCompare(b))) {
      if (typeof v === 'string') out[k] = sha(v);
      else if (typeof v === 'number') out[k] = `num:${v}`;
    }
    out['__HELPERS_joined'] = sha((M.HELPERS as string[]).join('\n'));
    out['__HELPERS_count'] = String((M.HELPERS as string[]).length);
    out['__export_names'] = sha(Object.keys(M).sort().join(','));
    expect(out).toMatchSnapshot();
  });
  it('still exports the same functions', () => {
    expect(typeof M.soldierFaceDamageShadow).toBe('function');
  });
});
```

  Run `npm test -- march-golden` once — vitest writes `__snapshots__/march-golden.test.ts.snap`. **Commit the test and snapshot alone** (`git commit -m "march split: golden gate"`), before any move.

- [ ] **Step 2: Baselines.** Record in the notes, on the unmodified base:
  - `node scripts/march-hash.mjs` output (read its header for ports/usage), and again with `MARCH_HASH_ROOM=2`. The `room1-repeat` must equal `room1` (determinism proof) — if it does not, stop and report.
  - Cold-boot time: start `npx vite --port <free> --strictPort`, then load `/sdf-game.html` in headless Chrome with a FRESH `--user-data-dir` and read `window.__warmDone.phases.drawOnce` once `window.__warmGate.phase === 'ready'` (adapt `scripts/flare-ingame-capture.mjs`'s harness; a small `scripts/boot-time.mjs` that prints `{drawOnce, warmMs}` is fine to add and commit). Run it 2× and record both.

- [ ] **Step 3: Move `layout.ts`.** Cut `DATA_ROWS`, every `ROW_*`, `MAX_GROUPS`, `RAY_CULL_SLACK`, `QUAD_ENTRY_SLACK`, `WOUND_STEP_MUL`, `soldierFaceDamageShadow` (with their doc comments) into `march/layout.ts`. It imports nothing WGSL. In `march.wgsl.ts` add `export * from './march/layout';` and import any of those names the remaining code still uses (`import { ROW_WOUND, … } from './march/layout';`). Run VERIFY + `npm test -- march-golden`. Commit.

- [ ] **Step 4: Move `math.wgsl.ts`** (`HASH13`, `NOISE3`, `FBM`, `NOISE_LOCAL`, `Q_ROT`, `Q_MUL`, `Q_FROM_TO`). Same pattern: `export * from './march/math.wgsl';` in the barrel plus direct imports where the barrel's remaining code interpolates them. VERIFY + golden. Commit.

- [ ] **Step 5: Move `primitives.wgsl.ts`** (`SMIN`, `SMIN_CHAMFER`, `SD_GROOVE`, `SMAX`, `CONE_CAP`, `SD_BEZIER_T`, `CONE_BEND`, `STRAND_HASH4`, `STRAND_LIPSCHITZ`, `CONE_STRAND`, `SD_ROUND_BOX`, `SD_PRIM`, `SD_PRIM_ORIENTED`, `SD_SHELL`, `DETAIL_FIELD`). If a string interpolates a `ROW_*` constant, import it from `./layout`. VERIFY + golden. Commit.

- [ ] **Step 6: Move `melt.ts`** (the "Face melt" constants block starting `FACE_MELT_SAG` through `MELT_SKIN_CONTRAST`, and the `HEAD_EXTERIOR_GORE_KEEP` re-export) and **`shade-helpers.wgsl.ts`** (`TEXEL`, `SOFT_SHOULDER`, `FLICKER`, `LEVEL_SHADOW`). VERIFY + golden. Commit.

- [ ] **Step 7: Pixel gate + notes.** Re-run `march-hash` (both rooms): must equal Step 2 exactly. Boot time: within noise of Step 2. Write the notes (baselines, after numbers, file sizes before/after). Commit.

---

## Task 2: Fields, map, cone march, helpers list, body pieces

**Files:**
- Create: `webgpu/march/fields/{carves,wounds,tissue,volume,groups,bones}.wgsl.ts`, `webgpu/march/map-body.wgsl.ts`, `webgpu/march/cone-march.wgsl.ts`, `webgpu/march/helpers.ts`, `webgpu/march/body/{params,trace,face,surface,light,entry}.wgsl.ts`
- Modify: `webgpu/march.wgsl.ts` → barrel only (target: imports + `export *` lines + nothing else)
- Notes: append to `docs/dev-notes/2026-09-18-march-split/NOTES.md`

- [ ] **Step 1: Fields.** `fields/carves.wgsl.ts` (`REST_POINT`, `APPLY_CARVES`), `fields/wounds.wgsl.ts` (`APPLY_WOUNDS`, `WOUND_MASK`, `WOUND_SHADOW`), `fields/tissue.wgsl.ts` (`TISSUE_RAMP`, `CHAR_MASK`), `fields/volume.wgsl.ts` (`SAMPLE_VOLUME`), `fields/groups.wgsl.ts` (`FOLD_GROUP`, `INSTANCE_STATE` — it interpolates `REC_*` from `../../crowd-records`), `fields/bones.wgsl.ts` (`FOLD_BONE_RANGE`, `APPLY_BONES`). One commit per two or three files, VERIFY + golden each time.
- [ ] **Step 2: `map-body.wgsl.ts`** (`MAP_BODY`, `CALC_NORMAL`) and **`cone-march.wgsl.ts`** (`CONE_MARCH`, `DEPTH_PREPASS_MARCH`, `DEPTH_PRE_FETCH`, `QUAD_TILE_EMPTY_WGSL`). VERIFY + golden. Commit.
- [ ] **Step 3: Body pieces.** `body/params.wgsl.ts` (`MARCH_BODY_PARAMS` — the positional list; do not touch its comments), `body/trace.wgsl.ts` (`MARCH_TRACE_SETUP`, `MARCH_TRACE_LOOP`, `MARCH_TRACE_POST`, `MARCH_BODY_TRACE`), `body/face.wgsl.ts` (`FACE_LAYER_WGSL`), `body/surface.wgsl.ts` (`MARCH_BODY_SURFACE_PREP`, `MARCH_NORMAL_OUT`, `MARCH_ANCHOR_READ`, `MARCH_BURN_OUT`), `body/light.wgsl.ts` (`MARCH_BODY_LIGHT`), `body/entry.wgsl.ts` (`MARCH_BODY`, `REFINE_LOOP`, `REFINE_PARAMS`, `REFINE_BODY`). Watch the interpolation order: `MARCH_BODY_TRACE` and `MARCH_BODY` are built from the others at module load, so each module imports what it concatenates. VERIFY + golden. Commit.
- [ ] **Step 4: `helpers.ts`** — `HELPERS` in the identical order, with its load-bearing-order comment, importing each helper from its new module and the external ones (`AMBIENT_AT`, `WALL_CONTRIBUTION`, `PROBE_GRID_WGSL`, `PROBE_DYNAMIC_WGSL`, `FLASHLIGHT_BOUNCE_WGSL`, `SEG_VOLUME_WGSL`) from where the barrel imported them. VERIFY + golden. Commit.
- [ ] **Step 5: Barrel.** `march.wgsl.ts` now keeps its header comment (the wgslFn parse rules — move them to a `march/README.md` too) and only `export * from './march/…'` lines. Check for import cycles: `npx madge --circular src/lab/sdf-zombie/webgpu/march.wgsl.ts` if available via npx, otherwise grep that no `march/*` file imports `march.wgsl`. VERIFY + golden. Commit.
- [ ] **Step 6: Pixel gate + boot time** as Task 1 Step 7. Append numbers. Commit.

---

## Task 3: Feature blocks out of the giant strings, and the test split

**Files:**
- Create: `webgpu/march/body/blocks/*.wgsl.ts` (one per feature block found)
- Modify: `webgpu/march/body/{trace,surface,light}.wgsl.ts`
- Create: per-module test files under `webgpu/march/` (moved from `march.wgsl.test.ts`)
- Modify: `webgpu/march.wgsl.test.ts` (whatever remains)
- Notes: append to the NOTES

- [ ] **Step 1: Inventory.** Read `MARCH_TRACE_POST` (~560 lines), `MARCH_BODY_SURFACE_PREP` and `MARCH_BODY_LIGHT`. List every self-contained feature block (a contiguous run of lines guarded by or dedicated to one feature — e.g. the burn block that starts `let burnAmt = clamp(max(burnCfg.x, gInstBurn.x)…`, rupture gore, melt, face damage, wound tint, bone reveal). Write the list with line ranges into the notes BEFORE extracting.
- [ ] **Step 2: Extract one block at a time.** For each: cut the exact lines into `body/blocks/<feature>.wgsl.ts` as `export const <FEATURE>_BLOCK = /* wgsl */ \`…\`;` and replace them in the parent with `${<FEATURE>_BLOCK}`. The cut must include the exact leading indentation and trailing newline so the joined string is identical. VERIFY + golden after EACH block. Commit after each block.
- [ ] **Step 3: Split the tests.** Move `describe` blocks from `march.wgsl.test.ts` into test files next to the module they assert on (`march/fields/wounds.wgsl.test.ts`, `march/body/blocks/burn.wgsl.test.ts`, …). Tests keep importing from the barrel or switch to the module — either is fine — but assertions move verbatim. The total test count before and after must match (record both from the vitest summary). Commit.
- [ ] **Step 4: Final gates.** VERIFY, golden, `march-hash` both rooms identical to Task 1 Step 2, boot time within noise. Notes: final module map with line counts, test counts before/after, the gate numbers. Commit.
