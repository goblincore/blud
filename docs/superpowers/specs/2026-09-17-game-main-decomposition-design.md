# `game-main.ts` decomposition — design

- **Date:** 2026-09-17
- **Status:** design approved, not executed
- **Scope:** `src/lab/sdf-zombie/webgpu/game-main.ts` only
- **Successor:** an implementation plan under `docs/superpowers/plans/`

---

## 1. Problem

`src/lab/sdf-zombie/webgpu/game-main.ts` is **14,763 lines**. The line count is
the symptom; the structure is the problem.

| Fact | Value |
| --- | --- |
| `async function main()` | lines **302 – 9726** (~9,400 lines, one function) |
| `let` at `main()` body indent | **227** |
| `const` at `main()` body indent | **266** |
| Total bindings in that one scope | **~493** |
| Nested functions in that scope | **106** |
| Imports | 144 |
| Dedicated test file | **none** (139 `*.test.ts` exist elsewhere in `webgpu/`) |

All 106 functions **close over** the ~493 shared bindings. No function can be
lifted out without first deciding what happens to that shared state. This is the
reason the file has never been broken up despite the rest of the directory being
well-modularised.

### 1.1 It is accelerating

| Commit | Date | Lines |
| --- | --- | --- |
| `HEAD~300` | 2026-09-05 | 4,589 |
| `HEAD~200` | 2026-09-06 | 5,816 |
| `HEAD~100` | 2026-09-09 | 6,743 |
| `HEAD~50` | 2026-09-09 | 7,081 |
| `HEAD~20` | 2026-09-10 | 7,651 |
| `HEAD` | 2026-09-17 | **14,763** |

The file **doubled in the last 20 commits (~7 days)**. Shutter blur, offline gib
assets, neural upscale, probe gather and impact splash all landed inside the
closure rather than beside it. Left alone the trend continues, because the
closure is the path of least resistance for every new feature.

### 1.2 Concern census

Occurrences inside the file: `gib` 606, `wound` 335, `probe` 296, `goo` 241,
`crowd` 189, `upscale` 160, `panel` 155, `bench` 137, `skeleton` 91, `dynamite`
77, `tracer` 78, `shutter` 75, `adaptive` 62, `vhs` 51, `encounter` 20,
`fisheye` 18.

---

## 2. Decisions taken

| Question | Decision |
| --- | --- |
| Which refactor axis | **The monolith.** The `src/fps` \| `src/legacy` \| `src/shared` tree split (`docs/superpowers/plans/2026-09-07-fps-legacy-repo-structure.md`) stays PENDING and out of scope. |
| Strictness | **State container first, then mechanical lift.** |
| Container shape | **Feature-sliced** (`ctx.probes`, `ctx.gibs`, …), not one flat object. |
| Definition of done | All bindings migrated **and** the large concerns extracted into `game-*.ts` modules with tests; `main()` becomes an orchestrator of ~1–2k lines. |
| Landing | **One branch.** Execution split across dispatch-UI subagents (deepseek-flash / `dsh` harness). |
| ECS | Acknowledged as the eventual destination; **explicitly not done now.** The container is designed as a stepping stone toward it, not a dead end. |

### 2.1 In-flight branch risk — assessed and dismissed

68 branches carry 268 unmerged commits touching `game-main.ts`, but nearly all
are abandoned `codex/*` and `dispatch/*` experiments. The branches that matter:

| Branch / PR | Commits touching `game-main.ts` | Diff in that file | Files total |
| --- | --- | --- | --- |
| `claude/flare-gun-burning-effects-101cad` (active) | 0 | — | 1 |
| `claude/enemy-characters-blobforge-b45932` | 0 | — | 3 |
| PR #5 cyberbride (`dispatch/2026-09-09-cyberbride-ghost-flesh`) | 1 | +11 / −1 | 16 |
| PR #4 thornbeast (`thornbeast-character`) | 0 | — | 6 |

Conflict risk against live work is negligible and is **not** a design
constraint. A single branch is appropriate.

---

## 3. Architecture

### 3.1 The existing exemplar

This design introduces **no new convention**. `game-weapon-slots.ts` already has
the exact shape, with tests:

```ts
export interface WeaponSlotState { … }
export function makeWeaponSlotState(current: WeaponSlot = 'shotgun'): WeaponSlotState
export function stepWeaponSlot(state: WeaponSlotState, dt: number): WeaponSlotState
export function requestSlot(state: WeaponSlotState, slot: WeaponSlot): WeaponSlotState
```

Every slice mirrors it. Each subagent task points at this file as its reference.

### 3.2 `game-context.ts`

```ts
export interface GameContext {
  // ── resources (ECS-resources-to-be): singleton config, handles, clocks
  render:    RenderState;      // sdfScale, adaptiveState, cull, refine, boneMesh
  lighting:  LightingState;    // levelProbeWeight, tracerLightGain, clocks
  probes:    ProbeState;       // gather binding, rates, weights, counters
  gibs:      GibState;         // atlas, render mode, bones, shutter
  dynamite:  DynamiteState;    // charge, detonations, scheduled pieces
  weapon:    WeaponState;      // groups, nodes, reload/fire timing, slots
  player:    PlayerState;      // aim, bob, strafe, input frame
  goo:       GooState;
  crowd:     CrowdState;
  bake:      BakeState;        // chunks, carve library, swap bookkeeping
  vfx:       VfxState;
  demo:      DemoState;        // simFrame, replay, hold, seeds
  telemetry: TelemetryState;
  panels:    PanelState;       // dev-only UI handles

  // ── entity storage (ECS-components-to-be)
  world: {
    actors: ZombieActor[];
    shells: ShellInstance[];
    soldierCorpses: SoldierCorpse[];
    colliders: ChunkBox[];
  };
}
```

### 3.3 Cluster sizes (from the `let` census)

| Slice | ~count | Representative bindings |
| --- | --- | --- |
| weapon | 42 | `gunGroup`, `reloadAge`, `shells`, `breechNodes`, `weaponYawDeg` |
| bake | 23 | `bakedChunkMat`, `lastBakeSwapFrame`, `carvedLibrary`, `maxChunks` |
| dynamite | 21 | `dynCharge`, `dynGibPieces`, `dynScheduledGibBodies` |
| render | 21 | `sdfScale`, `adaptiveState`, `visibleActors`, `boneCullMode` |
| probes | 19 | `probeGather`, `probeWeight`, `probeGatherRate` |
| player | 17 | `autopilot`, `strafeT`, `prevPlayerPos`, `pendingDx` |
| gibs | 16 | `gibAtlas`, `gibRenderMode`, `gibBones`, `gibShutter` |
| lighting | 13 | `levelProbeWeight`, `tracerLightGain`, `lightClockFrozen` |
| vfx | 12 | `explosionVfx`, `burstLayer`, `bleedClock` |
| demo | 9 | `simFrame`, `replayActive`, `demoHold` |
| panels | 9 | `vhsPanel`, `woundPanel`, `panelsHidden` |
| goo / crowd / telemetry / misc | 25 | `gooLayer`, `crowdDispatch`, `normalGradientMode` |

The clusters fall out almost entirely along naming prefixes — the concerns were
always separable, they were never given boundaries.

### 3.4 Why this shape, given ECS later

The majority of the ~493 bindings are **singletons** (config flags, toggles,
layer handles, panel handles, clocks) — in ECS terms, **resources**, not
components. The genuine per-entity data already lives in arrays.

- slices → ECS **resources**, with no data reshaping
- `ctx.world` arrays → ECS **component storage**, already the right granularity
- extracted `stepProbes(ctx.probes, dt)` → ECS **systems**, already system-shaped

A flat `GameState` would be the same migration cost today and would give the ECS
move nothing to grab onto. The grouping is free now and expensive to retrofit.

### 3.5 Deliberate constraint

Slices are **plain mutable objects** — no getters, setters, proxies or freezing.
`let x = 1; x = 2` becomes `ctx.s.x = 1; ctx.s.x = 2` and nothing subtler.
Accessors would change evaluation timing, which is exactly what a pixel hash
catches — but only after a wasted debugging cycle.

---

## 4. Migration mechanics

### 4.1 The rule: lines do not move, lines are only rewritten

```ts
// line 2649, before
  let probeWeight = DEFAULT_PROBE_WEIGHT;
// line 2649, after
  ctx.probes.weight = DEFAULT_PROBE_WEIGHT;
```

The slice is constructed once at the top of `main()`. **Every original
initializer line survives in place as a plain assignment.** This eliminates the
entire class of initialization-order bugs without anyone reasoning about
ordering.

Two bindings initialize from objects constructed later in `main()` —
`hemiBase = hemi.intensity` and `gooRigView = actors[0]?.view`. Under this rule
they simply keep happening where they always did; no special handling.

Factory defaults follow the initializer: a literal initializer contributes the
same literal to `makeXState()`; a computed initializer contributes a placeholder
that the in-place assignment overwrites.

### 4.2 Forbidden inside a migration task

Reordering, merging declarations, deleting apparently-dead bindings, renaming
beyond the slice path, fixing bugs, changing control flow. Anything noticed is
**filed, not fixed**.

### 4.3 The codemod

The rewrite is mechanical and total, so it is a codemod, not an editing task.

- Built on the **TypeScript compiler API**, already a dependency
  (`typescript ^5.6.0`) — **no new packages**.
- **AST-scoped rename**, not text substitution. A regex rename would corrupt
  shadowed identifiers, comment text and string literals; the AST rename will
  not, and `tsc --noEmit` catches any reference a mapping table missed.
- Consumes all slice mapping tables and rewrites `game-main.ts` in **one pass**:
  one file edit, one gate run, no intra-file conflicts by construction.

---

## 5. Verification

Baseline captured once at branch start, before any edit. Every task runs all
four gates.

| Gate | Command | Pass condition |
| --- | --- | --- |
| Types | `npx tsc --noEmit -p .` | clean |
| Unit | `npx vitest run` | all pass, no new skips |
| Pixel | `node scripts/march-hash.mjs` | all three hashes byte-identical to baseline |
| Frame | `scripts/sdf-demo-hash.sh` over the 3 recorded `.dem.json` | identical per-frame hashes |

`march-hash.mjs` self-validates before comparing: `room1-repeat` must equal
`room1` (determinism proof) and `room1-wounded` must **not** (proves the gate can
see change). If either check fails the run is void, not a pass.

**A hash mismatch is never resolved by loosening the gate.** The script's own
header says so. A mismatch means the migration changed behavior; the task
reverts.

Chrome is present at `/Applications/Google Chrome.app/…` and `scripts/lab-servers.sh`
drives it headless with `--enable-unsafe-webgpu` on its own port pair, so the
gates are runnable on this machine. **They have not yet been run** — capturing
the baseline is task 0, and no GPU pass is claimed before it is observed.

### 5.1 Why fields-off is the right regime to hash

`march-hash.mjs` pins `setFieldStyle('off')`. This is **deliberate and correct**,
not a gap:

- `sdf-layer.ts:1078` declares `let fieldStyle: FieldStyle = 'off'` — fields-off
  is the **default**.
- The production path runs the **upscaler model**, and both the upscale stage and
  the refine pass force fields off. Hashing fields-off is hashing the regime the
  game actually renders in.
- The pin also removes a real source of non-determinism: `sdf-layer.ts` keeps a
  private `frameIndex` with no getter or reset hook, which made hashes bimodal
  across boots until the pin collapsed them to a single value.

The interlaced/fields-on path keeps its own source-text pins in
`sdf-layer.test.ts` and is not this gate's responsibility. No additional
fields-on recording is required.

---

## 6. Execution

### 6.1 Why the naive fan-out does not work

Every migration task edits the same file. Fourteen subagents on `game-main.ts`
produce fourteen mutually-conflicting diffs. Parallelism must come from
somewhere other than "many agents editing the monolith."

### 6.2 Parallel authoring, serial mechanical application

**Subagents (fully parallel, zero conflict) — new files only:**

- `game-state-<slice>.ts` — the `XState` interface and `makeXState()`
- a mapping table — `{ probeWeight: 'probes.weight', probeGatherRate: 'probes.gatherRate', … }`
- `game-state-<slice>.test.ts` — factory defaults

No two agents touch the same file. Each task is small, bounded and
exemplar-driven (`game-weapon-slots.ts`), which suits deepseek-flash.

**Coordinator (serial):** runs the codemod, runs the gates, integrates.

### 6.3 Phases

| Phase | Work | Parallel? | Output |
| --- | --- | --- | --- |
| **0** | Capture baseline hashes; scaffold `game-context.ts` + codemod | no — coordinator | baseline JSON committed |
| **1** | 14 slice authors: interface + factory + mapping table + test | **yes, 14-wide** | 14 new module pairs |
| **2** | Codemod run; all ~493 bindings become `ctx.*`; full gate | no — coordinator | `game-main.ts` same length, fully sliced |
| **3** | Extract the 106 functions into `game-*.ts` by slice, in waves of ~4 | partly | ~12 new modules with tests |
| **4** | Collapse `main()` to an orchestrator; update `repository-map.md`, `TASKS.md` | no — coordinator | target ~1–2k lines |

Phase 3 is where the line count drops. Phase 2 is what makes phase 3 mechanical.

**Parallelism is not the binding constraint.** Dispatch-UI concurrency is
limited, so the practical batch size is set by available workers rather than by
the design. Phase 1 tasks are independent and may be run in any order or
serially; phase 3 extractions contend on `game-main.ts` and are integrated one
wave at a time. Neither phase is blocked by the other's batching.

---

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| Codemod over-reach (shadowed names, strings, comments) | AST-scoped rename via the TS compiler API + `tsc --noEmit` + pixel gate. A wrong mapping table fails loudly at phase 2, not silently. |
| The file keeps growing mid-refactor (7k lines in the last week) | Phases 0–2 land fast; a large feature landing mid-flight triggers a codemod **re-run**, not a hand merge. |
| deepseek-flash output quality | Every phase-1 artifact is a new file guarded by `tsc` and its own test. A bad mapping table cannot reach `game-main.ts` without failing phase 2. Blast radius bounded by design. |
| Initialization-order breakage | Eliminated by construction: lines are rewritten in place, never moved. |

---

## 8. Out of scope

- The `src/fps` \| `src/legacy` \| `src/shared` tree split — remains PENDING.
- Any ECS migration.
- Gameplay, renderer, tuning or asset changes. Any behavior difference is
  **raised, not silently fixed**.
- The retired game (`src/main.ts`, `src/game/`, `src/sim/`).
- Cleanup of the ~64 abandoned `codex/*` / `dispatch/*` branches (worth doing,
  tracked separately).
