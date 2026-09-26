# Engineering and process

Tests, harnesses, the game-main decomposition, tooling, process notes. Part of the task wiki: [TASKS.md](../../TASKS.md) is the front page. Sections are newest-first where dated; each keeps its own history.

## sdf-zombie suite red (14 tests) — fixed 2026-09-22

- [x] 11 from `3662c1ca` (half-strength blends): zombie ribs/spine/iliac pulled in via `zombie-skeleton-gen.ts`, soldier
  jaw r 0.052, gnasher waist taller; crease-residual pins (rupture, surface-nets band) loosened; gib assets rebuilt.
- [x] 2 from `3e9850e3` (heading fix): rig-added `orient` broke wound frames; a chest slug decapitated. `poseOrient` flag.
  Removed the stale 11 mm near-wound characterisation test (owner). 6 zombie bones now hidden only by arm flesh (was 4).

## Late spawns drew no flesh while frozen — fixed 2026-09-21

- [x] **`spawnDebugCharacter` / `spawnCrowd` bodies added after boot marched nothing** on a frozen cast (`?frozen=1`,
  `freeze(true)` — every harness), for every cast (zombie too). Not the defer-compile work: the frozen path builds the
  outer shell hull ONCE (`frozenHullBuilt`), the shell ships ON, and the march discards every pixel no hull instance
  covers. Fix: `spawnDebugCharacter` clears `frozenHullBuilt`. Unfrozen play rebuilt the hull per tick and was fine.
- [x] Gate: [`scripts/sdf-late-spawn-gate.sh`](../../scripts/sdf-late-spawn-gate.sh) — occupancy hits per late spawn.
  zombie +12040, goblin +4103, bonewalker +4143 (min 300); fix reverted, goblin reads **−50** (FAIL).
- [ ] Only `goblin` of the WAM cast is registered (`character-registry.ts`); imp/knight/lizardman/orc/skeleton/
  troll have no .blob yet (`ogre` now exists — authored from prose 2026-09-22, not ported from WAM), so `spawnDebugCharacter('orc')` throws `unknown character`. Port via authoring-sdf-characters.

## Seam getters were frozen at boot — fixed 2026-09-21

- [x] **Every top-level getter in every `game-seams-*.ts` factory (95) read its BOOT value forever.** The decomposition
  moved members byte-for-byte, but `{ ...createXSeams(ctx) }` reads each accessor once and copies the value; the
  migration gate proved seams PRESENT, never LIVE. 50 of them are read by ~70 scripts: `gunReady`, `shells`,
  `flashVisible`, `hingeOpenRad`, `bleed`, `bloodBlur`, `frames`, `renderMode`, `sdfScale`, `woundTuning`... Some gates
  failed loudly; others passed VACUOUSLY (the shorty gate's reload wait was satisfied by boot values before any reload).
  Fix: `seam-merge.ts` `mergeSeams()` copies descriptors, `__sdfGame = mergeSeams(...factories, { inline })`; same
  override order. **Verified live:** shorty gate now reads `shells 2 -> 0 -> 2, maxOpen 0.785 rad`.
- [x] Guards so it cannot come back: `extract-seam-group.ts` + `integrate-seams.ts` share `scripts/lib/seam-literal.ts`,
  which emits factories as mergeSeams ARGUMENTS and REFUSES the `{ ...spread }` literal; `scripts/seam-merge-guard.test.ts` fails on any
  hand-added `...createXSeams(` in game-main.
- [x] **Re-ran the gates that read those getters (2026-09-21)** — bleed parity, slug, dynamite, shutter check/task3/task4,
  tracer-light, shorty, FOV. The frozen getters were the SMALLEST problem found:
  * **Loader captures (5 gates):** they waited for `__sdfGame`, not for the game — bleed parity's "zero diff" was two
    pictures of the loader; task3/task4/shutter-check gave up SILENTLY after 90-100 s and shot "READY — CLICK TO START".
    All now use `scripts/lib/wait-loader.mjs` (10 min, throws, dismisses the overlay).
  * **Dynamite gate was stale twice over:** it read the slot before the tick that applies a key (input refactor
    2026-09-15), and its bone/pool checks counted MARCHED chunks while the shipped gib renderer became ASSETS on 09-16
    (459b3b8b). Now tier-aware; it also waits for the gib background compile. PASSES: 14 asset pieces, `bone.cage`, 0 dropped.
  * **Bleed parity floor was 84% of the frame** on real frames (VHS grain + light clock animate while frozen), so it
    passed any toggle. Now freezes both: the gating toggle diffs to **0 px**. Residual: control cycle A still reads
    11.8% (B reads 23 px) — something settles after the freeze and loosens the floor. Open, small.
  * **Real bug, opt-in deferred renderer:** every deferred surface shader failed to compile (`unresolved value
    'gMarchAnchor'`) since cd8d8d8a. Fixed (the chain now seeds from the shared declaring node, `march-private-reads.ts`;
    guard `scripts/march-private-seed-guard.test.ts`). With the shader valid, deferred mode now STALLS on first frames
    (cold compile, not warmed) — **owner: deferred is PAUSED, not pursued.** shutter-check/task3's deferred legs fail
    on that; treat as paused, not a regression.
  * Passing on real frames: slug (placement), shorty, FOV, tracer-light, task4, shutter-check (non-deferred legs).
- [x] Shorty gate: `fpv-rest` / `flash-on` / `flash-off` were captured over the pipeline-compile loader (15 KB frames).
  Now waits for `loader-ready` and dismisses the overlay; the three shots are real frames (425-474 KB, flash visible).

## game-main.ts decomposition — migration phase merged 2026-09-17

- [x] All **395** `main()`-scope bindings migrated to a feature-sliced `GameContext` (16 slices), codemod-applied
  with lines rewritten in place. `game-main.ts` 14,763 → 14,548. Gates: `tsc` clean; vitest **15 failed / 5,640
  passed** = baseline exactly (those 15 predate this work, verified at base `8f70d26f`); `march-hash` room1
  byte-identical before and after; owner smoke-tested the running game.
  [Spec](../../docs/superpowers/specs/2026-09-17-game-main-decomposition-design.md) ·
  [Plan](../../docs/superpowers/plans/2026-09-17-game-main-decomposition.md) ·
  [Baseline + gate evidence](../../docs/dev-notes/2026-09-17-game-main-decomposition/baseline.md)
- [x] Tooling: `scripts/slice-extract.ts` (AST binding inventory + role classifier + `--functions` reporter),
  `scripts/game-context-codemod.ts` (scope-aware rename, 29 tests), `scripts/extract-leaf.ts` (leaf extractor),
  `scripts/game-context-coverage.test.ts` (gate: `ctx` must stay the ONLY state binding in `main()`).
- [x] Extraction wave 1: `applyDynamiteTuning` + `dynamiteTuningValues` → `game-dynamite-tuning.ts`.
- [x] Tooling: `scripts/integrate-seams.ts` (seam spread integrator, refuses on a missing member).
- [x] `__sdfGame` seam extraction: the 22 largest members (**2,012 lines**) lifted into
  `game-seams-{debug-probe,bench,render-diag,shell-diag,spawn-goo}.ts`, spread back as
  `createXSeams(ctx, deps)`. Authored in parallel by 5 dispatch agents (new files only, no `game-main.ts`
  edits, zero conflicts); `scripts/integrate-seams.ts` did the single integration edit and refuses to write
  unless every named member is found. **game-main.ts 14,549 → 12,568.** Runtime-verified: all 400 seams and
  all 22 moved members present, game renders.
- [x] The remaining **256 members (~1,400 lines)** lifted into six slice modules
  (`game-seams-{world,render,boot,weapon-player,fx,misc}.ts`) by `scripts/extract-seam-group.ts` — an AST
  cut-and-paste, not agents: the members averaged 8 lines and 325/378 needed only `ctx`, so a verbatim move by
  script beats six parallel hand-copies whose failure mode (an altered literal that still type-checks) the pixel
  gate cannot localise. **game-main.ts 12,569 → 11,170.**
- [x] **march phase 2 Task 0 DONE (2026-09-20): the pixel gate was racing the renderer.** `occupancy()`
  dispatches a frame and reads it straight back; under load three defers the frame, the read returns the
  last-landed (at boot, all-zero) target, coverage reads 0 and the ladder search staged a DIFFERENT camera
  rung — so the gate hashed a different pose. Fixed in the staging (settled census + settled/live target
  before each capture, loud failure if it never settles); no pin moved. Verified here 3/3 canonical at
  loadavg 8.5–19.2, plus the agent's 10/10 and 5/5.
  [Evidence](../../docs/dev-notes/2026-09-20-march-hash-flakiness/NOTES.md) · `MARCH_HASH_DUMP=<path>` dumps
  state at hash time.
- [ ] **three.js r186 (merged): measure it properly, and try two of its levers.** Verified pixel-identical
  (both rooms canonical) and tsc-clean, so pins/baselines carry over. Boot timing could NOT be attributed —
  today's r186 numbers are worse than yesterday's r185 ones, but a control tree without our own change was
  slower still, so it is session drift; a real answer needs r185 and r186 installed side by side and measured
  interleaved. Then: `compileAsync`'s new `onProgress` into the loader (cold boot is silent for 50-160 s),
  `debug.onNodeBuilderCreated` for build attribution / emitted `MARCH_BODY` size, `compileComputeAsync()` for the
  probe-gather compute (small). "CodeNode includes as references" is NOT a size lever (read the PR — it only
  drops a dead texture sample). `DirectRenderPipeline` is NOT usable (it forbids materials that sample the
  framebuffer; our post chain does). [Notes](../../docs/dev-notes/2026-09-20-threejs-r186/NOTES.md)
- [ ] **Sweep the same race across the other capture scripts** — the dispatch-then-read-back pattern is at
  **18 call sites** in ~12 scripts (`march-parity`, `refine-smoke`, `sdf-depth-prepass-census`,
  `sdf-chunk-bake-gate`, the normal-gradient checks…). Any of them can read a stale or zero frame under
  load and report a wrong number as a result. Wants the settled-read helper from `sdf-closeup-stage.mjs`
  applied across them.
- [x] **`game-seams-leftover.ts` is gone (2026-09-20):** its 96 members moved verbatim into the modules that
  already own their concern (`world` +15, `render` +12, `fx` +10, `render-diag` +6, `gibs-bake` +5, `boot` +3,
  `render-quality` +4, `weapon-aim` +2, `debug-probe`/`demo-step`/`lighting-probes` +1 each). Verified by
  booting both trees and diffing `Object.keys(__sdfGame).sort()`: **422 members, identical**.
  [Notes](../../docs/dev-notes/2026-09-20-seams-leftover-split/NOTES.md)
- [x] **Leaves wave 2 + tool rebuild (2026-09-20):** `extract-leaf` now inserts ctx at AST positions (generics),
  wraps value refs in `withCtx`, refuses non-leaves by name, rewrites co-moved calls, respects shadowing,
  carries main()-scope types transitively, moves const arrows, handles multi-declarator consts, appends to one
  module per slice, infers its own imports (shared `scripts/lib/game-main-deps.ts`), and plans waves with
  `--leaves`; `extract-seam-group` picks the literal by shape and has `--all`. 54 tests, previously none.
  **game-main.ts 9,721 → 7,815**; 45 → 14 `__sdfGame` members; 31 members into five themed seam modules.
- [x] **Leaves wave 1 (2026-09-19, merged):** 46 leaf functions → `game-*-leaves*.ts`, 96 ctx-only members →
  `game-seams-leftover.ts`. **game-main.ts 11,598 → 9,721.** 45 members remain. Next wave, tool fixes first
  (`extract-leaf` generics/shorthand/typed wrapper/real leaf check; `extract-seam-group` `readMembers`), then
  `--consts` blockers and `updateHud`; consolidate the `*-leaves2/3` files. [Notes](../../docs/dev-notes/2026-09-19-game-main-leaves-1/NOTES.md)
- [ ] (superseded by the wave-1 row above) ~**52 members (~570 lines)** remain in the literal: the ones still closing over `main()`-scope functions
  (`spillVerdict`, `rebuildCast`, `spawnEnemy`, `updateHud`, `playerRoomId`, `ZOMBIE_RADIUS`, …). They need
  explicit deps objects — extract their dependencies first, bottom-up.
- [ ] Then the giants: `tick` (907 lines, 12 slices), `handle.setDrawFn` closure (589), `spawnEnemy` (260),
  `gibActor` (245), `detonateAt` (167).
- [ ] Then the remaining leaves (63 functions, 848 lines) and the giants (`tick` 907, `setDrawFn` 589,
  `spawnEnemy` 260). Extraction must run **bottom-up** — free names are mostly other `main()`-scope functions.
- [x] **Both gates repaired 2026-09-18.** `march-hash.mjs`'s three canonicals were stale since 2026-09-15;
  bisecting all 163 commits with the gate itself identified **`3662c1ca`** ("half-strength round blends for
  character builds") as the single mover — owner-accepted character-geometry work, so the drift was legitimate.
  Re-pinned (default `8f2b74e7…`, crowd `c77f9008…`, per-body `2c5dac0d…`), each reproduced on two independent
  runs; the bisect table and the re-pinning discipline are recorded in the script. The gate exits 0 and still
  sees change (`room1-wounded` ≠ `room1`).
- [x] `sdf-demo-hash.sh ab` no longer dies before comparing: the final-frame sample was itself introducing the
  odd parity gap its own comment warned about (frames 96 / every 4 → samples at 0,4,…,92 parity 1, then frame 95
  at parity 0). It is now taken only when it agrees with the established parity.
- [x] **Capsule-phase divergence FIXED 2026-09-18 (one of two causes).** The gather packs capsules only on a
  due tick and writes `lastCapsules`/`capsuleArrays` only then, so the first recorded frame was a function of
  the absolute tick counter that boot leaves at an arbitrary phase — one run packed the live cast (240
  instances), the next read a stale warm-up leftover (35). `bench` already reset that phase; `demoScenario`,
  the member the hash tool actually drives, never did. Fix: `ctx.probes.gatherTick = 0` in `demoScenario`.
  **Verified:** `instances` at frame 0 is now identical across runs (240/240, same min and zero fraction).
- [x] **Sub-LSB tolerance added for `probeDyn`** (`scripts/lib/layer-tolerance.mjs`, 12 tests). A hash may differ
  ONLY when every statistic still agrees: both sides live (`nonZero > 0`, checked first), finite, equal
  `nonZero`/`sampled`/`floats`/`zeroFraction`, and min/max within 1e-5 relative. `marchTarget` and `instances`
  stay EXACT. It is opt-in per call site — the negative control stays strict so it cannot tolerate away the
  break it injects — and every exercised tolerance is printed, because a silent tolerance is how a gate rots.
- [ ] **STILL FAILING, and now REPRODUCIBLE — it is a cold-vs-warm page difference, not GPU noise.** Three
  consecutive `sdf-demo-hash ab` runs failed identically: run A (first page load) always reports probeDyn
  nonZero **6388**, run B (second load) always **6316**, with
  `marchTarget [min 0.00111522→0.000199939, max 0.980713→13.4053] tiles 4,5,6,7,9,10`. A **13× swing in
  marchTarget max** is not sub-LSB, so the tolerance correctly does NOT mask it — that is the tolerance working.
  The earlier "identical stats, different hash" sample was one case of a larger effect. This is the failure
  `bench`'s own comment predicted ("between a first page load and a warm one"), so the recorder's warm-up is
  not reaching a settled state before frame 0 despite `warmup: 90`. Being systematic, it is now tractable.
  **Until it is resolved, no A/B measured through `sdf-demo-hash` is trustworthy.**
- [x] **Guard added after a near-miss.** Copying `bench`'s full reset (`pendingGather = null` +
  `gather?.reset()`) also made the runs agree — by zeroing the dynamic probe layer outright (probeDyn nonZero
  6316 → 0), which is the black-silhouette regression `frame-hash.ts` exists to catch. `sdf-demo-hash.mjs` now
  FAILS a run whose dynamic layer reads zero, and that guard was verified to fire by reintroducing the bad fix.
  Tripwires in `demo-scenario-determinism.test.ts` pin both halves.
- [x] **Bench path checked 2026-09-18 — it is FINE.** Drove `bench({ demo })` against the synthetic recording
  and read its `endHash`: `marchTarget` nonZero 120000, **`probeDyn` nonZero 2236 — live, not zero**. Its
  `gather?.reset()` rebuilds because the replay drives `tick()` normally, unlike `demoScenario` which steps via
  `handle.step()` under `simLocked`. (`?simidle`, the other trigger, boots a bodyless scene, so its layer is
  empty by design and the reset is irrelevant there.)
- [x] **But the bench path had the same blind spot, now closed.** Neither `sdf-game-bench.mjs` nor
  `census-diff.mjs` checked `nonZero` anywhere, and a layer that is zero on EVERY repeat does not drift — so
  `reportFrameHashDrift` called it "FRAME HASH IDENTICAL" and returned 0. Two empty buffers agree perfectly.
  `deadDynamicLayers()` now flags a zero dynamic layer when the scene had bodies (bodyless `?simidle` is
  exempt) and feeds the exit code; five tests in `census-diff.test.mjs` pin it.

## Bench harness — no more silent hangs — 2026-09-09

- [x] `scripts/sdf-game-bench.mjs` can no longer hang forever. `send()` had no
  timeout and no reject path and nothing rejected `pending` on socket death, so a
  lost CDP response wedged the run (observed: 141/204 legs, then 19+ min of silence).
  Every wait is now bounded and every failure names the leg/room/rep, phase, CDP
  method and console tail.
- [x] One wedged leg no longer kills the matrix: a per-leg watchdog abandons it and
  the run continues; `BENCH_MAX_CONSEC_FAILS` (3) stops a dead browser. Reports gain
  an INCOMPLETE banner and the exit code is non-zero on any partial run.
- [x] Completed legs land in `$BENCH_OUT/bench-progress.jsonl` as they finish, so an
  aborted run keeps what it measured — `bench.json`/`bench.md`/`passes.md` are still
  end-of-run only. Knobs: `BENCH_SEND_TIMEOUT_MS`, `BENCH_LEG_TIMEOUT_MS`.

## Process / tooling

- `P1`  [x]  Dispatch-UI setup (M1 tasks completed + merged)
- `P2`  [x]  Write M2 plan via `superpowers:writing-plans`
- `P3`  [-]  CI / GitHub Actions — defer until meaningful test coverage exists
- `P4`  [ ]  Dependency audit — `npm audit` flags 6 vulns (1 critical); likely transitive, safe for a web build
- `P5`  [-]  Prune old `dispatch/blud-m1-task-*` branches
- `P6`  [x]  Theme-preview schema merge — `scripts/build_theme_patterns.py` joins `patterns.raw.json` + `labels.json` → theme-shaped `patterns.json` (`{texture_families[weighted floors/walls/ceilings], map_archetypes, geometry}`); validates clean; 30 families/39 maps; doorFreq 0.0413 cross-checks R5's 4.1%. Feeds procgen levels §5.1 + deferred theming.
- `P7`  [x]  BUNFUSE extraction + cooking visual — `dynamite-fuse-burn.json`, `7081c14`
- `P8`  [~]  **Blobforge** — the `.blob` SDF character pipeline: text → `BodyDef`,
  rendered by the lab, byte-exact round trip, `fused`/`clear`/`daylight`/`stance`
  checks, generated face textures, per-character palettes + albedo mottle,
  polygon kits authored in WAM, turntable, agent skill. 1295 sdf-zombie tests,
  tsc + build clean. `zombie.blob` reproduces `makeZombie()` to **3.77e-9 m**.
  **SHARP FEATURES LANDED** — the vocabulary was the bottleneck, not the loop:
  `r2=` (tapered capsule; `r2=0` is a true point), `tip=` (displaces the far end
  alone, so a prim points off-bone), `chamfer` (flat-bevel fold, keeps a crease),
  `groove` (4th part kind, cuts a channel along where its surface crosses the
  body). The goblin's nose and ears were multi-blob fakes whose own comments
  described the limit; both are single prims now.
  **Two rules that cost rounds:** *reach is the whole game* — a point that stops
  inside the mass it grows from reads as a bump (cranium semi-depth 0.118, the
  first tapered nose tipped at 0.122 and was still a bump); and *two features at
  the same height fuse* — separation must beat the SUM of the two blends.
  **Primitives since:** arc capsule (`bend=`), groove and `shell` SHIPPED;
  still unbuilt from the roadmap — rounded box (the first flat face), blend
  exponent (cheapest, most general), torus, prism; plus a spar+sheet
  construction the dragon's wings showed is missing (2026-09-01 review).
  **Also open:** lab cold boot is 19-30 s and it is three's TSL node builder, not
  the GPU or the network — ~85% of a CPU profile; deferring the warm-up made it
  WORSE (36.8 s vs 18.8 s) because nothing paints until `main()` returns, so the
  fix has to get a first frame up before the builds. Eye shape/angle/spacing
  sliders (params exist in the `sheet` block, only read at load). `carve` is
  limb-locked to head; `emitBlob` unwired from the panel.
  **ox-alpha modelling tests:** clown on `dispatch/ox-alpha-clown-character` —
  NOT merged, fails 3 of its own tests (asserted a material list, then rebuilt
  the glTF without re-running; ruff 88 mm inside the body) despite exit 0 and a
  "gates green" report. Mouse dispatched 2026-08-21.
  **Mouse snout run (2026-08-22, `dispatch/mouse-snout`):** the mouse now HAS
  a muzzle — one bent tapered prim (`r2=`+`tip=`+`bend=`), field-measured head
  depth 0.364 m = 33% of standing height, matching the side-profile reference
  (two prior runs built flat faces off the front view alone). The kit was
  written but never built/registered — now compiled, in `KITS`, and its brows
  were 92% buried in the skull (offset z 0.010 → 0.066). LOOK entries for the
  mouse cloth materials: without an env map the royal-blue shorts rendered
  black from every unlit angle.
  **Mouse rebuilt against the MESH + painted outfit (2026-08-22, branch
  `silhouette-match`, see docs/dev-notes/2026-08-22-painted-sdf-outfit.md):**
  `.blob` prims can carry `color=rrggbb gloss=0..1` and a `core` mark; the
  mouse's shades, shoes, tee, shorts and sleeves are painted SDF and its kit
  is DELETED. Head and body re-proportioned to the mesh surface (frame-aligned;
  shoulder 0.53, collar 0.60), ears dished, lenses wrap the cheek with temple
  arms. Silhouette vs plate 0.660 -> 0.774 (re-measured 2026-08-22 with
  blob-measure: 0.804). Engine fixes on the way: occluder hull per-end
  radius (the "orb nose hole"), coneBend untapered branch, expandMirror
  x-reflection, clusterCore `core`, setStepsOverride(0), focusBody height.
  OPEN: hands enlarged but unreviewed; merge to main.
  **Agent toolbox baselines (2026-08-22, branch `agent-toolbox`, plan
  docs/superpowers/plans/2026-08-22-sdf-agent-toolbox.md):**
  | character | ref | IoU | mean width err | pose mismatch | worst band (line) | render-check |
  |---|---|---|---|---|---|---|
  | mouse | mesh (full) | 0.669 | 0.094 | yes | band 8, line 433, upperarm.r (armR), delta -0.356 | exit 0, OK |
  | mouse | plate (full) | 0.804 | 0.053 | yes | band 11, line 450, f_index.r (armR), delta +0.346 | exit 0, OK |
  | mouse | mesh, range 0.75:1 | 0.682 | 0.013 | no | band 8, line 497, foot.r (legR), delta +0.045 | exit 0, OK |
  | mouse | plate, range 0.75:1 | 0.800 | 0.015 | no | band 7, line 498, foot.r (legR), delta -0.054 | exit 0, OK |
  | goblin | none | no ref | no ref | no ref | no ref | exit 0, OK |
  | zombie | none | no ref | no ref | no ref | no ref | exit 0, OK |
  | clown | plate (clown-1-ref.png) | 0.561 | 0.155 | yes | band 1, line —, kit (kit), delta +0.348 | exit 0, OK |
  | clown-alt | plate (clown-1-ref.png) | 0.605 | 0.152 | yes | band 13, line 197, shin.r (legR), delta -0.295 | exit 0, OK |
  Whole-figure IoU is a before/after gradient per character, never a target
  (reference poses differ from the rest pose). The Task 11 trial is judged
  against these numbers.
  **IoU definition changed 2026-08-23** (after the schoolgirl run): the window IoU is now computed in HEIGHT units on a shared centreline, so rows outside a `--range` cannot distort it (a T-posed mesh made the schoolgirl's legs read 0.22 while agreeing to 0.008). The table above is the OLD definition; re-measured: mouse mesh 0.757 (was 0.669), mouse plate 0.805, cyclops 0.847, schoolgirl legs window 0.830 / head 0.906 / side 0.798. `row jerk` is also reported — it catches stacking that reaches the OUTLINE only; interior ring grooves (the schoolgirl's torso) are invisible to every silhouette number and need the pictures.
  **Task 11 trial queued (2026-08-22):** `~/.claude/dispatch/plans/2026-08-22-trial-mouse-shoes.md` — `zai/glm-5.1`, base `main`, ONE JOB: the mouse's shoe bands (0.88/0.90, line 497) within ±0.015 of the mesh in `--range 0.75:1`, IoU 0.682 -> >=0.70. Judge on three things: did it measure first, did the numbers move, did it look at frames. The hands were NOT chosen because whole-figure silhouette cannot see them (pose mismatch); they need a local measure like head-profile — open follow-up.
  **Trial result (2026-08-22, `zai/glm-5.3:xhigh`, 40 min, merged):** PASS on all three: measured first (start/end numbers in its report), numbers moved (legs+shoes window IoU 0.682 -> 0.703, mean width error 0.013 -> 0.008, shoe bands 8/9 out of the worst list; worst now thigh +0.014), and it looked (vision-ask on frames, reverted an edit that broke the gates, updated the test pin with a reason). Owner-eye check of the frames: two separate soft shoes, ball wider than heel. Verdict: the measured loop works on a weaker, text-only model. Next challenges: cyclops (`refs/cyclopsbuffmonster.glb` — legless, headless, tail; tests 'add primitives freely'), then the schoolgirl (`refs/schoolgirl-aura/`, rigged T-pose, Ichiro Tanida style).
  **Wound fixes (2026-08-22, main):** (1) craters flickered/snapped on walking limbs — damage.ts rebuilt the prim-local basis each frame with basisFromAxis, whose seed choice flips on near-vertical limbs; wounds now store their stamp axis and transport the basis by shortest arc (live probe: 18.6 cm jumps -> 0). (2) hits bound to the nearest ENDPOINT, putting the lower torso and flanks on forearm/thigh prims; now arg-min sdPrimitive, the shader's hitBest rule. (3) rim banding: the lip's surface-locality gate ramped over 0.35..0.7 amp (~4x Lipschitz); now -0.3..0.7 amp. (4, 2026-08-23) cyclops craters: grey speckle 'showing through' = the character's surfaceNoiseAmp 0.12 on a glossy hide (palette, now 0.04; bisected live — paint, face projection, mottle, roughness all cleared); ring/ball on the claw = rim shell added OUTSIDE the flesh (36% of rim cells at 0.7*amp reach) — reach now 0.35*amp (12%) in all three shaders, plus Wound.rimScale from the flesh thickness behind the hit (worldHitToWound takes the field). (5, 2026-08-23, `6605782`) crater 'ball from the side, streaks on the floor': the ball was the LIP (rimWidth 0.42 torus painted wet-red to 1.6x radius) -> rimWidth 0.25, wet mask 1.25x; overlapping craters' sharp ridge -> carves unioned with smin then one smax; no occlusion inside craters -> ao darkened by woundMask; streaks = relaxed tracer banding inside the cavity -> applyWounds returns nearWound (mapBody.z), march steps 0.6*d there (plain 1.0 still banded). (6, `d43ab42`) white band on the zombie lip = fresnel fade lost when the wound mask shrank -> woundMask returns (1.25x colouring, 1.6x fresnel); pellet lip 0.8 -> 0.35 splay; stripes across the cyclops fangs at zoom = the stub skull's face sheet projecting planar along z -> `sheet` block `enabled 0` (new key, lab honours it). OPEN: (a) a crater viewed into still reads as a ball from some angles — geometry is concave (CPU height map), the cue missing is a cast shadow/stronger floor darkening; owner to decide between darker matte floor vs a shadow ray near wounds. (b) FPS drop when zoomed close: FIXED — fill-bound cost (benchGpu 8.7 ms far -> 16.5 close; only SDF scale moved it). Adaptive resolution is now ON by default and drops a rung on p95 spikes (missed vsyncs) that the median cannot see; close 0.45 scale p95 17.2, far climbs to 1.0. Then (2026-08-23 pm): spikes while ORBITING zoomed = failed upward probes (by design, every ~2.5 s); probes now abort after 8 frames on missed-vsync spikes, base interval 3 s, backoff ceiling 20 s, ladder floor 0.2 for retina buffers; 15 s orbit p99 31.8 -> 22 ms, bursts 8 -> 3 frames. REMAINING, by design: one 3-frame burst per failed probe every 6-20 s while the scene sits at budget. **Schoolgirl v2 (2026-08-23, `kimi-oai/kimi-k3:xhigh`, merged):** look gate PASSED by its own vision-ask (ONE SMOOTH/SKIRT/BOB both views) and by owner-eye proxy: one smooth tapered torso, flared one-cone skirt, bob; legs 0.823 / head 0.907 / torso-side mean 0.014. Still wrong: the sailor collar reads as two white epaulette plates on the shoulders (needs a flat V-collar on the chest/back, scarf knot), and the face is a navy visor band (eyes need to be two small prims, not a band). v3 = face + collar only. **Face DECAL (2026-08-23, main):** owner: agents cannot paint a face; the mesh's own face pasted flat (PSX) is fine. The GLB's atlas is fragmented photogrammetry patches (no face island), so `npm run blob:face-bake -- <name>` renders the head orthographically from the front with its texture -> `public/assets/lab/faces/<name>-face.png`; `.blob` `sheet` gained `image <file>`, `decal 1`, `projScaleX/Y`, `projCentreX/Y`; shader: `faceCfg.x == 2` pastes tex.rgb as albedo (no glow, no relief) and the head-confinement reach is 1.5x (hs is normalised by the fattest head prim = the HAIR crown, which clipped the mouth at every projection setting — the 'nothing changes' trap). Eye/mouth prims removed from schoolgirl. `blob-turntable` gained `BLOB_TARGET_Y` (head close-ups) and `BLOB_PROBE` (poke/print a uniform before shooting — A/B without editing). Skill + reference + template updated: the face is not the agent's to paint. OWNER ALSO FLAGGED (v3 scope): forearm/hand clips the skirt hem (arm bones tilt=-2 inward, skirt flares to the hand); the 'white oval under the feet' is the sole plate at line ~261 (0.15x0.26 light grey bdb9bc at floor, 4x the shoe's depth) — shrink to the shoe footprint and darken. **Perf + wound shading (2026-08-23 pm, main `dfac7b2`/`eda786c`):** two-level fold cull (pack.ts boundGroups, ROW_CLUSTER_GROUPS/GROUP_*, DATA_ROWS 16) — schoolgirl ~35% faster, verified fold-exact via 200k-point CPU sweeps; the soundness lesson: sdPrimitive under-reports Euclid distance by maxScale/minScale (sole plate 22x), so every sphere-vs-d cull multiplies its threshold by a packed distortion factor — factor-free tore black crack seams inside wound cavities. Wound white slabs: three causes fixed (mask sphere painting the far side of the torso -> facing gate on colouring; spec firing on the shadow side -> light-facing gate; fresnel escaping at the cavity wall -> fade full to 1.3x). OPEN (next session): faint white grazing patch on limbs adjacent to wounds from some angles — smaller than the slabs, isolations say fresnel/wet interplay, NOT field error; owner still finds wound shading distracting in motion. **Schoolgirl head rework (owner-authored):** open forehead, decal paints hairline/peak, taller cranium, ears out; decal aim 0.38/0.45/0.89. v3 dispatch (collar/hands/sole) re-queued after being cancelled mid-baseline. **Perf plan QUEUED (2026-08-24):** spec DECIDED (0.7 scale floor, 30 fps everywhere incl. 12-body crowds, smooth LOD fades only, dedicated bench page; approach 1-extended locked) — docs/superpowers/specs/2026-08-23-raymarcher-performance-design.md. Implementation plan: docs/superpowers/plans/2026-08-24-raymarcher-perf.md (6 tasks: bench page+stats, heatmaps, cheaper hit shading, specialise measurement, per-tile lists + merged march, smooth LOD + coverage headroom). Dispatch chain at ~/.claude/dispatch/plans/2026-08-24-raymarcher-perf-task-{1..4}.md — task-1 is status `queued` (INERT) so nothing runs until the owner flips it to `pending` (or hits run in dispatch-ui at localhost:8090); tasks 2-4 are pending behind depends_on and auto-flow. Task 3 (tiles+merged march) is on kimi-k3, 180m. **Schoolgirl v3 MERGED (2026-08-24):** the dispatch hit its 120m cap during final verification (status 'failed', exit 124) but all three fixes landed with gates — sole = shoe footprint (NO PLATE), hands clear of the skirt via arm-chain repitch (CLEAR, clearOf +0.0069 pinned), real sailor-collar construction (best-SAILOR); merged with the ecd3ba pale skin kept over the branch's dab18a. Owner-authored head v3 also on main (open forehead, side locks, flat-lit decal, aim 0.38/0.42/0.78). REMAINING on schoolgirl: owner's close-up verdict on the collar. OLD POINTER (perf brainstorm) IS DONE. NEXT SESSION STARTS HERE: judge whatever perf dispatch tasks have run (reports in ~/.claude/dispatch/reports/), merge by their gates; if none have run, nothing is blocked — the chain waits for the owner. Then: cyclops v2 dispatch, mouse hands (needs a hand-profile measure first), residual wound grazing patch. Previously:  docs/superpowers/specs/2026-08-23-raymarcher-performance-design.md (brainstorm paused at the approach choice; owner decided target C = A must hit 30 fps at full window, B degrades to LOD; adaptive budget now 30 fps). Resume: answer the 4 open questions, pick an approach, then writing-plans. The real fix is a headroom signal: either reliable GPU timestamps (multi-pass resolve is broken, see adaptive-scale.ts header) or a coverage predictor (projected cluster-sphere area x scale^2) so the controller only probes when the prediction has room. Also: the host had fileproviderd at 115% CPU and four stale dispatch vite servers during measurement. Parked: the rim still 'breathes' slightly with the jiggle because the gate is relative to the pre-wound skin; blood particles from wounds is a feature in its own right, not a cover. Cyclops dispatch (`~/.claude/dispatch/plans/2026-08-22-cyclops-character.md`) was RUNNING at wrap-up — judge it next session on the same three things as the trial; schoolgirl after that (owner: later, not today).
  **WOUND HALO SOLVED (2026-08-24 night, main `224fbbd`; post-mortem: Obsidian `Claude Notes/Blud/2026-08-24-wound-halo-postmortem.md`):** the sweeping halos / white slabs / 'distorted-lens' clipping around craters was RELAXED SPHERE TRACING (relax 1.4) x carved wound fields — the omega>1-only paths (overshoot retraction + the new deep-crossing retract guard) step rays BACKWARD at grazing wound angles and fail to reconverge; whole screen-space circles render the body from an offset view, flipping with tiny camera moves. `relax` (woundCfg2.y) now defaults **1.0** — DO NOT raise it while wounds exist until the retract guard reconverges (bound the back-step, finish conservative); the X1.10 '1.4 optimum, visually unchanged' sweep PREDATES wounds. Adaptive resolution defaults OFF again (its close-up rung drops read as blur-halos and confounded the hunt). The wound pipeline is restored to 2026-08-22 (`c7f8afb`) byte-parity: entries (4)-(6) above — the whole 2026-08-23 crater-shading pass (split masks, facing gate, cavity-AO darkening, lip locality flip, rimWidth 0.25, pellet splay 0.35, smin overlap union) — are REVERTED wholesale; every owner verdict against/for them was rendered through the relax lens, so re-evaluate each ONE at a time at relax 1.0 if wanted (all preserved in branch history with reasoning). KEPT: the tracer retract guard (real bug — perpendicular crossings with radius+prevRadius == stepLen exactly evaded the strict-< overshoot test and landed rays ~10 cm INSIDE the body = the rear white slab; dead code at relax 1.0), nearWound plain stepping, the fold cull (exonerated twice), and the thin-limb carve-shift machinery in damage.ts (dormant, unwired). NEW **X1.28 wound soft shadow** merged DEFAULT OFF (see its row). Live-pokeable diagnostic views (masks/components/hit-depth) recorded as a paste-in at docs/dev-notes/2026-08-24-wound-debug-views.md; the owner's console kill-switches in the failing view were what cracked it. Unrelated: recurring 535 ms frame stalls during diagnosis were the Claude desktop browser pane's GPU process, not the app (headless bisect: every branch commit p95 < 19 ms) — restart the app to clear. FOLLOW-UPS: retract-guard reconvergence (wins back relax 1.4's ~1.6x crowd speedup — fold into the perf plan), soft-shadow rework, one-at-a-time re-eval of the reverted refinements. **PERF CHAIN RE-BASELINED + RUNNING (2026-08-24, main `19d1860`):** the perf spec/plan/shader were written at relax 1.4 + adaptive-on and asserted a world that no longer exists. Corrected: the spec filed relaxed tracing as a non-lever ("< 0.5 ms") on a CLOSE-camera reading — on crowds it is **1.60x** (X1.10: 10 bodies, 1.0 -> 14.89 ms vs 1.4 -> 9.31 ms), the largest single item on the board, and the renderer pays it in full today. `march.wgsl.ts` still claimed "over-relaxation is always safe"; that predates wounds (applyWounds returns no distance bound) and now states the real constraint. Both retraction faults are documented in place: the overshoot path undoes d*(w-1) where the excess is d*(w-1)/w (**40% over-retraction** at 1.4), and the deep-crossing guard steps back by a SCALED-space d that under-reports Euclid by the group distortion factor (22x, schoolgirl sole plate) so it need not leave the solid, unbounded. NEW **plan Task 2.5 / dispatch task-1b**: retract-guard reconvergence — retract to the last known-outside sample `tSafe`, never by a computed distance; CPU mirror of the tracer under property tests (nothing here compiles WGSL, so vitest cannot see shader bugs); 3-character wounded visual gate; relax sweep re-run WITH wounds. Runs BEFORE tasks 3/5 since both rewrite the march loop. Task 6's coverage predictor is now conditional (adaptive defaults off — it would improve a disabled controller). Chain: **task-1 (bench) -> task-1b -> task-2 -> 3 -> 4**, with 1b and 2 left `queued` (INERT) so the owner gates the baselines and then the relax verdict before anything builds on 1.4. Also fixed: the lab's adaptive button hardcoded the label 'on' while the flag defaults false.
  **SDF perf brainstorm additions (2026-08-24 night):** measured why schoolgirl/cyclops tank vs zombie/goblin — primitive counts: zombie 12, goblin 25, schoolgirl 37 (+22x sole-plate distortion forcing tiny steps), cyclops 38, mouse 40; cost = pixels x steps x prims and every step folds the whole character. Spec gained levers **7 (temporal depth reprojection)** and **8 (low-res conservative prepass)** — both attack the step-count factor by starting rays near the surface; queued as **dispatch task-5** (depends_on task-4, pending). Invariant for both: a seeded start may only ever be NEARER than the true surface, and the margin must cover the wound lip's outward eversion; prepass is stateless and doubles as reprojection's disocclusion fallback. Separately dispatched a **hybrid shell-marching spike** (`~/.claude/dispatch/plans/2026-08-24-shell-march-spike.md`, branch dispatch/shell-march-spike): mesh the zombie's analytic field at iso d=+0.03 via marching cubes over `sdBody` (validate.ts), rasterize the hull for entry/exit depth, sphere-trace only the thin shell (budget 16 steps) — if the look survives it obsoletes most step-count work for hero bodies. The spike is ALSO the first real task on the NEW **dsh harness** (DeepSeek, model `deepseek-v4-flash-vision-exp`, vision — it judges its own capture pairs; dsh resolves auth itself, no api_key_env/base_url in frontmatter). Judge it like any dispatch: verify commits on the branch, remember the silent-noop-on-rate-limit signature. Reference noted: PardesLine tutorial 04 (github.com/1904jonathan/PardesLine) does mesh->SDF->shell via voxel erosion + skimage marching_cubes — we have the analytic field so iso-offset replaces morphology exactly, but skimage marching_cubes is the fallback if a TS mesher is annoying (bake hulls in Python beside bake_humanoid_sdf.py), and erosion-band inner shells are the trick if back-face exit depths prove imprecise. Wider context recorded in Obsidian `Claude Notes/Blud/2026-08-24-sdf-render-optimization-options.md` (incl. why native Rust/C++ would NOT vastly speed this up — GPU-bound, WGSL compiles to the same Metal — and the gib-voxelization worker plan). **Shell-march spike DONE (2026-08-24 22:06, dsh harness test PASSED, branch `dispatch/shell-march-spike` `79cd406` — dispatch auto-committed after the dsh sandbox blocked git in the worktree, a known dsh gotcha not a failure):** look survives at geometry level (silhouette/smin/normals match at all 8 yaws, self-judged by the vision model); ~14x fewer mapBody evals/frame (shell 4.56 steps/px on a 30k footprint vs full 6.79 on 285k), frame ~16 vs ~29ms single-body (~1.8x; the 14x eval cut is the crowd win); CONFIRMED failure mode: +3cm hull inflation eats sub-3cm detail (mitten hands, no face) — productionizing = per-part hulls with adaptive inflation + posed hulls + wound handling. tsc clean, 1510 lab tests green, protected files untouched. dsh/deepseek-v4-flash verdict: precise brief-following, honest reporting, vision works — good enough for mechanical chain tasks (task-2) if zai quota needs relief; hold task-1b for a stronger model. **iq "Selfie Girl" (shadertoy WsSBzh) studied** — techniques note: Obsidian `Claude Notes/Blud/2026-08-24-selfie-girl-techniques.md` (license: techniques only, NEVER port its code). Top takeaways: (a) analytic bounding-INTERVAL clip — intersect ray vs cluster spheres and march only [entry, exit]; cheap sibling of levers 7/8, could land before either; (b) hair = ONE bezier + cross-section grid repetition = ~18 strands per curve eval — the answer to schoolgirl fringe prim cost; (c) `mapD` pattern: pores/fuzz detail only in the normal-pass map, the march runs the clean field (audit where surfaceNoiseAmp is paid today); (d) per-axis radius ramps on ellipsoids collapse several prims into one (his jaw); (e) cloth = onion-shell ellipsoid + sine warp + seam rounding via length(vec2(dA,dB)) — for the sailor collar/skirt hem; (f) iq ships UNDER-relaxed (0.95) and gets speed from bounding + cheap fields — counterpoint for the relax-1.4 debate.
  **Cyclops run result (2026-08-22/23, `zai/glm-5.3:xhigh`, 2h15, merged):** PASS on gates — front IoU 0.838 (mean 0.019, worst +0.044), side 0.751 (gate 0.75, just); render-check clean; registered in the lab; `cyclops-blob.test.ts` pins eye/maw/fangs/claws/tail-hook. Eye check: one domed eye in the upper chest, fang row, clawed arms, no legs, tail hooks up in profile. Weak (follow-up run, not a blocker): arms read as stubby sacks not long clawed limbs; spiked trapezius hood + dorsal spines absent; the maw groove is barely visible in the dark flesh — consider a lighter lip paint. Three characters now validate the measured loop on glm-5.3.
  **Bonewalker authored WITH blob:rings — the tool's first from-scratch trial
  (2026-08-27, `dispatch/bonewalker-character`):** sixth .blob character, a
  horned skeletal undead at 1.30 m off `refs/bonewalker-mesh/bonewalker.glb`
  (1.700 m Meshy T-pose, 67% measurable verts). Skeleton built entirely from
  the brief's rig-measured len= table — result: ZERO "BONE LENGTH IS OFF"
  blocks in every ring fit (mouse/schoolgirl drowned in them). Converged in 3
  ring rounds to ≤14mm mean residual everywhere except the foot (46mm — claw
  fan + the rig's 45° down-forward foot bone vs our horizontal one confound
  the ring mapping) and the pelvis (23mm — the fit reads bowl-mass rho ~55mm
  while the mesh's iliac wings spike to 119mm halfW; a radial blob cannot
  express blades, so the wings got their own prims). VERDICT: blob:rings
  earned its place — radius/scale/offset findings were applied as printed
  (blocks 3-12 round 1) and survived cross-checks; its flags correctly
  disowned the weak blocks (IMPOSSIBLE on the blend-buried spine ridge, NOT
  A LINE on calf/forearm bulges, t-support flags on the shoulder ball); it
  has NO eye and NO paint sense: it asked the pelvis 3x to shrink to 52mm
  semi-axis (render + mesh profile said starved), asked the painted spine
  ridge to vanish (twice, IMPOSSIBLE r), and cannot see the face/horns/claws
  at all. blob:measure was nearly useless here — even the legs are posed
  (wide crouch) so no clean --range window exists; row jerk 0.017 vs our
  0.006 says the mesh's bony knobbly read is a remaining gap. Face = baked
  decal (horns included in the head box; projection AIMED eyes+chin), body
  = rusted-red palette + bone-dust mottle + painted spine ridge/horns/claws.
  Character pins: 11 tests (bone lengths, lankiness, floor contact, waist
  pinch as a RELATION, ribcage deeper than wide, claw paint counts). tsc 0,
  1715 lab tests, render-check clean. Two tool lessons for the skill: (1) a
  capsule's bottom cap is a half-radius hemisphere — a ribcage bar starting
  at the bone head fills the waist pinch 2cm below it (the pin caught it);
  (2) a high-Hips rig (Meshy 58.1%) vs surface crotch (49.7%) means the
  spine chain rides ~0.108 low; parent clavicle to NECK and let an unmapped
  skull bone absorb the offset.
  **Schoolgirl run result (2026-08-23, `zai/glm-5.3:xhigh`, 65 min, merged as v1):** process PASS (measured both windows every edit, head-profile, vision-ask on front/back frames, 6 commits, tests pin measured numbers); band numbers PASS (legs window mean width err 0.008 worst +0.020; head 0.010/-0.027). LOOK: FAIL for the style goal — the torso is a stack of horizontal discs (collar plate, two white rings, skirt cylinder + disc hem, pleat fragments on the thighs); recognisable as a schoolgirl, not Tanida-smooth. TWO TOOL LESSONS: (1) in-range IoU is meaningless when whole-figure aspects differ (T-pose 0.919 vs 0.259): compareSilhouette normalises to the whole-figure bbox before taking range rows — fix: normalise within the window; (2) per-band width matching is satisfied exactly by stacked discs — the measure needs a stacking/step detector and the skill must say the bands cannot see it. Follow-up run after the tool fixes: smooth masses, blended torso, skirt as a flared cone.
  **Mouse proportions run (2026-08-22, `dispatch/mouse-proportions`):** rebuilt
  the mouse to the maus-biped RIG joint heights (skeleton was a big head on
  stubby legs — head ~53% of the file). Lengthened legs (thigh/shin ~46%) and
  torso (added `spine2`, chest 0.095→0.183), keeping height 1.10; legs/torso/
  head now ≈32/34/34 (ref 32.1/34.2/33.7). Re-fit head prims to the shorter
  skull; re-built the kit skeleton + re-authored tee/shorts/brows/shades; and
  fixed the DETACHED shoes (the old shoe's mouth ring sat at y~0 while the
  ankle was at 0.141) — the shoe ray now starts at the ankle and hangs rings
  to the ground. Mouse blob+kit tests, full 1958-test suite, tsc, build all
  green.
  [design](../../docs/superpowers/specs/2026-08-20-sdf-character-language-design.md) · [plan](../../docs/superpowers/plans/2026-08-20-sdf-character-language.md) · [primitive roadmap](../../docs/superpowers/specs/2026-08-21-blob-primitive-roadmap.md) · [chisel spike](../../docs/dev-notes/2026-08-21-chisel-primitive-sculpt/notes.md) · skill: `.claude/skills/authoring-sdf-characters/` · Obsidian: `Claude Notes/Blud/2026-08-21-blobforge-sharp-features-and-kits.md`
- `P8.clown-skull` [x] **clown skull + kit re-fit (owner review rounds)** — root
  cause was a WebGPU-lab integration bug: `webgpu/lab-main.ts` built every head
  from `DEFAULT_FACE` and threw away the `.blob`'s own `face` block, so the
  clown's 0.235x1.18 ball rendered as the 0.118x0.76 DEFAULT_FACE skull — a
  narrow head under a kit cap built for the big ball. Fix seeds `face` from
  `compileFace(parseBlob(src))`. Then re-fit the kit to the corrected head: cap
  band widened ~23%, ruff collar (the MISSING piece — the bells floated with
  nothing holding them) added as a flared loft with the beads/poms on its rim,
  hair tufts mount at the hairline and drape down ~100deg, capcone is a rounder
  beret, ruff silver-grey, eyes smaller + specular catchlight (eyeGlint).
  [branch `dispatch/clown-skull`]

- `P9` [x] **Ring-fit (`blob:rings`)** — fits existing `.blob` prims to a skinned
  reference mesh via `sdBody` residuals; pose-independent, suggests rather than
  applies, reports each prim as one coupled edit with its semi-axes. Spec
  `docs/superpowers/specs/2026-08-26-blob-ring-fit-design.md`, plan
  `docs/superpowers/plans/2026-08-26-blob-ring-fit.md`.

---

## Process notes

- **Completing a task:** flip `[ ]` → `[x]`, **collapse the row to a one-liner** (detail goes in the commit message + a dualmem checkpoint), commit.
- **Discovering a new task:** next available number in the right section, **one line**, commit.
- **Task rows are ≤2 lines.** If context needs more, put it in a linked dev-note / plan doc and leave a bare link on the row.
- **Milestone rollup:** when a milestone lands, collapse per-task detail into a single line with the commit range; the plan file + git log hold the rest.
- **Design questions:** re-read the design spec above before adjusting scope. **Real problem restated (owner, 2026-09-04): frame dips when a body FILLS the screen (and under heavy blood particles).** Next levers, pixel-scaling only: (1) post-hit probes → derivative normals + reduced-rate AO/thin (6 → ~1 evals/pixel), (2) quarter-res depth prepass to start rays near the skin without vertex cost. Adaptive resolution REJECTED for close-up (visible res drop). Tile binning measured nil — not the cost. Plan note: Obsidian `Claude Notes/Planning/2026-09-04-sdf-close-up-frame-rate-plan.md`.

**Hit batching SHIPPED (2026-09-05):** pellet impacts batched per actor per frame (`beginHits/endHits`) — landing frame with 16 pellets 6.7 ms CPU (was 12–18 ms for 4 pellets; ~16 whole-body repacks on a point-blank double barrel). Left: per-pellet CPU flesh probes (~6 ms/16 pellets), first-shot 131 ms pipeline compile (prewarm). Notes: docs/dev-notes/2026-09-04-closeup-2-probes/notes.md.

**Close-up wounded frame, quiet-machine verdict (2026-09-05):** ship 25.6 ms (step 1.0 + cull), step 0.6 = 32.2 (+26%), cull off = +1%, bones out of field = −16% (4.2 ms; the planned baked-bone replacement collects it), unwounded 15.1. Wound step 1.0 was THE lever and is shipped; the cull is a harmless no-op; the earlier 50 ms readings were machine load. Notes: docs/dev-notes/2026-09-04-closeup-2-probes/notes.md.
