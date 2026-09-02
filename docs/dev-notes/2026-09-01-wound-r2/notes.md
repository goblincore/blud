# Wound pass round 2 — gates, captures and the owner pass

**Date:** 2026-09-01 · **Branch:** `dispatch/2026-09-01-wound-r2-task-11` · **Status:** tasks 1–10 landed (`2d5cfb3..4c6b831`); this task is the evidence pass
**Spec:** `docs/superpowers/specs/2026-09-01-wound-pass-r2-design.md` (on `claude/continue-previous-work-91055b`) · **Plan:** same branch, `docs/superpowers/plans/2026-09-01-wound-pass-r2.md`

## What shipped (tasks 1–10, recapped for this note's reader)

Bone is an ordinary primitive (`op:'bone'` → `primScale.w = 4` = `W_BONE`) living in
its own `body.bonePrims` array, packed at rows `[primCount, primCount+boneCount)` —
never among the flesh rows. It folds as a hard `min` AFTER `applyWounds`, gated on
`nearWound` — exact, because authored/derived bones are containment-filtered to sit
strictly inside flesh, so `min(flesh, bone) === flesh` wherever flesh is intact.
Shading: `mapBody`'s `.w` return slot carries `carved` (the pre-wound field), the
tissue ramp `skin→fat→muscle/clot` rides `surfCfg3 = (woundDepthAmp, fatDepth,
muscleDepth, woundFibreAmp)`, torn fibre rides `surfCfg3.w` multiplied by `wm`
(wound-mask) so it can never repaint undamaged skin, and bone-ness rides `bestIdx`
(read AFTER the bone fold) with a stain blending bone toward meat at the cavity wall.
Auto-derivation (`bone-derive.ts`, `DEFAULT_BONE_RATIO = 0.38`) runs in `buildBody`
from flesh prims; a `bones` block in `.blob` authors overrides (zombie: cranium dome
+ ribcage plate; goblin: skull + chest). Tuning panel on the game page
(`__sdfGame.woundPanel(true)`), one key table, `setWoundTuning` seam; `boneRatio`
rebuilds the cast, the four ramp keys are live uniform writes.

## Gate results

| gate | plan §4 | result |
| --- | --- | --- |
| 1. bench baseline | done before planning | task 9 `91fece0` |
| 2. off-state parity | THIS task | **PASS structurally** (described below — see "why no pixel diff") |
| 3. containment validation | task 2/10 | passing in suite (`checkBoneContainment`; authored breaches are build errors, derived breaches are dropped) |
| 4. CPU/GPU agreement | task 1 | passing in suite (pack encoding + CPU mirror) |
| 5. undamaged identity | THIS task | **PASS as a field assertion + visual** (the plan's pixel gate was replaced — see below) |
| 6. halo check | THIS task | **PASS** — no annuli, no camera-sweeping crescents across 12 angles |
| 7. bench legs (measurement, not a gate) | task 9, run HERE | **UNRESOLVED: +0.0%** — see bench section |

## Why there is no pixel diff anywhere in this note

Task 5 measured this harness against itself: two runs of the SAME build differ by
52–82k pixels (eye-glow flicker, lamp shimmer between Chrome boots). That noise
floor is larger than anything this plan changed, so every "capture A vs capture B"
pixel comparison would measure the harness. Gate 5 was therefore re-formed as a
zero-noise FIELD assertion, and gates 2/6 were judged by describing what the
captures show, structurally. This replacement was ordered by the task brief after
the plan was written; the plan text still says "pixel-identical" for gate 5 — the
plan is wrong on this one line, this note is what happened.

## Gate 5 — the field assertion (new test)

`zombie-blob.test.ts`: **"an undamaged body folds bit-identically with and without
bone"** — packs the compiled zombie twice (default vs `boneRatio: 0`) and asserts
the packed FLESH rows are bit-identical (`primA`, `primScale`, and `primCount`
itself), plus that `boneCount` really drops while staying > 0 (the authored
cranium/ribcage ride in BOTH arms, so the comparison cannot pass vacuously on two
boneless bodies).

TDD honesty: on this branch the test passes immediately (the feature landed in
tasks 1–10) — there was no red state to observe naturally. To prove the test CAN
fail, a mutation check re-introduced the pre-task-4 design (bones appended into
`prims`): the test fails with `expected 41 to be 25` (the flesh row count moved).
Mutation reverted; suite green. Two assertions beyond the brief's sketch were added
(`primCount` equality, `boneCount` bounds) — strengthening, not weakening: the
sketch as written would NOT have caught bones packed among the flesh rows, which is
the exact historical design (efd0fc7) it exists to guard against.

**Undamaged captures** (`captures/undamaged-front.png`, `undamaged-back.png`, 8-frame
turntable run clean): intact pink zombie, front and back, default tuning. NO bone
visible anywhere on unbroken skin — no pale patches at the skull, no stripes on the
shins, nothing at the ribcage. This is the nearWound gate's visual half: with no
wound, the bone fold changes nothing you can see.

## Gate 2 — off-state parity

The plan's probe cannot run as written: `window.__sdfGame.setWoundTuning` is a
GAME-page seam and `blob:shot` shoots the LAB page, where `__sdfGame` does not
exist — the literal command dies on `Cannot read properties of undefined`. Also,
two of the three keys it sets are not live-tunable on the lab at all: `surfCfg3`
is, but `boneRatio` shapes `buildBody` and has no lab seam (the game page's
`setWoundTuning` rebuilds the cast; the lab has no equivalent). Adapted recipe:

```
BLOB_PROBE='(window.__sdfLab.stampWounds(5), window.__sdfLab.freezeCosmetics(),
             window.__sdfLab.uniforms.surfCfg3.value.set(0,0.004,0.014,0), 1)'
```

(amps at 0 via the uniforms the lab does expose; `freezeCosmetics()` stops blood/
goo/chunk debris so the wound interior stays readable; `main` gets the same probe
minus the `surfCfg3` line — it has no such uniform. Baseline shot from a detached
worktree at the plan's base `eea6620`, own ports, own servers.)

**Result — structurally indistinguishable.** `captures/gate-off-branch.png` vs
`gate-off-main.png` (both yaw 0, same rest pose, same 5-blast torso grid): both
show one merged red bowl centre-torso, flat deep-red interior, identical lip,
identical silhouette. The sub-pixel body offset is the turntable's documented
~0.3–0.4% verlet-settle drift, not a rendering difference. By the shader's own
construction (`select(..., surfCfg3.x > 0.0)`, `if (surfCfg3.w > 0.0 && wm > 0.0)`)
the ramp and fibre are bit-for-bit the pre-r2 shading at zero amplitude — the
captures agree.

**One thing off-state CANNOT ablate any more: bone.** The zombie now ships with
AUTHORED bones (task 10), and `boneRatio: 0` only kills the derived set — authored
bones are part of the model, like flesh, on both lab and game pages. Where a carve
reaches an authored plate, gate-off shows bone where `main` shows red. That is by
design (the bone is IN the model now), but it means "off-state ≡ main" is exactly
true only for the SHADING path, not for geometry. Recorded here so nobody calls
the residual bone exposure a gate failure.

## Gate 6 — halo check (this file has produced that failure twice)

12-frame turntable (`captures/halo-12frames/`, 30° steps), 5 stamped wounds, DEFAULT
tuning — ramp, fibre and bone all ON. Looked for, frame by frame:

- **annuli at mask edges** — none. The only ring-like feature is the bright yellow
  fat band INSIDE the bowl, following the carve-depth contour (that is the ramp
  working, not a halo); skin outside the mouth is clean pink in all 12 frames.
- **crescents sweeping with the camera** — none. The back quarter (120°/240°, where
  no wounds exist) shows no red or pale smudge, no wrap-around, no glow hugging the
  silhouette against the background.

The ramp's structural A/B against gate-off is exactly: same bowl, plus a yellow
shallow-depth band and (at 14 stacked wounds, below) a tan bone plate — nothing
ADDED outside the wound mask anywhere in the sweep.

## The deep-wound read — bone, ramp, fibre in one frame

`captures/deep-bone-front.png` + `deep-bone-torso-crop.png`: `stampWounds(14)`
stacks overlapping blasts until the carve reaches the authored ribcage plate.
The cavity reads top-to-bottom as designed: **tan bone plate** exposed in the upper
bowl (stained toward meat at its junction — the clean-plate-would-read-as-decal
case the spec called out), **bright fat ring** at the shallow rim, **deep red
clot** at the bottom, and the **torn-fibre mottle** visible as darker red streaks
inside the lower bowl. Skin outside the cavity: untouched. THIS is the frame for
the owner's "does bone show too readily" call — at 5 blasts no bone shows; it took
14 stacked blasts on one spot to expose the plate.

## The stump — pre-existing protrusion, recoloured by the ramp (owner call #2 input)

Severed legL through the page's real key path (synthetic `keydown '5'` →
`severLimb`), close framing: `captures/stump-branch-45.png`. Below the self-closed
hip stump hangs a **thin pale rod with the foot blob at its end** — and the
critical finding is that this GEOMETRY IS PRE-EXISTING: `captures/stump-main-45.png`
is `main` at the same angle with the same rod, same foot blob, same proportions.
CPU-side confirmation (temporary test, run and deleted): after
`severLimb(body, 'legL')` the legL FLESH prims (thigh 17, shin 18, foot 19) are all
still alive in `body.prims`; the 3 legL BONE prims are what got dropped
(`boneCount` 18 → 15; dead cluster ⇒ bones skipped at pack time). The rod is
surviving half-carved shin flesh hanging below the closed stump — a `main`
artifact this plan did not create.

What r2 CHANGES is the rod's colour, and the A/B isolates it:
with the ramp on it reads fat-yellow (`stump-branch-45.png`); with
`surfCfg3.x = 0` it reads main's flat deep red (`stump-branch-noramp.png`), which
matches `stump-main-45.png`. The colour flip with the ramp amplitude — not the
bone material path, which has no amplitude gate — proves the rod is WOUND-SHADED
FLESH, not an exposed bone prim. So: the protrusion is a bug candidate OLDER than
this plan (owner call: feature or bug — but not an r2 regression), and the ramp
makes it read more yellow/fatty than main did.

## Gate 7 — the bench (measurement, NOT a gate)

`BENCH_LEGS=wounds BENCH_REPEATS=3 scripts/dungeon-bench.sh` — three legs
(`wounds-off` / `wounds-no-bone` / `wounds-bone`) alternating in one process, room 4
firefight, pinned census. Full tables: `bench/bench.md`, raw `bench/baselines.json`.

| leg | overall p50 | vs wounds-no-bone |
| --- | ---: | ---: |
| wounds-off | 9.07 ms | −2.2% |
| wounds-no-bone | 9.27 ms | — |
| wounds-bone | 9.27 ms | **+0.0%** |

**Measured +0.0%, reported UNRESOLVED**: the baseline leg's own within-run spread is
4% (9.27/9.01/9.35 across reps) and cross-run machine drift is ~45%, so zero-point
nothing under that spread is not a measurement of the bone fold's cost — it is the
noise floor saying the fold is AT MOST small. Census held across every leg
(9 bodies on screen, 15–16 realised wounds), so the legs measured the same room.
The honest containment argument remains the amplitude guards: `woundDepthAmp 0`,
`woundFibreAmp 0`, `boneRatio 0` each restore the previous shading/geometry
bit-for-bit (shader `select`/`if` gates; derivation returns `[]` at ratio ≤ 0).

## The dungeon read

`captures/dungeon-room-slug.png` — room 3, flashlight beam, wound staged through the
page's own predictor path (`aimSurface()` → `predictSlugHit()` →
`stampWoundAt(..., 'slug', actorId)` at 2.63 m, plus `explode()` at the hit point —
51 wounds across 4 bodies, all wound-only, no shove/sever). The slug crater reads
as a distinct warm orange-yellow mark on the hip at 2.6 m — **the wound is visible
under the beam**, no problem of legibility.

Honest limits of this shot: at combat range the ramp's banding and the bone plate
do NOT resolve — the detail that reads in the lab crops collapses to "orange
wound" at 2.6 m on a 1380-wide frame (the beam's warm colour and the fat/bone
colours merge). Whether deep-wound detail needs to read at that range is an owner
call; the close-range dungeon read was not captured separately (body positions
re-roll per load, so framing a close-up deterministically is its own task — the
aimSurface recipe here is reusable for it).

## What did NOT work / traps found (read before re-running any of this)

1. **The plan's Step-2 probe is unwritable as printed** — `__sdfGame.setWoundTuning`
   does not exist on the lab page blob:shot shoots, and the lab has no boneRatio
   seam at all. Adapted recipe above; a lab-side `setWoundTuning` seam would have
   been the cleaner fix but is a code change this evidence task was forbidden to make.
2. **A stale capture stack was serving the WRONG build.** Ports 5233/9223 (the
   defaults) had a leftover vite from the task-8 worktree still listening — its
   lab is missing tasks 9–10. Every capture here used fresh ports
   (`LAB_VITE_PORT=5244 LAB_CDP_PORT=9244`, `5245/9245` for the base worktree).
   `lab-servers.sh` REUSES whatever answers the port; check `lsof` before trusting
   a capture from a shared machine.
3. **The worktree had no node_modules** (fresh dispatch worktree). Chain convention:
   `ln -s /Users/donny/Projects/blud/node_modules node_modules` (the main repo's
   pruned install still has vite/vitest; do NOT npm install in the main repo).
4. **Gate 5's pixel form is unrunnable** (52–82k px same-build noise floor, task 5)
   — replaced by the field assertion; see above. The plan text still says
   "pixel-identical" for that gate.
5. **`stampWounds` cannot stage limb or head wounds** — it is a torso-front grid.
   The owner calls about SKINNY-LIMB bone (call #1) could not be staged from the
   lab; the closest evidence is the stump rod (a limb-region artifact) and the
   deep-bone torso plate. Limb-bone exposure wants either a `stampWoundAt`-with-
   raycast harness on the lab or in-game play.
6. **Fibre anchor stretch (owner call #3) could not be evidenced** — every lab
   capture freezes motion into rest pose (the turntable contract), and the stretch
   only appears on POSED bodies (rest-space anchor vs posed surface). Needs a
   walking capture or in-game look; absent evidence, no claim either way.
7. **The test brief's sketch would have passed with bones packed among flesh rows**
   (it slices `[0, primCount*4)`, which stays equal in that failure mode). The two
   added assertions close that hole; recorded so the sketch is not restored.
8. **`npm test` in this worktree: 2620 passed, 7 failed — all 7 pre-existing and
   environmental.** Every failure is `scripts/blob-measure.test.ts` dying at
   `spawnSync node_modules/.bin/tsx ELOOP` (the shared pruned node_modules' broken
   self-referential tsx, hit through the worktree symlink). Proven not mine:
   stashing ALL of this task's changes and re-running that file fails identically
   (7/7) on the bare base commit. Everything else is green, including the new
   gate-5 test and the full GPU/game suites.

## Capture catalogue

| file | what it shows |
| --- | --- |
| `captures/undamaged-front.png` / `-back.png` | gate 5 visual: intact zombie, bone nowhere visible |
| `captures/gate-off-branch.png` | gate 2, this branch, amps 0 + 5 wounds: flat red bowl |
| `captures/gate-off-main.png` | gate 2, base `eea6620`, same recipe: same bowl |
| `captures/halo-12frames/` | gate 6, 12×30° sweep, default tuning (index.html grid) |
| `captures/deep-bone-front.png` / `-torso-crop.png` | 14 stacked wounds: bone plate + fat ring + clot + fibre |
| `captures/stump-branch-45.png` / `-front.png` | legL severed, ramp on: rod reads fat-yellow |
| `captures/stump-branch-noramp.png` | same, ramp off: rod reads flat red (colour A/B) |
| `captures/stump-main-45.png` | base `eea6620`: SAME rod geometry — protrusion pre-exists r2 |
| `captures/dungeon-room-slug.png` | game page, beam-lit slug crater at 2.63 m |
| `bench/bench.md`, `bench/baselines.json` | gate 7 tables + raw (UNRESOLVED +0.0%) |

## For the owner's judgement pass (the three calls)

1. **Bone too readily on skinny limbs?** Not stageable from the lab (torso-only
   stamner); the torso plate needed 14 stacked blasts to show at all, which
   suggests the containment filter + 0.38 ratio are conservative — but the limb
   answer needs in-game play or a limb-staging harness.
2. **Stump protrusion — feature or bug?** It predates this plan (identical on
   `main`); r2 only recolours it fat-yellow where the ramp covers it. The bug,
   if it is one, is that `severLimb` leaves distal FLESH prims alive behind the
   stump wound (CPU-verified), not anything bone did.
3. **Fibre anchor stretch worth having?** Unevidenced (rest-pose captures cannot
   show it). Decide from play, then keep/tune/kill `woundFibreAmp` — the amp
   guard makes that a one-key decision.
